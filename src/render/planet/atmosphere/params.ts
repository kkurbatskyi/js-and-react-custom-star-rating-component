/**
 * Atmosphere scattering parameters derived from a body's physical data and its `appearance` hints.
 *
 * The shell shader (atmosphere.glsl.ts) is a single-scattering raymarcher with three species:
 *
 *   Rayleigh  gas molecules. Zenith optical depth tau_R = tau_earth(rgb) * (P/g) * (F/F_air) with the
 *             per-mass scattering factor F = sum(f_i (n_i - 1)^2) / sum(f_i m_i)  (sigma ~ (n-1)^2 / N^2,
 *             column mass = P/g). Earth: tau = (0.046, 0.108, 0.265) at 1 atm, 1 g (Hillaire 2020, beta_R * 8 km).
 *   Mie       aerosols / dust / haze (Cornette-Shanks phase). Tinted by `appearance.hazeColor` for non-blue
 *             atmospheres; a partly absorbing blue channel makes tholin and dust hazes orange.
 *   Absorber  ozone on oxygen worlds (Chappuis band: the deep-blue twilight), methane on ice giants
 *             (red absorption: cyan limb). Laplace-shaped layer exp(-|h - c| / w).
 *
 * `hazeColor` stays the source of truth: it decides the atmosphere class (blue Rayleigh, dusty, hazy,
 * dense) and tints the aerosol; everything else follows from pressure, gravity, composition and scale
 * height. Giants get an inflated scale height (their real 30-60 km shell is well under a pixel).
 */
import { clamp, lerp } from '../../../core/math';
import type { BodyBase } from '../../../core/types';

export type Vec3T = readonly [number, number, number];

export type AtmosphereKind = 'terran' | 'dusty' | 'hazy' | 'dense' | 'gas-giant' | 'ice-giant';

export interface AtmosphereParams {
  kind: AtmosphereKind;
  /** Planet equatorial radius, km. */
  radiusKm: number;
  /** Modelled top of the atmosphere above the surface, km. */
  topKm: number;
  /** Molecular scattering; `beta` in 1/km at the surface (per RGB channel). */
  rayleigh: { beta: Vec3T; heightKm: number };
  /** Aerosol scattering/extinction (1/km at the surface), scale height, Cornette-Shanks asymmetry. */
  mie: { scatter: Vec3T; extinction: Vec3T; heightKm: number; g: number };
  /** Pure absorber (1/km at the layer's peak): ozone / methane. Zero beta = none. */
  absorber: { beta: Vec3T; centerKm: number; widthKm: number };
  /** Blend of the single-scattering phase towards isotropic: a cheap stand-in for multiple scattering. */
  multiScatter: number;
  /** Radiance scale for the in-scattered light (artistic knob, ~1). */
  gain: number;
  /** Total zenith extinction optical depth per channel (surface to top of atmosphere). */
  zenithTau: Vec3T;
}

/** Below this surface pressure the shell is skipped entirely. */
export const MIN_PRESSURE_ATM = 0.005;

/** Earth's zenith Rayleigh optical depth at 1 atm and 1 g, for the R, G, B primaries (Hillaire 2020). */
export const RAYLEIGH_TAU_EARTH: Vec3T = [0.0464, 0.1085, 0.2648];
/** Ozone: zenith absorption optical depth (Chappuis band peaks near 600 nm). */
const OZONE_TAU_EARTH: Vec3T = [0.0091, 0.0263, 0.0012];
/** Methane on an ice giant: red absorption, zenith optical depth above the visible deck. */
const METHANE_TAU: Vec3T = [0.1, 0.018, 0.0];

/** Column cap in Earth columns: thicker atmospheres are opaque anyway (the deck is drawn by the clouds). */
const COLUMN_MAX = 3;
/** Shell top in scale heights: density there is e^-8.5 = 2e-4 of the surface value. */
const TOP_IN_SCALE_HEIGHTS = 8.5;
/** Giants: visible glow is ~3 scale heights, so a real 30 km scale height would be sub-pixel. */
const GIANT_MIN_SCALE_HEIGHT = 0.0022;
/**
 * Artistic stretch of every gas scale height: the limb glow of a real photograph is taller than single
 * scattering with the true scale height predicts (multiple scattering, airglow, exposure), and a 1% R
 * shell is only ~2 px from far away.
 */
const VISUAL_HEIGHT_SCALE = 1.3;

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

