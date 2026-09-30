/**
 * Galaxy particles, generated once on the CPU from the galaxy structure (deterministic per seed).
 *
 * Three kinds:
 * - **field** — unresolved star clouds sampled ∝ light from each structure component. Together they
 *   carry `share[c]` of component c's light (the volume pass carries the rest), so particles and
 *   volume add up to the calibrated galaxy. Fluxes follow a truncated Pareto law: many faint, a
 *   few bright.
 * - **cluster** — young blue clusters, beaded in clumps along the arm ridges.
 * - **hii** — pink Hα knots, clumped on the star-forming side of the ridges, next to the dust lanes.
 *
 * Each particle is an isotropic Gaussian of σ (ly) with total flux Φ (unscaled light units, see
 * ./calibration.ts); `radiance` stores the peak radiance Φ / (2πσ²) × unit-luminance colour, to be
 * multiplied by the emission scale k_E and per-kind gains in the shader.
 */
import { clamp, lerp, smoothstep } from '../../core/math';
import { createRng } from '../../core/rng';
import type { Rng } from '../../core/types';
import {
  GALAXY_COMPONENTS,
  type GalaxyComponent,
  type GalaxyStructure,
} from '../../gen/galaxy/structure';
import { compressLight, populationColorInto } from './calibration';

export const PARTICLE_KIND = { field: 0, cluster: 1, hii: 2 } as const;

export interface ParticleOptions {
  /** Share of each component's light carried by particles (the volume carries 1 − share). */
  readonly share: Readonly<Record<GalaxyComponent, number>>;
  /** Fractions of the particle budget spent on young clusters and on HII knots. */
  readonly clusterFraction: number;
  readonly hiiFraction: number;
  /** Total light of all clusters / HII knots relative to the arm component's light. */
  readonly clusterLight: number;
  readonly hiiLight: number;
  /** Gaussian σ ranges (ly, log-uniform). */
  readonly fieldSigmaLy: readonly [number, number];
  readonly clusterSigmaLy: readonly [number, number];
  readonly hiiSigmaLy: readonly [number, number];
  /** Pareto index of the flux distribution (smaller = more dominated by a few bright ones). */
  readonly fluxIndex: number;
  /** Largest flux relative to the mean (truncates the Pareto tail). */
  readonly fluxMax: number;
  /** Population colours (K) and chroma boost. */
  readonly bulgeK: number;
  readonly diskK: number;
  readonly thickK: number;
  readonly youngK: number;
  /** Young population at the centre; blends to `youngK` (and bulgeK + 500 → diskK) by `gradientLy`. */
  readonly innerYoungK: number;
  readonly gradientLy: number;
  readonly saturation: number;
  /** Highlight compression (./calibration.ts `compressLight`): knee in unscaled light, γ. */
  readonly kneeLight: number;
  readonly kneeGamma: number;
}

export const DEFAULT_PARTICLE_OPTIONS: ParticleOptions = {
  share: { disk: 0.12, arm: 0.3, bulge: 0.04, bar: 0.04, halo: 1 },
  clusterFraction: 0.05,
  hiiFraction: 0.05,
  clusterLight: 0.15,
  hiiLight: 0.2,
  fieldSigmaLy: [40, 160],
  clusterSigmaLy: [8, 25],
  hiiSigmaLy: [30, 90],
  fluxIndex: 2.2,
  fluxMax: 40,
  bulgeK: 4300,
  diskK: 5600,
  thickK: 4900,
  youngK: 12_000,
  innerYoungK: 5200,
  gradientLy: 25_000,
  saturation: 1.5,
  kneeLight: Number.POSITIVE_INFINITY,
  kneeGamma: 1,
};

export interface GalaxyParticleData {
  readonly count: number;
  /** count×3 galactic positions (ly). */
  readonly positions: Float32Array;
  /** count×3 peak radiance per unit emission scale (linear RGB). */
  readonly radiance: Float32Array;
  /** count Gaussian σ (ly). */
  readonly sigma: Float32Array;
  /** count PARTICLE_KIND values (float: a vertex attribute). */
  readonly kind: Float32Array;
}

