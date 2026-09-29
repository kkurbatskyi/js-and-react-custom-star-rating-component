/**
 * Galaxy structure: the analytic density fields and the constructive sampler behind `GalaxyModel`.
 * Internal to src/gen/galaxy — application code uses ./model.ts. Equations: ./README.md.
 *
 * Frame G: Y = galactic north, disk in XZ, light-years. R = √(x² + z²), θ = atan2(z, x).
 * Arms wind towards +θ with radius, so they TRAIL for a disk rotating towards −θ
 * (counter-clockwise seen from +Y — the same sense as prograde orbits in src/sim).
 *
 * Densities here are UNSCALED (thin-disk midplane density at R = 0 ≈ 1); the model multiplies by
 * a calibration factor so that the density at `homeLy` is 0.004 stars/ly³.
 *
 * Performance: the field functions are called millions of times, so they are allocation-free and
 * avoid transcendental calls where a table does as well: the radial profiles and sech² are float64
 * LUTs (relative error < 1e-4), flocculence noise is pre-baked on a grid. Per-call scratch lives
 * in a Float64Array — storing doubles into captured `let`s would box a HeapNumber on every write.
 * The shared scratch makes a structure non-re-entrant (fine on JS's single thread).
 */
import { logGamma, smoothstep, TAU, uniformOpen } from '../../core/math';
import { createNoise3, fbm3 } from '../../core/noise';
import { createRng } from '../../core/rng';
import type { GalaxyParams, Rng } from '../../core/types';

/** Everything in GalaxyParams that shapes the galaxy (home and star count are derived from it). */
export type GalaxyShapeParams = Omit<GalaxyParams, 'homeLy' | 'estimatedStarCount'>;

export type GalaxyComponent = 'disk' | 'arm' | 'bulge' | 'bar' | 'halo';
export const GALAXY_COMPONENTS: readonly GalaxyComponent[] = [
  'disk',
  'arm',
  'bulge',
  'bar',
  'halo',
];

// ───────────────────────────────────────────── Tunables (see README for the physics behind them)

/** Home sits at this fraction of the disk radius (≈ the Sun's 26 kly in a 50 kly disk). */
export const HOME_RADIUS_FRACTION = 0.52;
/** armWidthLy is a FWHM; σ = FWHM / (2√(2 ln 2)). */
const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2));
/** Width of the logistic disk edge, × radius. */
const EDGE_WIDTH = 0.045;
/** Thick disk: midplane density relative to the thin disk, and scale height × hz. */
const THICK_DISK_NORM = 0.07;
const THICK_DISK_HEIGHT = 3.2;
/** Arm (young) population scale height × hz — young stars hug the midplane. */
const ARM_HEIGHT = 0.6;
/** Arm amplitude modulation depth (flocculence): arm strength varies between 1 − this and 1. */
const ARM_FLOCCULENCE = 0.65;
/** Ridge wiggle: perpendicular amplitude (× σ) and noise frequency per unit of ln R along the arm. */
const ARM_WIGGLE = 0.6;
const ARM_WIGGLE_FREQ = 6;
const ARM_WIGGLE_LUT = 512;
/** Arms fade out between these radii (× radius); nothing arm-related exists beyond the outer one. */
const ARM_FADE_START = 0.95;
const ARM_OUTER = 1.2;
/** Dust lanes: offset towards the concave side and width, both × arm σ; interarm dust floor. */
const DUST_LANE_OFFSET = 0.5;
const DUST_LANE_WIDTH = 0.45;
const DUST_FLOOR = 0.15;
/** Star-count fraction of the stellar halo relative to the (thin + thick) disk. */
const HALO_FRACTION = 0.015;
/** Young-population baseline in the smooth thin disk (ongoing star formation between arms). */
const YOUNG_DISK_BASELINE = 0.05;
/** Relative light per star by component, used to weight `sample` (arms are OB-rich). */
const LIGHT_PER_STAR: Readonly<Record<GalaxyComponent, number>> = {
  disk: 1,
  arm: 4,
  bulge: 1.5,
  bar: 1.5,
  halo: 0.5,
};
/** Flocculence noise grid resolution (nodes per side) and extent (× radius). */
const NOISE_GRID = 256;
const NOISE_EXTENT = 1.25;
/** Sampler truncation radius, × radius. */
export const SAMPLE_EXTENT = 1.2;
/** Radial LUTs cover [0, RADIAL_EXTENT × radius]; beyond it the disk and dust are exactly 0. */
const RADIAL_EXTENT = 1.5;
const RADIAL_LUT_SIZE = 4096;
/** sech²(u) LUT over u ∈ [0, SECH2_MAX] (sech²(16) ≈ 5e-14). */
const SECH2_MAX = 16;
const SECH2_LUT_SIZE = 2048;

