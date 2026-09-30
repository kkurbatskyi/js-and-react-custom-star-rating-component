/**
 * Planet appearance — deterministic mapping from a physical body (+ its star system + the
 * generator's `AppearanceHints`) to the parameters the surface shaders consume.
 *
 * Nothing here touches the GPU: the result is plain data (`PlanetLook`), so it is unit-tested and
 * reproducible. The hints stay the source of truth for base colours, ocean colour, night lights and
 * lava glow (a world must match its UI swatch); this module adds what the hints cannot say —
 * terrain character per world type, the zonal temperature profile (from obliquity, atmosphere and
 * tidal locking), ice lines that reproduce `iceCoverage`, a sea level that reproduces
 * `oceanCoverage`, vegetation colour adapted to the star's spectrum, gas-giant band structure and
 * storms, and the optical depth that reddens sunlight near the terminator.
 *
 * Determinism: every random choice comes from `createRng(body.seed).fork(label)`; new features must
 * use a new fork label so existing worlds never change.
 */
import { blackbodyRGB } from '../../core/color';
import { createRng } from '../../core/rng';
import type { BodyBase, RGB, Rng, StarSystem } from '../../core/types';

export type Vec3 = readonly [number, number, number];

// ─────────────────────────────────────────────────────────────── numeric helpers

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const luminance = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation, |relative error| < 1.2e-9).
 * Used to turn a coverage fraction into a threshold on a roughly Gaussian noise field.
 */
export function probit(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ] as const;
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ] as const;
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ] as const;
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
  ] as const;
  const pLow = 0.02425;
  if (q < pLow) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (
      (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
      ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
    );
  }
  if (q > 1 - pLow) {
    const r = Math.sqrt(-2 * Math.log(1 - q));
    return -(
      (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
      ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
    );
  }
  const r = q - 0.5;
  const s = r * r;
  return (
    ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) /
    (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
  );
}

/**
 * Standard deviation of the shader's continental field (an 8-octave domain-warped simplex fBm,
 * `terrain.glsl.ts`). Measured on the GPU with `dev/planet.html?debug=hist`; the field is close to
 * Gaussian, so `sea = σ · Φ⁻¹(oceanCoverage)` puts the requested fraction of the globe under water.
 */
export const CONTINENT_SIGMA = 0.22;
/** "No liquid" sentinel for the sea level (far below any terrain value). */
export const NO_SEA = -9;

/** Sea level (in continental-field units) that leaves `oceanCoverage` of the globe submerged. */
export function seaLevelForCoverage(oceanCoverage: number): number {
  if (oceanCoverage <= 0.001) return NO_SEA;
  if (oceanCoverage >= 0.999) return 9;
  return CONTINENT_SIGMA * probit(oceanCoverage);
}

// ─────────────────────────────────────────────────────────────── vegetation & atmosphere

/**
 * Photosynthetic pigments adapt to the star's spectrum (Kiang et al. 2007, Astrobiology 7:252):
 * red dwarfs favour broadband absorbers (black/purple), K stars deep red-brown, G green,
 * F blue-green, A/late-B yellow-orange. Linear sRGB anchors by effective temperature.
 */
const VEGETATION_BY_TEMPERATURE: readonly (readonly [number, RGB])[] = [
  [2600, [0.03, 0.012, 0.045]],
  [3700, [0.05, 0.016, 0.055]],
  [4400, [0.115, 0.038, 0.022]],
  [5200, [0.1, 0.085, 0.022]],
  [5800, [0.045, 0.115, 0.028]],
  [6800, [0.03, 0.115, 0.078]],
  [8000, [0.13, 0.14, 0.03]],
  [10000, [0.16, 0.13, 0.04]],
];

