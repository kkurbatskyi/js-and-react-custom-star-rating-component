/**
 * Small, well-known astrophysical relations used by the MOCK universe (src/universe/mock*.ts).
 * The real generators in src/gen/* own the definitive versions; these exist so the mock data is
 * internally consistent (Kepler periods, equilibrium temperatures, bulk properties) from day one.
 */
import {
  EARTH_MASS_KG,
  G_SI,
  KM_PER_AU,
  LY_PER_PC,
  MOLAR_GAS_CONSTANT,
  SOLAR_ABS_MAG_BOL,
  SOLAR_ABS_MAG_V,
  SOLAR_MASS_KG,
  SOLAR_TEMP_K,
  STANDARD_GRAVITY_MS2,
} from '../core/units';

/** Molar masses (g/mol) of the gases the mock atmospheres use. */
const MOLAR_MASS_G: Readonly<Record<string, number>> = {
  'H₂': 2.016,
  He: 4.0026,
  'CH₄': 16.043,
  'NH₃': 17.031,
  'H₂O': 18.015,
  Ne: 20.18,
  Na: 22.99,
  'N₂': 28.014,
  CO: 28.01,
  'O₂': 31.998,
  Ar: 39.948,
  'CO₂': 44.009,
  SiO: 44.085,
  'SO₂': 64.066,
};

// ───────────────────────────────────────────── Orbits

export const solarMassKg = (massSolar: number): number => massSolar * SOLAR_MASS_KG;
export const earthMassKg = (massEarth: number): number => massEarth * EARTH_MASS_KG;

/** Hill radius a(1−e)·∛(m / 3M) — moons are stable well inside ~⅓ of it. */
export function hillRadiusKm(
  aKm: number,
  e: number,
  massKg: number,
  centralMassKg: number,
): number {
  return aKm * (1 - e) * Math.cbrt(massKg / (3 * centralMassKg));
}

// ───────────────────────────────────────────── Temperatures & zones (ARCHITECTURE §6.3)

/** T_eq = 278.6 K · L^¼ · a^−½ · (1 − A)^¼   (L in L☉, a in AU, A = Bond albedo). */
export function equilibriumTempK(luminositySolar: number, aAU: number, albedo: number): number {
  return 278.6 * luminositySolar ** 0.25 * aAU ** -0.5 * (1 - albedo) ** 0.25;
}

/** Kopparapu (2013), simplified: [√(L/1.1), √(L/0.53)] AU. */
export function habitableZoneKm(luminositySolar: number): [number, number] {
  return [
    Math.sqrt(luminositySolar / 1.1) * KM_PER_AU,
    Math.sqrt(luminositySolar / 0.53) * KM_PER_AU,
  ];
}

/** Frost (snow) line 2.7 AU · √L. */
export function frostLineKm(luminositySolar: number): number {
  return 2.7 * Math.sqrt(luminositySolar) * KM_PER_AU;
}

// ───────────────────────────────────────────── Bulk properties

export function densityGcc(massEarth: number, radiusKm: number): number {
  const rCm = radiusKm * 1e5;
  return (earthMassKg(massEarth) * 1000) / ((4 / 3) * Math.PI * rCm * rCm * rCm);
}

/** Surface gravity in standard gravities: GM/R² / g₀. */
export function surfaceGravityG(massEarth: number, radiusKm: number): number {
  const rM = radiusKm * 1000;
  return (G_SI * earthMassKg(massEarth)) / (rM * rM) / STANDARD_GRAVITY_MS2;
}

/** v_esc = √(2GM/R), km/s. */
export function escapeVelocityKms(massEarth: number, radiusKm: number): number {
  return Math.sqrt((2 * G_SI * earthMassKg(massEarth)) / (radiusKm * 1000)) / 1000;
}

/** Mean molar mass of a gas mixture, g/mol (unknown gases count as N₂). */
export function meanMolarMassG(composition: readonly { gas: string; fraction: number }[]): number {
  let sum = 0;
  let total = 0;
  for (const { gas, fraction } of composition) {
    sum += fraction * (MOLAR_MASS_G[gas] ?? MOLAR_MASS_G['N₂']);
    total += fraction;
  }
  return total > 0 ? sum / total : MOLAR_MASS_G['N₂'];
}