export interface GalaxyStructure {
  readonly shape: GalaxyShapeParams;
  /** Unscaled stellar density (see module doc). */
  density(x: number, y: number, z: number): number;
  /** In-plane arm proximity 0..1 (y is ignored), including envelope and flocculence. */
  armFactor(x: number, y: number, z: number): number;
  /** Signed perpendicular distance (ly) to the nearest arm ridge: > 0 on the concave (inner) side. */
  armOffset(x: number, z: number): number;
  /** Relative dust density 0..~1. */
  dust(x: number, y: number, z: number): number;
  /** Young-population share of the local density, 0..1. */
  young(x: number, y: number, z: number): number;
  /** Bulge + bar share of the local density, 0..1. */
  bulgeShare(x: number, y: number, z: number): number;
  /** Relative star counts per component (unscaled density × ly³). */
  readonly componentStars: Readonly<Record<GalaxyComponent, number>>;
  /** Light-weighted mixture probabilities used by `sample` (sum to 1). */
  readonly componentWeights: Readonly<Record<GalaxyComponent, number>>;
  /** Sample one component's distribution. */
  sampleComponent(
    rng: Rng,
    component: GalaxyComponent,
    out: [number, number, number],
  ): [number, number, number];
  /** Sample a position ∝ stellar light (component chosen by `componentWeights`). */
  sample(rng: Rng, out: [number, number, number]): [number, number, number];
}

// ───────────────────────────────────────────── Tables

interface RadialTable {
  /** r at uniformly spaced cumulative probability (inverse CDF), for O(1) sampling. */
  readonly inverse: Float64Array;
  /** ∫ pdf dr over the table range. */
  readonly total: number;
}

/** Tabulate ∫pdf (trapezoid) and invert it on a uniform probability grid. */
function buildRadialTable(
  pdf: (r: number) => number,
  rMin: number,
  rMax: number,
  n = 4096,
  nInv = 2048,
): RadialTable {
  const dr = (rMax - rMin) / (n - 1);
  const cdf = new Float64Array(n);
  let prev = pdf(rMin);
  for (let i = 1; i < n; i++) {
    const cur = pdf(rMin + i * dr);
    cdf[i] = (cdf[i - 1] as number) + 0.5 * (prev + cur) * dr;
    prev = cur;
  }
  const total = cdf[n - 1] as number;
  const inverse = new Float64Array(nInv);
  let j = 0;
  for (let k = 0; k < nInv; k++) {
    const target = (k / (nInv - 1)) * total;
    while (j < n - 2 && (cdf[j + 1] as number) < target) j++;
    const c0 = cdf[j] as number;
    const c1 = cdf[j + 1] as number;
    const t = c1 > c0 ? Math.min(1, Math.max(0, (target - c0) / (c1 - c0))) : 0;
    inverse[k] = rMin + (j + t) * dr;
  }
  return { inverse, total };
}

function sampleTable(inv: Float64Array, u: number): number {
  const f = u * (inv.length - 1);
  const i = Math.min(inv.length - 2, Math.floor(f));
  const a = inv[i] as number;
  return a + ((inv[i + 1] as number) - a) * (f - i);
}

/** Uniform LUT of f on [0, xMax] with one guard entry; lookups clamp to 0 beyond xMax. */
function buildLut(f: (x: number) => number, xMax: number, size: number): Float64Array {
  const lut = new Float64Array(size + 2);
  for (let i = 0; i <= size; i++) lut[i] = f((i * xMax) / size);
  return lut;
}

/** sech²(u) for u ≥ 0 (shared by every structure). */
const SECH2 = buildLut(
  (u) => {
    const e = Math.exp(-2 * u);
    return (4 * e) / ((1 + e) * (1 + e));
  },
  SECH2_MAX,
  SECH2_LUT_SIZE,
);
const SECH2_SCALE = SECH2_LUT_SIZE / SECH2_MAX;

/** sech²(|y| · invH) via the LUT (u = |y|/h). */
function sech2(ay: number, invH: number): number {
  const f = ay * invH * SECH2_SCALE;
  if (f >= SECH2_LUT_SIZE) return 0;
  const i = f | 0;
  const a = SECH2[i] as number;
  return a + ((SECH2[i + 1] as number) - a) * (f - i);
}

// ───────────────────────────────────────────── Builder

// Scratch slots (see module doc on why this is a typed array).
const S_AMP = 0;
const S_DUST = 1;
const S_THIN = 2;
const S_ARM = 3;
const S_BULGE = 4;