/** "N₂" -> "N2". */
function gasKey(name: string): string {
  let out = '';
  for (const ch of name) {
    const i = SUBSCRIPTS.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

/** Refractivity (n - 1) x 1e4 at STP in visible light, molar mass g/mol. */
const GASES: Readonly<Record<string, { refr: number; mass: number }>> = {
  N2: { refr: 2.98, mass: 28.01 },
  O2: { refr: 2.65, mass: 32.0 },
  Ar: { refr: 2.81, mass: 39.95 },
  CO2: { refr: 4.5, mass: 44.01 },
  H2: { refr: 1.39, mass: 2.016 },
  He: { refr: 0.35, mass: 4.0 },
  CH4: { refr: 4.4, mass: 16.04 },
  NH3: { refr: 3.76, mass: 17.03 },
  H2O: { refr: 2.5, mass: 18.02 },
  SO2: { refr: 6.6, mass: 64.07 },
  Ne: { refr: 0.67, mass: 20.18 },
  CO: { refr: 3.4, mass: 28.01 },
};
const GAS_DEFAULT = { refr: 3.0, mass: 30 };

interface GasFraction {
  gas: string;
  fraction: number;
}

/** F = sum(f (n-1)^2) / sum(f m): Rayleigh optical depth per unit column mass (arbitrary units). */
function scatteringPerMass(composition: readonly GasFraction[]): number {
  let num = 0;
  let den = 0;
  for (const { gas, fraction } of composition) {
    const g = GASES[gasKey(gas)] ?? GAS_DEFAULT;
    num += fraction * g.refr * g.refr;
    den += fraction * g.mass;
  }
  return den > 0 ? num / den : 0;
}

const AIR_PER_MASS = scatteringPerMass([
  { gas: 'N2', fraction: 0.7808 },
  { gas: 'O2', fraction: 0.2095 },
  { gas: 'Ar', fraction: 0.0093 },
]);

/** Rayleigh optical depth of the body's column relative to Earth's (1 = Earth), before the visual cap. */
export function rayleighColumn(body: BodyBase): number {
  const atm = body.atmosphere;
  if (!atm) return 0;
  const rel = scatteringPerMass(atm.composition) / AIR_PER_MASS;
  return (atm.surfacePressureAtm / Math.max(body.surfaceGravityG, 0.05)) * rel;
}

function fractionOf(body: BodyBase, gas: string): number {
  return body.atmosphere?.composition.find((c) => gasKey(c.gas) === gas)?.fraction ?? 0;
}

function classify(body: BodyBase, blueness: number): AtmosphereKind {
  const p = body.atmosphere?.surfacePressureAtm ?? 0;
  if (body.type === 'gas-giant') return 'gas-giant';
  if (body.type === 'ice-giant') return 'ice-giant';
  if (p >= 6) return 'dense';
  if (blueness < -0.25) return p >= 0.6 ? 'hazy' : 'dusty';
  return 'terran';
}

/** Integral of exp(-|h - c| / w) over [0, top]. */
function laplaceColumn(c: number, w: number, top: number): number {
  if (c <= 0) return w * (1 - Math.exp(-top / w));
  return w * (2 - Math.exp(-c / w) - Math.exp(-Math.max(top - c, 0) / w));
}

/** Total zenith extinction optical depth per channel. */
function zenithTauOf(p: Omit<AtmosphereParams, 'zenithTau'>): Vec3T {
  const top = p.topKm;
  const colR = p.rayleigh.heightKm * (1 - Math.exp(-top / p.rayleigh.heightKm));
  const colM = p.mie.heightKm * (1 - Math.exp(-top / p.mie.heightKm));
  const colA = laplaceColumn(p.absorber.centerKm, p.absorber.widthKm, top);
  const t = (c: 0 | 1 | 2): number =>
    p.rayleigh.beta[c] * colR + p.mie.extinction[c] * colM + p.absorber.beta[c] * colA;
  return [t(0), t(1), t(2)];
}

/**
 * Derive the scattering model of a body's atmosphere, or null when it has none worth drawing
 * (airless, negligible pressure, no haze colour).
 */
export function deriveAtmosphere(body: BodyBase): AtmosphereParams | null {
  const atm = body.atmosphere;
  const hazeColor = body.appearance.hazeColor;
  if (!atm || !hazeColor || atm.surfacePressureAtm < MIN_PRESSURE_ATM) return null;

  const R = body.radiusKm;
  const hmax = Math.max(hazeColor[0], hazeColor[1], hazeColor[2], 1e-3);
  const tint: Vec3T = [hazeColor[0] / hmax, hazeColor[1] / hmax, hazeColor[2] / hmax];
  const kind = classify(body, tint[2] - tint[0]);
  const giant = kind === 'gas-giant' || kind === 'ice-giant';

  const rawH = Number.isFinite(atm.scaleHeightKm) ? atm.scaleHeightKm : 8;
  const H = Math.max(
    rawH * VISUAL_HEIGHT_SCALE,
    giant ? GIANT_MIN_SCALE_HEIGHT * R : 0.0004 * R,
    0.5,
  );
  const column = clamp(rayleighColumn(body), 0, kind === 'dense' ? 1.2 : COLUMN_MAX);
  const rayleigh = {
    beta: [
      (RAYLEIGH_TAU_EARTH[0] * column) / H,
      (RAYLEIGH_TAU_EARTH[1] * column) / H,
      (RAYLEIGH_TAU_EARTH[2] * column) / H,
    ] as Vec3T,
    heightKm: H,
  };

  // Aerosol class table: zenith optical depth, scale height (in gas scale heights), asymmetry, blend of
  // the tint towards white, absorption strength, multiple-scattering blend.
  const clouds = clamp(body.appearance.cloudCoverage, 0, 1);
  const table: Record<
    AtmosphereKind,
    {
      tau: number;
      height: number;
      g: number;
      white: number;
      absorb: number;
      ms: number;
      gain: number;
    }
  > = {
    terran: {
      tau: 0.06 + 0.05 * clouds,
      height: 0.25,
      g: 0.76,
      white: 0.85,
      absorb: 0.05,
      ms: 0.35,
      gain: 2.3,
    },
    dusty: { tau: 0.22, height: 1.0, g: 0.62, white: 0.0, absorb: 1.2, ms: 0.3, gain: 1.3 },
    hazy: { tau: 2.6, height: 1.5, g: 0.55, white: 0.0, absorb: 3.0, ms: 0.5, gain: 4.5 },
    // The visible deck of a dense world is its cloud layer (drawn separately): only the haze above it is modelled.
    dense: { tau: 0.6, height: 1.0, g: 0.5, white: 0.15, absorb: 1.0, ms: 0.6, gain: 2.0 },
    'gas-giant': { tau: 0.7, height: 1.2, g: 0.5, white: 0.5, absorb: 0.3, ms: 0.35, gain: 1.8 },
    'ice-giant': { tau: 0.3, height: 1.2, g: 0.5, white: 0.2, absorb: 0.3, ms: 0.35, gain: 1.8 },
  };
  const a = table[kind];
  const mieHeight = Math.max(a.height * H, 0.4);
  const mieTint: Vec3T = [
    lerp(tint[0], 1, a.white),
    lerp(tint[1], 1, a.white),
    lerp(tint[2], 1, a.white),
  ];
  // The scattered colour follows the haze colour; the weak channels are additionally absorbed
  // (tholin and dust are dark in the blue), so sunlight through the haze turns orange, not grey.
  const scat = (c: 0 | 1 | 2): number => (a.tau * mieTint[c]) / mieHeight;
  const ext = (c: 0 | 1 | 2): number => scat(c) + (a.tau * a.absorb * (1 - mieTint[c])) / mieHeight;
  const mie = {
    scatter: [scat(0), scat(1), scat(2)] as Vec3T,
    extinction: [ext(0), ext(1), ext(2)] as Vec3T,
    heightKm: mieHeight,
    g: a.g,
  };

  // Absorber: ozone on oxygen worlds, methane on ice giants.
  let absorber: AtmosphereParams['absorber'] = { beta: [0, 0, 0], centerKm: 0, widthKm: 1 };
  const o2 = fractionOf(body, 'O2');
  if (!giant && o2 >= 0.05 && kind !== 'dense') {
    const w = 0.85 * H;
    const k = clamp(o2 / 0.21, 0, 1.5) / (2 * w);
    absorber = {
      beta: [OZONE_TAU_EARTH[0] * k, OZONE_TAU_EARTH[1] * k, OZONE_TAU_EARTH[2] * k],
      centerKm: 3.05 * H,
      widthKm: w,
    };
  } else if (kind === 'ice-giant') {
    const k = clamp(fractionOf(body, 'CH4') / 0.028, 0.3, 2) / H;
    absorber = {
      beta: [METHANE_TAU[0] * k, METHANE_TAU[1] * k, METHANE_TAU[2] * k],
      centerKm: 0,
      widthKm: H,
    };
  }

  // Cover the gas, the aerosol and (four widths above its centre) the absorber layer.
  const top = Math.min(
    Math.max(
      TOP_IN_SCALE_HEIGHTS * Math.max(H, mieHeight),
      absorber.centerKm + 4 * absorber.widthKm,
    ),
    0.2 * R,
  );
  const partial = {
    kind,
    radiusKm: R,
    topKm: top,
    rayleigh,
    mie,
    absorber,
    multiScatter: a.ms,
    gain: a.gain,
  };
  return { ...partial, zenithTau: zenithTauOf(partial) };
}

/**
 * Density of each species at altitude h (km), relative to its surface value. Mirrored in the shader
 * (atmosphere.glsl.ts) and the transmittance table, so keep the three in sync.
 */
export function densities(p: AtmosphereParams, hKm: number): { r: number; m: number; a: number } {
  const h = Math.max(hKm, 0);
  return {
    r: Math.exp(-h / p.rayleigh.heightKm),
    m: Math.exp(-h / p.mie.heightKm),
    a: Math.exp(-Math.abs(h - p.absorber.centerKm) / p.absorber.widthKm),
  };
}

/** Extinction coefficient (1/km) per channel at altitude h. */
export function extinctionAt(p: AtmosphereParams, hKm: number): Vec3T {
  const d = densities(p, hKm);
  const e = (c: 0 | 1 | 2): number =>
    p.rayleigh.beta[c] * d.r + p.mie.extinction[c] * d.m + p.absorber.beta[c] * d.a;
  return [e(0), e(1), e(2)];
}