/** Vegetation colour (linear sRGB) for a star of the given effective temperature. */
export function vegetationColorForStar(temperatureK: number): RGB {
  const t = VEGETATION_BY_TEMPERATURE;
  const first = t[0];
  const last = t[t.length - 1];
  if (!first || !last) return [0.045, 0.115, 0.028];
  if (temperatureK <= first[0]) return first[1];
  if (temperatureK >= last[0]) return last[1];
  for (let i = 1; i < t.length; i++) {
    const hi = t[i];
    const lo = t[i - 1];
    if (hi && lo && temperatureK <= hi[0])
      return mix(lo[1], hi[1], (temperatureK - lo[0]) / (hi[0] - lo[0]));
  }
  return last[1];
}

const isEarthGreen = (c: RGB): boolean => c[1] > c[0] * 1.35 && c[1] > c[2] * 1.35;

/** Zenith optical depth per RGB channel of a clear Rayleigh atmosphere at 1 atm (Earth, ~1 bar/g). */
const RAYLEIGH_TAU: RGB = [0.05, 0.098, 0.219];

export interface AtmosphereOptics {
  /** Surface pressure (atm); 0 = airless. */
  pressureAtm: number;
  /** Zenith optical depth per channel: direct sunlight is multiplied by exp(−τ · airmass). */
  sunTau: RGB;
  /** Colour of the scattered skylight that fills shadows and the twilight zone (linear, ≤ 1). */
  skyColor: RGB;
  /** Fraction of direct sunlight that reappears as diffuse skylight. */
  ambient: number;
  /** Terminator softness: how far past the geometric terminator diffuse light reaches (Lambert wrap). */
  wrap: number;
}

/** Sunlight extinction and skylight for a body's atmosphere (see module doc). */
export function atmosphereOptics(body: BodyBase): AtmosphereOptics {
  const atm = body.atmosphere;
  const p = atm?.surfacePressureAtm ?? 0;
  if (!atm || p < 0.004) {
    return { pressureAtm: 0, sunTau: [0, 0, 0], skyColor: [0, 0, 0], ambient: 0, wrap: 0 };
  }
  const haze = body.appearance.hazeColor ?? [0.32, 0.56, 1];
  const hmax = Math.max(haze[0], haze[1], haze[2], 1e-3);
  const blueish = haze[2] >= haze[0] * 1.6 && haze[2] >= haze[1];
  // Column mass ∝ P/g; the per-mass Rayleigh cross-section grows for heavy gases (CO₂ ≈ 1.7×).
  const co2 = atm.composition.find((c) => c.gas === 'CO₂')?.fraction ?? 0;
  const column = Math.min(6, (p / Math.max(0.25, body.surfaceGravityG)) * (1 + 0.7 * co2));
  let tau: RGB;
  if (blueish) {
    tau = scale(RAYLEIGH_TAU, column);
  } else {
    // Dust/tholin/sulphur hazes absorb the blue: transmitted light takes the haze's own tint.
    const k = Math.min(1.6, 0.35 + 0.5 * Math.log10(1 + 4 * p));
    tau = [
      -Math.log(Math.max(haze[0] / hmax, 0.02)) * k * 0.6,
      -Math.log(Math.max(haze[1] / hmax, 0.02)) * k * 0.6,
      -Math.log(Math.max(haze[2] / hmax, 0.02)) * k * 0.6,
    ];
  }
  const sky: RGB = [haze[0] / hmax, haze[1] / hmax, haze[2] / hmax];
  const thick = 1 - Math.exp(-p);
  return {
    pressureAtm: p,
    sunTau: tau,
    skyColor: sky,
    ambient: 0.05 + 0.13 * thick,
    wrap: 0.06 + 0.24 * Math.min(1, Math.log10(1 + 9 * p)),
  };
}

// ─────────────────────────────────────────────────────────────── climate

/** Number of entries in the temperature look-up table (0 = equator/substellar … last = pole/antistellar). */
export const CLIMATE_LUT_SIZE = 17;