export function buildGalaxyStructure(shape: GalaxyShapeParams): GalaxyStructure {
  const scratch = new Float64Array(5);
  const rMax = shape.radiusLy;
  const rd = shape.diskScaleLengthLy;
  const hz = shape.diskScaleHeightLy;
  const hThick = THICK_DISK_HEIGHT * hz;
  const hArm = ARM_HEIGHT * hz;
  const invHz = 1 / hz;
  const invHThick = 1 / hThick;
  const invHArm = 1 / hArm;
  const invHDust = 1 / shape.dustScaleHeightLy;
  const invRd = 1 / rd;
  const invEdge = 1 / (EDGE_WIDTH * rMax);
  const taper = (r: number): number => 1 / (1 + Math.exp((r - rMax) * invEdge));
  /** exp(−R/Rd) × logistic taper at the visible edge (exact; the hot path uses the LUT). */
  const diskRadialExact = (r: number): number => Math.exp(-r * invRd) * taper(r);

  // ── Arms: log spirals θ_k(R) = φ0 + 2πk/K + ln(R/R0)/tan(pitch)
  const armCount = Math.max(0, Math.floor(shape.armCount));
  const armStrength = Math.max(0, shape.armStrength);
  const hasArms = armCount > 0 && armStrength > 0;
  const armSpacing = TAU / Math.max(1, armCount);
  const invArmSpacing = 1 / armSpacing;
  const cotPitch = 1 / Math.tan(shape.armPitchRad);
  const sinPitch = Math.sin(shape.armPitchRad);
  const armPhase = shape.armPhaseRad;
  const hasBar = shape.barLengthLy > 0;
  // Arms emerge from the bar ends (barred) or the bulge edge (unbarred).
  const rStart = hasBar ? 0.5 * shape.barLengthLy : 0.85 * shape.bulgeRadiusLy;
  const logRStart = Math.log(rStart);
  const envLo = 0.6 * rStart;
  const envHi = 1.3 * rStart;
  const armFadeStart = ARM_FADE_START * rMax;
  const armOuter = ARM_OUTER * rMax;
  const sigma0 = shape.armWidthLy * FWHM_TO_SIGMA;
  const rRef = HOME_RADIUS_FRACTION * rMax;
  /** Arm Gaussian σ, flaring gently with radius (σ0 at the home radius). */
  const armSigma = (r: number): number => sigma0 * (0.6 + (0.4 * r) / rRef);
  const invEnvIn = 1 / (envHi - envLo);
  const invEnvOut = 1 / (armOuter - armFadeStart);
  /**
   * Arms grow in from the bar ends / bulge edge and fade out just beyond the visible disk:
   * smoothstep(envLo, envHi, R) · (1 − smoothstep(fadeStart, outer, R)), with fast paths.
   */
  const armEnvelope = (r: number): number => {
    let e = 1;
    if (r < envHi) {
      const t = (r - envLo) * invEnvIn;
      if (t <= 0) return 0;
      e = t * t * (3 - 2 * t);
    }
    if (r > armFadeStart) {
      const t = (r - armFadeStart) * invEnvOut;
      if (t >= 1) return 0;
      e *= 1 - t * t * (3 - 2 * t);
    }
    return e;
  };
  const flocculenceRoot = createRng(shape.seed).fork('galaxy.flocculence');

  // ── Ridge wiggle: smooth 1-D noise along each arm, w_k(u) with u = ln(R/R0). As a function of R
  //    alone the displaced ridge θ_k(R) + δθ_k(R) stays single-valued — it cannot fold into
  //    caustics the way a 2-D displacement field would — and samples land on it exactly.
  const armSlots = Math.max(1, armCount);
  const uMin = Math.log(envLo / rStart);
  const uMax = Math.log(armOuter / rStart);
  const wiggleScale = ARM_WIGGLE_LUT / (uMax - uMin);
  const wiggleStride = ARM_WIGGLE_LUT + 2;
  const wiggleLut = new Float64Array(armSlots * wiggleStride);
  {
    const noise = createNoise3(flocculenceRoot.fork('wiggle').seed);
    for (let k = 0; k < armSlots; k++) {
      for (let i = 0; i <= ARM_WIGGLE_LUT; i++) {
        const u = uMin + i / wiggleScale;
        const w = 1.3 * fbm3(noise, u * ARM_WIGGLE_FREQ, 7.31 * k + 0.5, 0.25, 2);
        wiggleLut[k * wiggleStride + i] = w < -1 ? -1 : w > 1 ? 1 : w;
      }
    }
  }
  /** Wiggle of arm k at u = ln(R/R0), in −1..1. */
  const wiggleAt = (k: number, u: number): number => {
    let f = (u - uMin) * wiggleScale;
    f = f < 0 ? 0 : f > ARM_WIGGLE_LUT - 1e-9 ? ARM_WIGGLE_LUT - 1e-9 : f;
    const i = f | 0;
    const o = k * wiggleStride + i;
    const a = wiggleLut[o] as number;
    return a + ((wiggleLut[o + 1] as number) - a) * (f - i);
  };

  // ── Dust radial profile: central deficit (bulges are dust-poor), slow decline, same edge.
  const dustInner = 1.4 * rStart;
  const invDustScale = 1 / (2.5 * rd);
  const dustRadialExact = (r: number): number =>
    smoothstep(0.4 * rStart, dustInner, r) *
    (r > dustInner ? Math.exp(-(r - dustInner) * invDustScale) : 1) *
    taper(r);

  // ── Radial LUTs
  const radialMax = RADIAL_EXTENT * rMax;
  const radialScale = RADIAL_LUT_SIZE / radialMax;
  const diskLut = buildLut(diskRadialExact, radialMax, RADIAL_LUT_SIZE);
  const dustLut = buildLut(dustRadialExact, radialMax, RADIAL_LUT_SIZE);
  const lookup = (lut: Float64Array, r: number): number => {
    const f = r * radialScale;
    if (f >= RADIAL_LUT_SIZE) return 0;
    const i = f | 0;
    const a = lut[i] as number;
    return a + ((lut[i + 1] as number) - a) * (f - i);
  };

  // ── Flocculence noise, pre-baked on a grid: channel 0 = arm amplitude (0..1),
  //    1 = dust patchiness (0..1). Bilinear lookups are ~10× cheaper than evaluating fbm.
  const gridHalf = NOISE_EXTENT * rMax;
  const gridN = NOISE_GRID;
  const invCell = (gridN - 1) / (2 * gridHalf);
  const grid = new Float32Array(gridN * gridN * 2);
  {
    const nAmp = createNoise3(flocculenceRoot.fork('amplitude').seed);
    const nDust = createNoise3(flocculenceRoot.fork('dust').seed);
    const fAmp = 1 / 5500;
    const fDust = 1 / 4000;
    // Nodes beyond the arm extent (+2 cells for the bilinear footprint) are never read where
    // anything is non-zero: give them neutral values and skip ~20 % of the noise work.
    const reach2 = (gridHalf + 2 / invCell) ** 2;
    for (let j = 0; j < gridN; j++) {
      const z = -gridHalf + j / invCell;
      for (let i = 0; i < gridN; i++) {
        const x = -gridHalf + i / invCell;
        const o = (j * gridN + i) * 2;
        if (x * x + z * z > reach2) {
          grid[o] = 0.5;
          grid[o + 1] = 0.5;
          continue;
        }
        const a = 0.5 + 1.8 * fbm3(nAmp, x * fAmp, 1.91, z * fAmp, 3);
        grid[o] = a < 0 ? 0 : a > 1 ? 1 : a;
        const d = 0.45 + 1.3 * fbm3(nDust, x * fDust, 3.07, z * fDust, 3);
        grid[o + 1] = d < 0 ? 0 : d > 1 ? 1 : d;
      }
    }
  }
  const gridHi = gridN - 1.000001;
  /** Bilinear lookup of both noise channels at (x, z) → scratch[S_AMP], scratch[S_DUST]. */
  const sampleGrid = (x: number, z: number): void => {
    let fx = (x + gridHalf) * invCell;
    let fz = (z + gridHalf) * invCell;
    fx = fx < 0 ? 0 : fx > gridHi ? gridHi : fx;
    fz = fz < 0 ? 0 : fz > gridHi ? gridHi : fz;
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const o00 = (iz * gridN + ix) * 2;
    const o01 = o00 + gridN * 2;
    const w00 = (1 - tx) * (1 - tz);
    const w10 = tx * (1 - tz);
    const w01 = (1 - tx) * tz;
    const w11 = tx * tz;
    scratch[S_AMP] =
      (grid[o00] as number) * w00 +
      (grid[o00 + 2] as number) * w10 +
      (grid[o01] as number) * w01 +
      (grid[o01 + 2] as number) * w11;
    scratch[S_DUST] =
      (grid[o00 + 1] as number) * w00 +
      (grid[o00 + 3] as number) * w10 +
      (grid[o01 + 1] as number) * w01 +
      (grid[o01 + 3] as number) * w11;
  };

  /**
   * Signed perpendicular distance to the nearest ridge: d ≈ R·Δθ·sin(pitch), where Δθ is the
   * angular offset from the nearest arm's (wiggled) ridge, found by reducing modulo the arm
   * spacing 2π/K. Positive = inner (concave) side.
   */
  const ridgeOffset = (x: number, z: number, r: number, sigma: number): number => {
    const u = Math.log(r) - logRStart;
    let delta = Math.atan2(z, x) - armPhase - u * cotPitch;
    const turns = Math.round(delta * invArmSpacing) | 0; // int32: `%` on doubles is an fmod call
    delta -= turns * armSpacing;
    let k = turns % armSlots;
    if (k < 0) k += armSlots;
    const rs = r * sinPitch;
    return rs * delta - ARM_WIGGLE * sigma * wiggleAt(k, u);
  };

  /** Planar arm factor at cylindrical radius r. */
  const armPlanar = (x: number, z: number, r: number): number => {
    if (!hasArms) return 0;
    const envelope = armEnvelope(r);
    if (envelope === 0) return 0;
    const sigma = armSigma(r);
    const g = ridgeOffset(x, z, r, sigma) / sigma;
    const gauss = envelope * Math.exp(-0.5 * g * g);
    if (gauss < 1e-9) return 0;
    sampleGrid(x, z);
    return gauss * (1 - ARM_FLOCCULENCE + ARM_FLOCCULENCE * (scratch[S_AMP] as number));
  };

  // ── Bulge (flattened Plummer), bar (triaxial Gaussian), halo (softened r^−3.5)
  const bulgeA = 0.5 * shape.bulgeRadiusLy;
  const bulgeQ = shape.bulgeFlattening;
  const invBulgeA2 = 1 / (bulgeA * bulgeA);
  const invBulgeQ2 = 1 / (bulgeQ * bulgeQ);
  const barCos = Math.cos(shape.barAngleRad);
  const barSin = Math.sin(shape.barAngleRad);
  const barSu = 0.25 * shape.barLengthLy;
  const barSv = 0.3 * barSu;
  const barSy = 0.6 * hz;
  const invBarSu2 = hasBar ? 1 / (barSu * barSu) : 0;
  const invBarSv2 = hasBar ? 1 / (barSv * barSv) : 0;
  const invBarSy2 = hasBar ? 1 / (barSy * barSy) : 0;
  const haloRh = shape.bulgeRadiusLy;
  const invHaloRh2 = 1 / (haloRh * haloRh);

  // ── Component normalisation from star-count fractions of the smooth disk.
  const sampleMax = SAMPLE_EXTENT * rMax;
  const diskTable = buildRadialTable((r) => TAU * r * diskRadialExact(r), 0, sampleMax);
  const diskStars = diskTable.total * 2 * (hz + THICK_DISK_NORM * hThick); // ∫sech²(y/h)dy = 2h
  const thickShare = (THICK_DISK_NORM * hThick) / (hz + THICK_DISK_NORM * hThick);
  // Bars grow out of the disk, and barred spirals tend to have smaller classical bulges.
  const bulgeFraction =
    (0.12 + 0.18 * Math.min(1, Math.max(0, (shape.bulgeRadiusLy - 3500) / 2000))) *
    (hasBar ? 0.7 : 1);
  const barFraction = hasBar ? 0.18 * (shape.barLengthLy / 12_000) : 0;
  // Plummer: ∫(1 + r²/a²)^−5/2 dV = (4π/3)a³ (× q when flattened).
  const bulge0 = (bulgeFraction * diskStars) / ((4 / 3) * Math.PI * bulgeA ** 3 * bulgeQ);
  const bar0 = hasBar
    ? (barFraction * diskStars) / ((2 * Math.PI) ** 1.5 * barSu * barSv * barSy)
    : 0;
  // ∫0^∞ u²(1 + u²)^−7/4 du = ½ B(3/2, 1/4).
  const haloShapeIntegral = 0.5 * Math.exp(logGamma(1.5) + logGamma(0.25) - logGamma(1.75));
  const halo0 = (HALO_FRACTION * diskStars) / (4 * Math.PI * haloRh ** 3 * haloShapeIntegral);

  // Mean flocculence factor over the disk (for the arm star count).
  let floccSum = 0;
  let floccN = 0;
  for (let j = 0; j < gridN; j++) {
    for (let i = 0; i < gridN; i++) {
      const x = -gridHalf + i / invCell;
      const z = -gridHalf + j / invCell;
      if (x * x + z * z > rMax * rMax) continue;
      floccSum += 1 - ARM_FLOCCULENCE + ARM_FLOCCULENCE * (grid[(j * gridN + i) * 2] as number);
      floccN++;
    }
  }
  const meanFlocculence = floccN > 0 ? floccSum / floccN : 1;
  // ∫A R dθ over a ring ≈ K·σ√(2π)/sin(pitch)·env·F̄ — the arm is a 1-D structure, so the arm
  // star count per dR carries no factor R (and neither does its sampling pdf).
  const armTable = buildRadialTable(
    (r) => diskRadialExact(r) * armEnvelope(r) * armSigma(r),
    envLo,
    sampleMax,
  );
  const armStars = hasArms
    ? armStrength *
      2 *
      hArm *
      ((armCount * Math.sqrt(TAU)) / sinPitch) *
      meanFlocculence *
      armTable.total
    : 0;
  const haloTable = buildRadialTable(
    (r) => r * r * (1 + r * r * invHaloRh2) ** -1.75,
    0,
    sampleMax,
  );

  const componentStars: Record<GalaxyComponent, number> = {
    disk: diskStars,
    arm: armStars,
    bulge: bulgeFraction * diskStars,
    bar: barFraction * diskStars,
    halo: HALO_FRACTION * diskStars,
  };
  let lightTotal = 0;
  for (const c of GALAXY_COMPONENTS) lightTotal += componentStars[c] * LIGHT_PER_STAR[c];
  const componentWeights = {} as Record<GalaxyComponent, number>;
  for (const c of GALAXY_COMPONENTS) {
    componentWeights[c] = (componentStars[c] * LIGHT_PER_STAR[c]) / lightTotal;
  }
  const cumulative = new Float64Array(GALAXY_COMPONENTS.length);
  {
    let acc = 0;
    GALAXY_COMPONENTS.forEach((c, i) => {
      acc += componentWeights[c];
      cumulative[i] = acc;
    });
  }

  // ── Density evaluation (component terms left in the scratch for the share functions)
  const evaluate = (x: number, y: number, z: number): number => {
    const r2 = x * x + z * z;
    const r = Math.sqrt(r2);
    const ay = y < 0 ? -y : y;
    const radial = lookup(diskLut, r);
    let thin = 0;
    let disk = 0;
    let arm = 0;
    if (radial > 0) {
      thin = radial * sech2(ay, invHz);
      disk = thin + radial * THICK_DISK_NORM * sech2(ay, invHThick);
      if (hasArms && r > envLo) {
        const vArm = sech2(ay, invHArm);
        if (vArm > 0) arm = radial * armStrength * armPlanar(x, z, r) * vArm;
      }
    }
    const t = 1 + (r2 + y * y * invBulgeQ2) * invBulgeA2;
    let bulgeBar = bulge0 / (t * t * Math.sqrt(t));
    if (hasBar) {
      const u = x * barCos + z * barSin;
      const v = z * barCos - x * barSin;
      const s = u * u * invBarSu2 + v * v * invBarSv2 + y * y * invBarSy2;
      if (s < 80) bulgeBar += bar0 * Math.exp(-0.5 * s);
    }
    const h = 1 + (r2 + y * y) * invHaloRh2;
    const sh = Math.sqrt(h);
    const halo = halo0 / (h * sh * Math.sqrt(sh)); // h^−1.75
    scratch[S_THIN] = thin;
    scratch[S_ARM] = arm;
    scratch[S_BULGE] = bulgeBar;
    return disk + arm + bulgeBar + halo;
  };

  const armFactor = (x: number, _y: number, z: number): number =>
    armPlanar(x, z, Math.sqrt(x * x + z * z));

  const armOffset = (x: number, z: number): number => {
    const r = Math.sqrt(x * x + z * z);
    return r > 0 ? ridgeOffset(x, z, r, armSigma(r)) : 0;
  };

  // Dust: a thin disk with a patchy interarm floor and lanes on the concave side of each ridge.
  const dust = (x: number, y: number, z: number): number => {
    const vertical = sech2(y < 0 ? -y : y, invHDust);
    if (vertical === 0) return 0;
    const r = Math.sqrt(x * x + z * z);
    const radial = lookup(dustLut, r);
    if (radial === 0) return 0;
    let lane = 0;
    if (hasArms && r > envLo && r < armOuter) {
      const sigma = armSigma(r);
      const t =
        (ridgeOffset(x, z, r, sigma) - DUST_LANE_OFFSET * sigma) / (DUST_LANE_WIDTH * sigma);
      lane = armEnvelope(r) * Math.exp(-0.5 * t * t);
    }
    sampleGrid(x, z);
    return radial * vertical * (scratch[S_DUST] as number) * (DUST_FLOOR + (1 - DUST_FLOOR) * lane);
  };

  const young = (x: number, y: number, z: number): number => {
    const total = evaluate(x, y, z);
    if (!(total > 0)) return 0;
    const v =
      ((scratch[S_ARM] as number) + YOUNG_DISK_BASELINE * (scratch[S_THIN] as number)) / total;
    return v > 1 ? 1 : v;
  };

  const bulgeShare = (x: number, y: number, z: number): number => {
    const total = evaluate(x, y, z);
    if (!(total > 0)) return 0;
    const v = (scratch[S_BULGE] as number) / total;
    return v > 1 ? 1 : v;
  };

  // ── Sampling (constructive; the only loop is the bounded flocculence thinning of arm samples)
  const plummerTruncR = 6 * bulgeA;
  const plummerMassTrunc = (1 + (bulgeA * bulgeA) / (plummerTruncR * plummerTruncR)) ** -1.5;
  const haloInv = haloTable.inverse;
  const diskInv = diskTable.inverse;
  const armInv = armTable.inverse;

  const writeSpherical = (rng: Rng, r: number, yScale: number, out: [number, number, number]) => {
    const cosT = 2 * rng.next() - 1;
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = TAU * rng.next();
    out[0] = r * sinT * Math.cos(phi);
    out[1] = r * cosT * yScale;
    out[2] = r * sinT * Math.sin(phi);
  };

  const sampleDisk = (rng: Rng, out: [number, number, number]): void => {
    const r = sampleTable(diskInv, rng.next());
    const theta = TAU * rng.next();
    const h = rng.next() < thickShare ? hThick : hz;
    out[0] = r * Math.cos(theta);
    out[1] = h * Math.atanh(2 * uniformOpen(rng) - 1); // inverse CDF of sech²(y/h)
    out[2] = r * Math.sin(theta);
  };

  const sampleArm = (rng: Rng, out: [number, number, number]): void => {
    if (!hasArms) {
      sampleDisk(rng, out);
      return;
    }
    // Pick a ridge, scatter perpendicular to it with σ(R); thin by flocculence (≤ 8 tries).
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = sampleTable(armInv, rng.next());
      const k = Math.min(armCount - 1, Math.floor(rng.next() * armCount));
      const sigma = armSigma(r);
      const u = Math.log(r) - logRStart;
      // Perpendicular offset d (ly) ↔ angular offset d / (R sin pitch) along the circle.
      const d = ARM_WIGGLE * sigma * wiggleAt(k, u) + rng.normal(0, sigma);
      const theta = armPhase + u * cotPitch + k * armSpacing + d / (r * sinPitch);
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      sampleGrid(x, z);
      const keep = 1 - ARM_FLOCCULENCE + ARM_FLOCCULENCE * (scratch[S_AMP] as number);
      if (rng.next() < keep || attempt === 7) {
        out[0] = x;
        out[1] = hArm * Math.atanh(2 * uniformOpen(rng) - 1);
        out[2] = z;
        return;
      }
    }
  };

  const sampleBulge = (rng: Rng, out: [number, number, number]): void => {
    // Plummer enclosed mass m = (1 + a²/r²)^−3/2  ⇒  r = a / √(m^−2/3 − 1)
    const m = uniformOpen(rng) * plummerMassTrunc;
    writeSpherical(rng, bulgeA / Math.sqrt(m ** (-2 / 3) - 1), bulgeQ, out);
  };

  const sampleBar = (rng: Rng, out: [number, number, number]): void => {
    if (!hasBar) {
      sampleBulge(rng, out);
      return;
    }
    const u = rng.normal(0, barSu);
    const v = rng.normal(0, barSv);
    out[0] = u * barCos - v * barSin;
    out[1] = rng.normal(0, barSy);
    out[2] = u * barSin + v * barCos;
  };

  const sampleHalo = (rng: Rng, out: [number, number, number]): void => {
    writeSpherical(rng, sampleTable(haloInv, rng.next()), 1, out);
  };

  const sampleComponent = (
    rng: Rng,
    component: GalaxyComponent,
    out: [number, number, number],
  ): [number, number, number] => {
    switch (component) {
      case 'disk':
        sampleDisk(rng, out);
        break;
      case 'arm':
        sampleArm(rng, out);
        break;
      case 'bulge':
        sampleBulge(rng, out);
        break;
      case 'bar':
        sampleBar(rng, out);
        break;
      case 'halo':
        sampleHalo(rng, out);
        break;
    }
    return out;
  };

  const sample = (rng: Rng, out: [number, number, number]): [number, number, number] => {
    const u = rng.next();
    let i = 0;
    while (i < cumulative.length - 1 && u >= (cumulative[i] as number)) i++;
    return sampleComponent(rng, GALAXY_COMPONENTS[i] as GalaxyComponent, out);
  };

  return {
    shape,
    density: evaluate,
    armFactor,
    armOffset,
    dust,
    young,
    bulgeShare,
    componentStars,
    componentWeights,
    sampleComponent,
    sample,
  };
}