/** Isothermal scale height H = R·T / (μ·g), km. Earth: ≈ 8.4 km. */
export function scaleHeightKm(tempK: number, molarMassG: number, gravityG: number): number {
  return (
    (MOLAR_GAS_CONSTANT * tempK) / ((molarMassG / 1000) * gravityG * STANDARD_GRAVITY_MS2) / 1000
  );
}

/** Sudarsky gas-giant class from equilibrium temperature (Sudarsky, Burrows & Hubeny 2000). */
export function sudarskyClass(teqK: number): 'I' | 'II' | 'III' | 'IV' | 'V' {
  if (teqK < 150) return 'I';
  if (teqK < 250) return 'II';
  if (teqK < 800) return 'III';
  if (teqK < 1400) return 'IV';
  return 'V';
}

/**
 * Habitability 0..1: the Earth Similarity Index (Schulze-Makuch et al. 2011) over radius
 * (w = 0.57) and surface temperature (w = 5.58), ESI = Π (1 − |x−x₀|/(x+x₀))^(w/n), then damped for
 * missing atmosphere, no liquid water, or no solid surface.
 */
export function habitabilityIndex(input: {
  radiusEarth: number;
  surfaceTempK: number;
  pressureAtm: number;
  giant: boolean;
}): number {
  const esi = (x: number, x0: number, w: number) => (1 - Math.abs((x - x0) / (x + x0))) ** (w / 2);
  let h = esi(input.radiusEarth, 1, 0.57) * esi(input.surfaceTempK, 288, 5.58);
  if (input.giant) h *= 0.05;
  const p = input.pressureAtm;
  if (p < 0.006) h *= 0.35;
  else if (p < 0.3) h *= 0.55 + 0.45 * ((p - 0.006) / 0.294);
  else if (p > 5) h *= Math.max(0.2, 5 / p);
  const t = input.surfaceTempK;
  if (t < 273 || t > 373) h *= 0.6;
  return Math.round(Math.min(1, Math.max(0, h)) * 100) / 100;
}

// ───────────────────────────────────────────── Stars

/** Main-sequence mass–luminosity relation (piecewise power law, common textbook fit). */
export function mainSequenceLuminosity(massSolar: number): number {
  if (massSolar < 0.43) return 0.23 * massSolar ** 2.3;
  if (massSolar < 2) return massSolar ** 4;
  if (massSolar < 55) return 1.4 * massSolar ** 3.5;
  return 32_000 * massSolar;
}

/** Main-sequence mass–radius relation: R ∝ M^0.8 below 1 M☉, M^0.57 above. */
export function mainSequenceRadius(massSolar: number): number {
  return massSolar < 1 ? massSolar ** 0.8 : massSolar ** 0.57;
}

/** Stefan–Boltzmann in solar units: T = T☉ · (L / R²)^¼. */
export function effectiveTempK(luminositySolar: number, radiusSolar: number): number {
  return SOLAR_TEMP_K * (luminositySolar / (radiusSolar * radiusSolar)) ** 0.25;
}

/** Inverse: L = R² (T / T☉)⁴. */
export function luminosityFromRadiusTemp(radiusSolar: number, tempK: number): number {
  return radiusSolar * radiusSolar * (tempK / SOLAR_TEMP_K) ** 4;
}

/** Blackbody V-band bolometric correction (Reed 1998 polynomial in log T − 4). */
function bolometricCorrectionRaw(tempK: number): number {
  const x = Math.log10(Math.min(Math.max(tempK, 2000), 60_000)) - 4;
  return -8.499 * x ** 4 + 13.421 * x ** 3 - 8.131 * x ** 2 - 3.901 * x - 0.438;
}
const BC_SUN_OFFSET = SOLAR_ABS_MAG_BOL - SOLAR_ABS_MAG_V - bolometricCorrectionRaw(SOLAR_TEMP_K);

/** Absolute visual magnitude: M_V = M_bol − BC(T), zero-pointed so the Sun gives exactly 4.83. */
export function absoluteVisualMag(luminositySolar: number, tempK: number): number {
  const mBol = SOLAR_ABS_MAG_BOL - 2.5 * Math.log10(luminositySolar);
  return mBol - (bolometricCorrectionRaw(tempK) + BC_SUN_OFFSET);
}

/** Distance modulus: m = M + 5 log₁₀(d / 10 pc). Distances below 1e-9 ly are clamped. */
export function apparentMag(absMag: number, distanceLy: number): number {
  const dPc = Math.max(distanceLy, 1e-9) / LY_PER_PC;
  return absMag + 5 * Math.log10(dPc) - 5;
}