/**
 * Annual-mean insolation at latitude φ for obliquity ε on a circular orbit, normalised so its
 * area-weighted global mean is 1 (numerical integration of the daily-mean insolation
 * Q = (1/π)(h0 sinφ sinδ + cosφ cosδ sin h0), cos h0 = −tanφ tanδ, over a year of declinations).
 */
export function annualInsolation(latRad: number, obliquityRad: number): number {
  const eps = Math.abs(obliquityRad) % Math.PI;
  const steps = 48;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const lambda = ((i + 0.5) / steps) * 2 * Math.PI;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    sum += dailyInsolation(latRad, dec);
  }
  return sum / steps;
}

function dailyInsolation(lat: number, dec: number): number {
  const x = -Math.tan(lat) * Math.tan(dec);
  const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
  return (
    (h0 * Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.sin(h0)) / Math.PI
  );
}

/** Normalised (global mean = 1) insolation table over |latitude| = i/(n−1)·90°, or substellar angle for locked worlds. */
export function insolationProfile(
  obliquityRad: number,
  locked: boolean,
  n = CLIMATE_LUT_SIZE,
): number[] {
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * (Math.PI / 2);
    // Locked: coordinate is the angle from the substellar point (0 → π), half-range here.
    raw.push(
      locked
        ? Math.max(Math.cos(i === 0 ? 0 : (i / (n - 1)) * Math.PI), 0)
        : annualInsolation(a, obliquityRad),
    );
  }
  // Area-weighted mean over the sphere. Latitude i spans a band of weight cos(φ) (both hemispheres
  // are equal); the locked profile is a function of the polar angle from the substellar axis: weight sin θ.
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const w = locked ? Math.sin((i / (n - 1)) * Math.PI) : Math.cos((i / (n - 1)) * (Math.PI / 2));
    num += (raw[i] ?? 0) * w;
    den += w;
  }
  const mean = den > 0 && num > 0 ? num / den : 1;
  return raw.map((v) => v / mean);
}

/**
 * Zonal mean surface temperature (K) by |latitude| (or by substellar angle for tidally locked
 * planets). Thin atmospheres re-radiate locally (T ∝ Q^¼); thick ones redistribute heat, shrinking the
 * equator-to-pole gradient (≈ 64 K per unit insolation at 1 atm, after Earth). The table's
 * area-weighted mean is `body.surfaceTempK`.
 */
export function temperatureProfile(
  body: Pick<BodyBase, 'surfaceTempK' | 'axialTiltRad' | 'atmosphere'>,
  locked: boolean,
  n = CLIMATE_LUT_SIZE,
): number[] {
  const q = insolationProfile(body.axialTiltRad, locked, n);
  const p = body.atmosphere?.surfacePressureAtm ?? 0;
  const tMean = Math.max(3, body.surfaceTempK);
  let t: number[];
  if (p < 0.02) {
    t = q.map((v) => Math.max(v, 0) ** 0.25);
    // Radiative bodies: shift so the weighted mean matches the mean temperature.
    const k = tMean / weightedMean(t, locked);
    t = t.map((v) => v * k);
  } else {
    const delta = Math.min(200, Math.max(10, 64 / Math.sqrt(p)));
    t = q.map((v) => tMean + delta * (v - 1));
  }
  return t;
}

function weightedMean(values: readonly number[], locked: boolean): number {
  const n = values.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const w = locked ? Math.sin((i / (n - 1)) * Math.PI) : Math.cos((i / (n - 1)) * (Math.PI / 2));
    num += (values[i] ?? 0) * w;
    den += w;
  }
  return den > 0 ? num / den : 1;
}

/**
 * Temperature below which the surface is ice so that the ice-covered area fraction equals
 * `coverage`: the coverage-quantile of the area-weighted zonal temperature distribution.
 */