// ───────────────────────────────────────────── Memoisation

const STRUCTURE_CACHE_SIZE = 4;
const structureCache = new Map<string, GalaxyStructure>();

function shapeKey(s: GalaxyShapeParams): string {
  return [
    s.seed,
    s.radiusLy,
    s.diskScaleLengthLy,
    s.diskScaleHeightLy,
    s.bulgeRadiusLy,
    s.bulgeFlattening,
    s.barLengthLy,
    s.barAngleRad,
    s.armCount,
    s.armPitchRad,
    s.armWidthLy,
    s.armStrength,
    s.armPhaseRad,
    s.dustScaleHeightLy,
  ].join('|');
}

/** Memoised `buildGalaxyStructure` (small LRU keyed by the shape parameters). */
export function getGalaxyStructure(shape: GalaxyShapeParams): GalaxyStructure {
  const key = shapeKey(shape);
  const hit = structureCache.get(key);
  if (hit) {
    structureCache.delete(key);
    structureCache.set(key, hit);
    return hit;
  }
  const built = buildGalaxyStructure({ ...shape });
  structureCache.set(key, built);
  if (structureCache.size > STRUCTURE_CACHE_SIZE) {
    const oldest = structureCache.keys().next().value;
    if (oldest !== undefined) structureCache.delete(oldest);
  }
  return built;
}