/** Pink Hα palette (linear sRGB): HII regions range from red to magenta ([OIII] + Hβ). */
const HII_COLORS: readonly (readonly [number, number, number])[] = [
  [1, 0.3, 0.46],
  [1, 0.22, 0.3],
  [0.95, 0.36, 0.68],
];

/** Truncated Pareto variate with mean ≈ 1 before truncation. */
function paretoFlux(rng: Rng, index: number, max: number): number {
  const xm = (index - 1) / index;
  const u = 1 - rng.next(); // (0, 1]
  return Math.min(max, xm * u ** (-1 / index));
}

function logUniform(rng: Rng, range: readonly [number, number]): number {
  return range[0] * (range[1] / range[0]) ** rng.next();
}

/** Arm σ(R) as in the structure (README "Arms"). */
function armSigma(structure: GalaxyStructure, r: number): number {
  const g = structure.gpu;
  return g.armSigma0Ly * (0.6 + (0.4 * r) / g.armSigmaRefLy);
}

/**
 * An arm position whose signed ridge offset d (ly, > 0 = concave side) is near `offset`·σ, with
 * spread `width`·σ — rejection sampling with at most `tries` draws (the last one is kept).
 */
function sampleNearRidge(
  structure: GalaxyStructure,
  rng: Rng,
  offset: number,
  width: number,
  out: [number, number, number],
  tries = 12,
): void {
  for (let i = 0; i < tries; i++) {
    structure.sampleComponent(rng, 'arm', out);
    const r = Math.hypot(out[0], out[2]);
    const sigma = armSigma(structure, r);
    const t = (structure.armOffset(out[0], out[2]) / sigma - offset) / width;
    if (rng.next() < Math.exp(-0.5 * t * t)) return;
  }
}