export function iceThresholdK(
  profile: readonly number[],
  locked: boolean,
  coverage: number,
): number {
  if (coverage <= 0) return -1;
  if (coverage >= 1) return 1e6;
  const n = profile.length;
  const bands = profile.map((t, i) => ({
    t,
    w: locked ? Math.sin((i / (n - 1)) * Math.PI) : Math.cos((i / (n - 1)) * (Math.PI / 2)),
  }));
  bands.sort((a, b) => a.t - b.t);
  const total = bands.reduce((s, b) => s + b.w, 0);
  let acc = 0;
  for (const b of bands) {
    acc += b.w / total;
    if (acc >= coverage) return b.t + 0.5;
  }
  return (bands[bands.length - 1]?.t ?? 0) + 1;
}

// ─────────────────────────────────────────────────────────────── looks

export type RockyStyle = 'biome' | 'regolith' | 'desert' | 'icy' | 'volcanic' | 'dwarf';
/** Numeric ids of `RockyStyle` for the shaders. */
export const STYLE_ID: Readonly<Record<RockyStyle, number>> = {
  biome: 0,
  regolith: 1,
  desert: 2,
  icy: 3,
  volcanic: 4,
  dwarf: 5,
};

export type LiquidKind = 'water' | 'hydrocarbon' | 'magma';
export const LIQUID_ID: Readonly<Record<LiquidKind, number>> = {
  water: 0,
  hydrocarbon: 1,
  magma: 2,
};
export type EmissiveKind = 'none' | 'city' | 'lava';
export const EMISSIVE_ID: Readonly<Record<EmissiveKind, number>> = { none: 0, city: 1, lava: 2 };

export interface TerrainParams {
  contScale: number;
  warp: number;
  /** Sea level in continental-field units (`NO_SEA` when there is no liquid). */
  sea: number;
  contAmp: number;
  mountains: number;
  hills: number;
  craters: number;
  /** Radius (radians) of the largest craters. */
  craterSize: number;
  mare: number;
  rifts: number;
  volcanoes: number;
  lineae: number;
  chaos: number;
  /** Radius fraction per unit of normalised height: converts height gradients to surface slopes. */
  relief: number;
  /** 1 → bias the liquid basin towards the substellar point (+X) of a tidally locked world. */
  eyeball: number;
}

export interface OceanLook {
  deep: RGB;
  shallow: RGB;
  liquid: LiquidKind;
  /** GGX roughness α of the open surface (0.04 glassy … 0.25 storm-tossed). */
  roughness: number;
}

export interface RockyLook {
  readonly family: 'rocky';
  readonly style: RockyStyle;
  /** Noise-domain offset shared by bake and runtime detail. */
  readonly seed: Vec3;
  readonly terrain: TerrainParams;
  /** Surface colours (linear): c0 dominant … c3, adapted where the hints leave roles open. */
  readonly colors: {
    c0: RGB;
    c1: RGB;
    c2: RGB;
    c3: RGB;
    vegetation: RGB;
    /** 0 none, ~0.25 microbial mats, 1 full vegetation. */
    vegAmount: number;
    snow: RGB;
    sand: RGB;
    seabed: RGB;
  };
  readonly climate: {
    lut: readonly number[];
    locked: boolean;
    iceTempK: number;
    /** Temperature lapse (K) from sea level to the highest terrain. */
    lapseK: number;
  };
  readonly ocean: OceanLook | null;
  readonly emissive: { kind: EmissiveKind; strength: number };
  readonly optics: AtmosphereOptics;
  /** 1 → Lommel–Seeliger/lunar-Lambert reflectance (airless regolith), 0 → Oren–Nayar. */
  readonly airlessBrdf: boolean;
  /** Oren–Nayar σ (radians) of the surface. */
  readonly roughness: number;
  /** Continental-field noise statistics used by the lite shader to place the coastline. */
  readonly cloudCoverage: number;
}