// ───────────────────────────────────────────── Numerical integration & home

/**
 * ∭ density dV over a cylinder of radius and half-height `extentLy`, by the midpoint rule on a
 * grid uniform in θ and in asinh-stretched R and y (fine near the axis and midplane where the
 * density is concentrated, coarse in the halo). ~1.2e5 evaluations (~12 ms); agrees with a 4×
 * finer grid to ~0.1 % and with the analytic component totals to ~1 %.
 */
export function integrateDensity(
  density: (x: number, y: number, z: number) => number,
  extentLy: number,
  nR = 48,
  nTheta = 64,
  nY = 40,
): number {
  const r0 = 400;
  const y0 = 120;
  const sMax = Math.asinh(extentLy / r0);
  const tMax = Math.asinh(extentLy / y0);
  const ds = sMax / nR;
  const dt = (2 * tMax) / nY;
  const dTheta = TAU / nTheta;
  const cosT = new Float64Array(nTheta);
  const sinT = new Float64Array(nTheta);
  for (let j = 0; j < nTheta; j++) {
    cosT[j] = Math.cos((j + 0.5) * dTheta);
    sinT[j] = Math.sin((j + 0.5) * dTheta);
  }
  let sum = 0;
  for (let i = 0; i < nR; i++) {
    const s = (i + 0.5) * ds;
    const r = r0 * Math.sinh(s);
    const dr = r0 * Math.cosh(s) * ds;
    for (let k = 0; k < nY; k++) {
      const t = -tMax + (k + 0.5) * dt;
      const y = y0 * Math.sinh(t);
      const dy = y0 * Math.cosh(t) * dt;
      let ring = 0;
      for (let j = 0; j < nTheta; j++) {
        ring += density(r * (cosT[j] as number), y, r * (sinT[j] as number));
      }
      sum += ring * r * dr * dTheta * dy;
    }
  }
  return sum;
}