export function generateGalaxyParticles(
  structure: GalaxyStructure,
  count: number,
  options: ParticleOptions = DEFAULT_PARTICLE_OPTIONS,
): GalaxyParticleData {
  const n = Math.max(0, Math.floor(count));
  const nCluster = Math.floor(n * options.clusterFraction);
  const nHii = Math.floor(n * options.hiiFraction);
  const nField = n - nCluster - nHii;
  const positions = new Float32Array(n * 3);
  const radiance = new Float32Array(n * 3);
  const sigma = new Float32Array(n);
  const kind = new Float32Array(n);
  const flux = new Float64Array(n);
  // Highlight compression at each particle, exactly as the volume applies it to its emissivity.
  const compression = new Float64Array(n).fill(1);
  const compress = options.kneeGamma !== 1 && Number.isFinite(options.kneeLight);
  const g = structure.gpu;
  const root = createRng(structure.shape.seed).fork('galaxy-visual').fork('particles');
  const p: [number, number, number] = [0, 0, 0];

  const write = (i: number, x: number, y: number, z: number, s: number, k: number): void => {
    if (compress) {
      compression[i] = compressLight(structure.light(x, y, z), options.kneeLight, options.kneeGamma);
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    sigma[i] = s;
    kind[i] = k;
  };

  // ── Field particles: components mixed ∝ light × particle share; equal mean flux per particle.
  let budget = 0;
  const cumulative = new Float64Array(GALAXY_COMPONENTS.length);
  GALAXY_COMPONENTS.forEach((c, i) => {
    budget += structure.componentStars[c] * g.lightPerStar[c] * options.share[c];
    cumulative[i] = budget;
  });
  {
    const rng = root.fork('field');
    for (let i = 0; i < nField; i++) {
      const u = rng.next() * budget;
      let ci = 0;
      while (ci < cumulative.length - 1 && u >= (cumulative[ci] as number)) ci++;
      const component = GALAXY_COMPONENTS[ci] as GalaxyComponent;
      structure.sampleComponent(rng, component, p);
      // Radial population gradient, as in the volume: smoothstep(0, gradientLy, R).
      const outer = smoothstep(0, options.gradientLy, Math.hypot(p[0], p[2]));
      let tempK: number;
      switch (component) {
        case 'arm':
          // Young OB-rich light, with the odd red supergiant.
          tempK = rng.chance(0.08)
            ? rng.range(3500, 4300)
            : lerp(options.innerYoungK, options.youngK, outer) * Math.exp(rng.normal(0, 0.35));
          break;
        case 'bulge':
        case 'bar':
          tempK = options.bulgeK * Math.exp(rng.normal(0, 0.06));
          break;
        case 'halo':
          tempK = 4800 * Math.exp(rng.normal(0, 0.05));
          break;
        default:
          // Thick-disk stars (far from the midplane) are older and redder.
          tempK =
            (Math.abs(p[1]) > 1.5 * g.thinHeightLy
              ? options.thickK
              : lerp(options.bulgeK + 500, options.diskK, outer)) * Math.exp(rng.normal(0, 0.08));
      }
      populationColorInto(clamp(tempK, 2500, 40_000), options.saturation, radiance, i * 3);
      write(i, p[0], p[1], p[2], logUniform(rng, options.fieldSigmaLy), PARTICLE_KIND.field);
      flux[i] = paretoFlux(rng, options.fluxIndex, options.fluxMax);
    }
  }


  // ── Clumped knots: clusters and HII regions beaded along the arms.
  const armLight = structure.componentStars.arm * g.lightPerStar.arm;
  const clumps = (
    label: string,
    start: number,
    total: number,
    k: number,
    ridgeOffset: number,
    ridgeWidth: number,
    scatterLy: number,
    sigmaRange: readonly [number, number],
    color: (rng: Rng, i: number) => void,
  ): void => {
    const rng = root.fork(label);
    let i = start;
    const end = start + total;
    while (i < end) {
      sampleNearRidge(structure, rng, ridgeOffset, ridgeWidth, p);
      const cx = p[0];
      const cz = p[2];
      const knots = Math.min(end - i, 1 + Math.floor(rng.next() * rng.next() * 9));
      const clumpFlux = paretoFlux(rng, 1.8, 60);
      for (let j = 0; j < knots; j++, i++) {
        const x = cx + rng.normal(0, scatterLy);
        const z = cz + rng.normal(0, scatterLy);
        const y = rng.normal(0, 0.35 * g.armHeightLy);
        color(rng, i);
        write(i, x, y, z, logUniform(rng, sigmaRange), k);
        flux[i] = (clumpFlux * (0.3 + rng.next())) / knots;
      }
    }
  };
  clumps('clusters', nField, nCluster, PARTICLE_KIND.cluster, 0, 0.6, 140, options.clusterSigmaLy,
    (rng, i) => {
      populationColorInto(options.youngK * rng.range(1, 2.4), options.saturation, radiance, i * 3);
    });
  clumps('hii', nField + nCluster, nHii, PARTICLE_KIND.hii, 0.2, 0.35, 220, options.hiiSigmaLy,
    (rng, i) => {
      const c = HII_COLORS[rng.int(0, HII_COLORS.length - 1)] as readonly [number, number, number];
      const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      radiance[i * 3] = c[0] / lum;
      radiance[i * 3 + 1] = c[1] / lum;
      radiance[i * 3 + 2] = c[2] / lum;
    });

  // ── Normalise each kind's total flux to its light budget; store peak radiance Φ / (2πσ²).
  const totals: readonly (readonly [number, number, number])[] = [
    [0, nField, budget],
    [nField, nField + nCluster, options.clusterLight * armLight],
    [nField + nCluster, n, options.hiiLight * armLight],
  ];
  for (const [a, b, target] of totals) {
    let sum = 0;
    for (let i = a; i < b; i++) sum += flux[i] as number;
    const k = sum > 0 ? target / sum : 0;
    for (let i = a; i < b; i++) {
      const s = sigma[i] as number;
      const peak = ((flux[i] as number) * k * (compression[i] as number)) / (2 * Math.PI * s * s);
      radiance[i * 3] = (radiance[i * 3] as number) * peak;
      radiance[i * 3 + 1] = (radiance[i * 3 + 1] as number) * peak;
      radiance[i * 3 + 2] = (radiance[i * 3 + 2] as number) * peak;
    }
  }
  return { count: n, positions, radiance, sigma, kind };
}