export interface GiantSpot {
  /** Latitude / longitude (radians) of the vortex centre; lon drifts with the local jet. */
  lat: number;
  lon: number;
  /** Angular radius of the core (radians). */
  size: number;
  /** Swirl strength (radians of twist at the centre). */
  swirl: number;
  color: RGB;
  /** Colour mix weight 0..1. */
  tint: number;
}

export interface GiantLook {
  readonly family: 'giant';
  readonly seed: Vec3;
  /** Band colours, dark → light. */
  readonly colors: RGB[];
  /** Latitudinal frequency scale of the banding (cycles per radian of latitude). */
  readonly bandFreq: number;
  readonly contrast: number;
  readonly turbulence: number;
  /** Peak zonal wind, radians of longitude per day in the body frame. */
  readonly jetSpeed: number;
  readonly spots: GiantSpot[];
  readonly hexagon: boolean;
  readonly polarTint: RGB;
  /** 0..1 bright elongated cirrus streaks (ice giants). */
  readonly streaks: number;
  /** Thermal emission (hot Jupiters): colour × strength on the night side, dayGlow on the day side. */
  readonly glow: { color: RGB; strength: number; dayGlow: number };
  readonly limb: number;
  readonly wrap: number;
  readonly haze: RGB;
}

export type PlanetLook = RockyLook | GiantLook;

function seedVector(rng: Rng): Vec3 {
  return [rng.range(3, 60), rng.range(3, 60), rng.range(3, 60)];
}

/** True for worlds drawn by the gas-giant shader. */
export function isGiantBody(body: Pick<BodyBase, 'type'>): boolean {
  return body.type === 'gas-giant' || body.type === 'ice-giant';
}

/** Colour of the star seen from the body: a hot-Jupiter's glow is tinted by nothing but its own temperature. */
export function thermalGlowColor(temperatureK: number): RGB {
  return blackbodyRGB(Math.min(Math.max(temperatureK, 1000), 4000));
}

/** Derive everything a surface shader needs. Pure and deterministic. */
export function deriveLook(body: BodyBase, system: StarSystem | null): PlanetLook {
  return isGiantBody(body) ? deriveGiantLook(body) : deriveRockyLook(body, system);
}

// ─────────────────────────────────────────────────────────────── rocky worlds

const ICE_COLOR: RGB = [0.82, 0.85, 0.9];
const SAND_COLOR: RGB = [0.36, 0.3, 0.2];

function styleFor(body: BodyBase): RockyStyle {
  switch (body.type) {
    case 'terran':
    case 'ocean':
      return 'biome';
    case 'barren':
      return 'regolith';
    case 'desert':
    case 'hothouse':
      return 'desert';
    case 'ice':
      return 'icy';
    case 'lava':
      return 'volcanic';
    default:
      return 'dwarf';
  }
}