/**
 * The curated "you are here": in the midplane at R = 0.52 × radius, on the OUTER (convex) edge of
 * the strongest arm crossing that circle, where the arm factor has fallen to `targetArm` — the
 * arm fills half the sky while dust lanes (on the concave side) stay out of the way.
 */
export function findHome(structure: GalaxyStructure, targetArm = 0.4): [number, number, number] {
  const r = HOME_RADIUS_FRACTION * structure.shape.radiusLy;
  const n = 4096;
  const at = (theta: number): number =>
    structure.armFactor(r * Math.cos(theta), 0, r * Math.sin(theta));
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = at((TAU * i) / n);
  // Strongest ridge crossing = the global maximum along the circle (always a local maximum).
  let peak = 0;
  for (let i = 1; i < n; i++) if ((values[i] as number) > (values[peak] as number)) peak = i;
  // Decreasing θ at fixed R moves to the convex side of a trailing arm (armOffset < 0).
  let theta = (TAU * peak) / n;
  if ((values[peak] as number) > targetArm) {
    for (let step = 1; step < n / 2; step++) {
      const i = (peak - step + n) % n;
      if ((values[i] as number) <= targetArm) {
        // Bisect between the last sample above the target and this one.
        let hiTheta = (TAU * (peak - step + 1)) / n;
        let loTheta = (TAU * (peak - step)) / n;
        for (let b = 0; b < 40; b++) {
          const mid = 0.5 * (hiTheta + loTheta);
          if (at(mid) > targetArm) hiTheta = mid;
          else loTheta = mid;
        }
        theta = 0.5 * (hiTheta + loTheta);
        break;
      }
    }
  }
  return [r * Math.cos(theta), 0, r * Math.sin(theta)];
}