function terrainFor(body: BodyBase, locked: boolean, rng: Rng): TerrainParams {
  const cr = clamp01(body.craterDensity);
  const vol = clamp01(body.volcanism);
  const base: TerrainParams = {
    contScale: rng.range(1.15, 1.75),
    warp: rng.range(0.25, 0.5),
    sea: seaLevelForCoverage(body.oceanCoverage),
    contAmp: 1,
    mountains: 0.2,
    hills: 0.3,
    craters: 0,
    craterSize: 0.32,
    mare: 0,
    rifts: 0,
    volcanoes: 0,
    lineae: 0,
    chaos: 0,
    relief: 0.012,
    eyeball: locked && body.oceanCoverage > 0.02 ? 1 : 0,
  };
  switch (body.type) {
    case 'terran':
      return {
        ...base,
        mountains: 0.95,
        hills: 0.7,
        craters: cr * 0.25,
        volcanoes: vol * 0.3,
        relief: 0.007,
      };
    case 'ocean':
      return {
        ...base,
        contScale: rng.range(1.5, 2.2),
        mountains: 0.6,
        hills: 0.5,
        volcanoes: 0.35,
        relief: 0.008,
      };
    case 'desert':
      return {
        ...base,
        contAmp: 0.8,
        mountains: 0.45,
        hills: 0.6,
        craters: cr * 0.8,
        craterSize: 0.28,
        rifts: vol > 0.03 ? 0.7 : 0.25,
        volcanoes: 0.35 + vol * 0.9,
        relief: 0.02,
      };
    case 'hothouse':
      return {
        ...base,
        contAmp: 0.8,
        mountains: 0.7,
        hills: 0.5,
        craters: 0.05,
        volcanoes: 0.4 + vol,
        relief: 0.02,
      };
    case 'barren':
      return {
        ...base,
        contAmp: 0.3,
        mountains: 0.12,
        hills: 0.25,
        craters: cr,
        craterSize: 0.34,
        mare: clamp01(0.15 + vol * 2.5) * (0.4 + 0.6 * cr),
        relief: 0.024,
      };
    case 'dwarf':
      return {
        ...base,
        contAmp: 0.4,
        mountains: 0.25,
        hills: 0.35,
        craters: cr * 0.9,
        craterSize: 0.3,
        relief: 0.03,
      };
    case 'ice':
      return {
        ...base,
        contAmp: 0.25,
        mountains: 0.08,
        hills: 0.18,
        craters: cr * 0.6,
        craterSize: 0.22,
        lineae: 0.9,
        chaos: 0.6,
        volcanoes: 0,
        relief: 0.009,
      };
    case 'lava':
      return {
        ...base,
        contAmp: 0.7,
        mountains: 0.55,
        hills: 0.5,
        craters: cr * 0.5,
        craterSize: 0.22,
        volcanoes: 0.6 + vol * 0.8,
        relief: 0.03,
      };
    default:
      return base;
  }
}

function deriveRockyLook(body: BodyBase, system: StarSystem | null): RockyLook {
  const rng = createRng(body.seed).fork('planet-look');
  const a = body.appearance;
  const style = styleFor(body);
  const isPlanet = system ? system.planets.some((p) => p.id === body.id) : true;
  const locked =
    body.tidallyLocked && isPlanet && (body.oceanCoverage > 0.02 || body.type === 'lava');
  const terrain = terrainFor(body, locked, rng.fork('terrain'));

  // ── colours ────────────────────────────────────────────────────────────
  const sc = a.surfaceColors.length > 0 ? a.surfaceColors : [a.swatch];
  const pick = (i: number, fallback: RGB): RGB => sc[Math.min(i, sc.length - 1)] ?? fallback;
  const vegetated = (body.type === 'terran' || body.type === 'ocean') && body.life !== 'none';
  const starT = system?.star.temperatureK ?? 5800;
  let vegetation: RGB = [0, 0, 0];
  let vegAmount = 0;
  let c0 = pick(0, a.swatch);
  let c1 = pick(1, c0);
  let c2 = pick(2, c1);
  let c3 = pick(3, c2);
  let snow: RGB = ICE_COLOR;
  if (vegetated) {
    // Mock/generator order for living worlds: vegetation, soil, sand, bare rock, (ice).
    vegetation = c0;
    if (isEarthGreen(c0)) {
      const adapted = vegetationColorForStar(starT);
      const k = luminance(c0) / Math.max(luminance(adapted), 1e-3);
      vegetation = scale(adapted, Math.min(2.2, Math.max(0.6, k)));
    }
    vegAmount = body.life === 'microbial' ? 0.25 : 1;
    const soil = c1;
    const sand = c2;
    c0 = soil;
    c1 = sand;
    c2 = c3;
    c3 = mix(c3, soil, 0.5);
    const last = sc[sc.length - 1];
    if (sc.length >= 5 && last) snow = last;
  } else if (body.life === 'microbial' && (body.type === 'terran' || body.type === 'ocean')) {
    vegetation = vegetationColorForStar(starT);
    vegAmount = 0.2;
  }
  if (!vegetated) {
    const last = sc[sc.length - 1];
    if (sc.length >= 4 && last && luminance(last) > 0.6 && last[2] >= last[0]) snow = last;
  }

  // ── climate ───────────────────────────────────────────────────────────
  const lut = temperatureProfile(body, locked);
  const iceCover = body.type === 'ice' || body.type === 'dwarf' ? 0 : body.iceCoverage;
  const iceTempK = iceThresholdK(lut, locked, iceCover);

  // ── ocean ─────────────────────────────────────────────────────────────
  let ocean: OceanLook | null = null;
  if (a.oceanColor && body.oceanCoverage > 0.001) {
    const liquid: LiquidKind =
      body.type === 'lava' || body.surfaceTempK > 800
        ? 'magma'
        : body.surfaceTempK < 200
          ? 'hydrocarbon'
          : 'water';
    const deep = a.oceanColor;
    const shallow: RGB =
      liquid === 'water'
        ? [
            Math.min(0.22, deep[0] * 1.7 + 0.018),
            Math.min(0.45, deep[1] * 2.6 + 0.06),
            Math.min(0.5, deep[2] * 1.5 + 0.05),
          ]
        : liquid === 'hydrocarbon'
          ? scale(deep, 1.8)
          : [Math.min(1, deep[0] * 1.4), Math.min(1, deep[1] * 2.2), Math.min(1, deep[2] * 2)];
    const thin = (body.atmosphere?.surfacePressureAtm ?? 0) < 0.05;
    ocean = {
      deep,
      shallow,
      liquid,
      roughness:
        liquid === 'hydrocarbon'
          ? 0.045
          : liquid === 'magma'
            ? 0.12
            : thin
              ? 0.08
              : rng.range(0.11, 0.17),
    };
  }

  // ── emissive ──────────────────────────────────────────────────────────
  let emissive: RockyLook['emissive'] = { kind: 'none', strength: 0 };
  if (a.lavaGlow > 0.01) emissive = { kind: 'lava', strength: a.lavaGlow };
  else if (a.nightLights > 0.01) emissive = { kind: 'city', strength: a.nightLights };

  const optics = atmosphereOptics(body);
  const airless = optics.pressureAtm === 0;
  const seed = seedVector(rng.fork('seed'));

  return {
    family: 'rocky',
    style,
    seed,
    terrain,
    colors: {
      c0,
      c1,
      c2,
      c3,
      vegetation,
      vegAmount,
      snow,
      sand: body.type === 'terran' || body.type === 'ocean' ? mix(SAND_COLOR, c1, 0.35) : c1,
      seabed: mix(SAND_COLOR, c1, 0.25),
    },
    climate: {
      lut,
      locked,
      iceTempK,
      lapseK: body.type === 'terran' || body.type === 'ocean' ? 14 : 20,
    },
    ocean,
    emissive,
    optics,
    airlessBrdf: airless,
    roughness: airless ? 0.55 : 0.4,
    cloudCoverage: a.cloudCoverage,
  };
}

// ─────────────────────────────────────────────────────────────── gas & ice giants

function deriveGiantLook(body: BodyBase): GiantLook {
  const rng = createRng(body.seed).fork('giant-look');
  const a = body.appearance;
  const ice = body.type === 'ice-giant';
  const cls = body.sudarskyClass ?? 'I';
  const sorted = [...(a.surfaceColors.length > 0 ? a.surfaceColors : [a.swatch])].sort(
    (x, y) => luminance(x) - luminance(y),
  );
  const colors =
    sorted.length >= 2
      ? sorted
      : [scale(sorted[0] ?? a.swatch, 0.8), scale(sorted[0] ?? a.swatch, 1.15)];

  // Banding character by world class (Jupiter/Saturn vs Neptune/Uranus vs hot Jupiters).
  let contrast = 0.75;
  let turbulence = 0.7;
  let bandFreq = rng.range(5.5, 8.5);
  let spotCount = rng.int(1, 3);
  let streaks = 0;
  if (ice) {
    contrast = rng.range(0.14, 0.24);
    turbulence = 0.32;
    bandFreq = rng.range(2.2, 3.8);
    spotCount = rng.chance(0.45) ? 1 : 0;
    streaks = rng.range(0.35, 0.75);
  } else if (cls === 'II') {
    contrast = 0.32;
    turbulence = 0.5;
    bandFreq = rng.range(3.5, 5.5);
  } else if (cls === 'III') {
    contrast = 0.2;
    turbulence = 0.35;
    bandFreq = rng.range(2.5, 4.5);
    spotCount = rng.chance(0.4) ? 1 : 0;
  } else if (cls === 'IV' || cls === 'V') {
    contrast = 0.3;
    turbulence = 0.55;
    bandFreq = rng.range(3, 5);
    spotCount = rng.int(0, 2);
  }

  const light = colors[colors.length - 1] ?? a.swatch;
  const dark = colors[0] ?? a.swatch;
  const spots: GiantSpot[] = [];
  for (let i = 0; i < spotCount; i++) {
    const great = i === 0 && !ice && (cls === 'I' || cls === 'II');
    const lat = (rng.chance(0.75) ? -1 : 1) * rng.range(0.16, 0.5);
    const rust: RGB = mix(colors[Math.min(colors.length - 1, 2)] ?? dark, [0.75, 0.32, 0.16], 0.55);
    const color: RGB = ice ? scale(dark, 0.45) : great ? rust : mix(light, [1, 1, 1], 0.35);
    spots.push({
      lat,
      lon: rng.range(0, Math.PI * 2),
      size: great ? rng.range(0.16, 0.24) : ice ? rng.range(0.12, 0.2) : rng.range(0.04, 0.1),
      swirl: rng.range(1.6, 3.4) * (lat < 0 ? 1 : -1),
      color,
      tint: great ? 0.7 : ice ? 0.75 : 0.5,
    });
  }

  const hot = body.surfaceTempK > 900 || cls === 'IV' || cls === 'V';
  const glowT = Math.min(3200, Math.max(1100, body.surfaceTempK * (cls === 'V' ? 1.2 : 1)));
  const heat = hot ? clamp01((body.surfaceTempK - 800) / 1800) : 0;

  return {
    family: 'giant',
    seed: seedVector(rng.fork('seed')),
    colors,
    bandFreq,
    contrast,
    turbulence,
    jetSpeed: rng.range(0.05, 0.16) * (ice ? 0.7 : 1),
    spots,
    hexagon: !ice && cls === 'I' && rng.chance(0.18),
    polarTint: ice ? mix(light, [0.6, 0.85, 0.95], 0.4) : mix(dark, [0.25, 0.32, 0.5], 0.5),
    streaks,
    glow: { color: thermalGlowColor(glowT), strength: heat * 0.9, dayGlow: heat * 0.5 },
    limb: ice ? 0.55 : 0.4,
    wrap: 0.28,
    haze: a.hazeColor ?? [0.8, 0.82, 0.95],
  };
}

// ─────────────────────────────────────────────────────────────── quality tables

import type { Quality } from '../contracts';

/** Cube-map bake resolution per face (docs/ARCHITECTURE.md §8). */
export const BAKE_SIZE: Readonly<Record<Quality, number>> = {
  low: 256,
  medium: 512,
  high: 1024,
  ultra: 1536,
};

/** Runtime detail-noise octaves near the surface, by quality. */
export const DETAIL_OCTAVES: Readonly<Record<Quality, number>> = {
  low: 2,
  medium: 3,
  high: 4,
  ultra: 5,
};

/** Sphere tessellation (segments around the equator) for the full surface mesh. */
export const SURFACE_SEGMENTS: Readonly<Record<Quality, number>> = {
  low: 96,
  medium: 128,
  high: 192,
  ultra: 256,
};
