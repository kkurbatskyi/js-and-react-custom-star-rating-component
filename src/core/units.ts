/**
 * Physical constants and unit conversions — the single source of truth for every number with a
 * dimension in Sidereal. Never hard-code these elsewhere (see docs/ARCHITECTURE.md §4).
 *
 * Values follow IAU 2012/2015 nominal constants and CODATA 2018 where applicable.
 */

// ───────────────────────────────────────────── Length

/** Astronomical unit (IAU 2012, exact). */
export const KM_PER_AU = 149_597_870.7;
/** Julian light-year: c × 365.25 d (exact). */
export const KM_PER_LY = 9_460_730_472_580.8;
/** ≈ 63 241.077 */
export const AU_PER_LY = KM_PER_LY / KM_PER_AU;
/** Parsec: 648 000/π AU (IAU 2015, exact). ≈ 3.0857e13 km */
export const KM_PER_PC = (648_000 / Math.PI) * KM_PER_AU;
/** ≈ 3.26156 (derived so that KM_PER_PC / KM_PER_LY is exact). */
export const LY_PER_PC = KM_PER_PC / KM_PER_LY;
/** Nominal solar radius (IAU 2015 R☉ᴺ). */
export const SOLAR_RADIUS_KM = 695_700;
/** Mean Earth radius. */
export const EARTH_RADIUS_KM = 6371;
/** Mean Jupiter radius. */
export const JUPITER_RADIUS_KM = 69_911;
/**
 * @deprecated The catalogue is stratified by luminosity band: use `BASE_CELL_LY` / `cellSizeLy(level)`
 * from src/universe/contracts.ts. Kept (= the level-0 cell size) for older call sites.
 */
export const SECTOR_SIZE_LY = 32;

// ───────────────────────────────────────────── Mass

/** Solar mass (IAU 2015: GM☉ / G). */
export const SOLAR_MASS_KG = 1.988_47e30;
export const EARTH_MASS_KG = 5.9722e24;
export const JUPITER_MASS_EARTH = 317.83;
export const JUPITER_MASS_KG = JUPITER_MASS_EARTH * EARTH_MASS_KG;
/** ≈ 332 946 */
export const SOLAR_MASS_EARTH = SOLAR_MASS_KG / EARTH_MASS_KG;
/** ≈ 1047.6 */
export const SOLAR_MASS_JUPITER = SOLAR_MASS_KG / JUPITER_MASS_KG;

// ───────────────────────────────────────────── Stellar

/** Nominal solar effective temperature (IAU 2015). */
export const SOLAR_TEMP_K = 5772;
/** Nominal solar luminosity (IAU 2015). */
export const SOLAR_LUMINOSITY_W = 3.828e26;
/** Absolute bolometric magnitude of the Sun (IAU 2015 zero point). */
export const SOLAR_ABS_MAG_BOL = 4.74;
/** Absolute visual magnitude of the Sun. */
export const SOLAR_ABS_MAG_V = 4.83;

// ───────────────────────────────────────────── Fundamental

/** Newtonian constant of gravitation (CODATA 2018), m³ kg⁻¹ s⁻². */
export const G_SI = 6.6743e-11;
/** Speed of light, km/s (exact). */
export const SPEED_OF_LIGHT_KMS = 299_792.458;
/** Stefan–Boltzmann constant (CODATA 2018), W m⁻² K⁻⁴. */
export const STEFAN_BOLTZMANN_SI = 5.670_374_419e-8;
/** Standard gravity, m/s² (exact). */
export const STANDARD_GRAVITY_MS2 = 9.806_65;
/** Molar gas constant R (CODATA 2018, exact), J mol⁻¹ K⁻¹. */
export const MOLAR_GAS_CONSTANT = 8.314_462_618;
/** Boltzmann constant (exact), J/K. */
export const BOLTZMANN_SI = 1.380_649e-23;
/** Atomic mass unit (CODATA 2018), kg. */
export const ATOMIC_MASS_UNIT_KG = 1.660_539_066_6e-27;

// ───────────────────────────────────────────── Time

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86_400;
export const HOURS_PER_DAY = 24;
/** Julian year (the astronomical convention, and the one KM_PER_LY is built on). */
export const DAYS_PER_YEAR = 365.25;
export const SECONDS_PER_YEAR = DAYS_PER_YEAR * SECONDS_PER_DAY;
/** Mean Julian month (1/12 year). */
export const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;
/**
 * The J2000 epoch as a Unix timestamp: 2000-01-01 12:00 UTC.
 * (Strictly J2000 is 12:00 TT ≈ 11:58:55.8 UTC; the 64 s difference is irrelevant here.)
 * `simDays` in the app are days since this instant.
 */
export const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12);
export const MS_PER_DAY = SECONDS_PER_DAY * 1000;

// ───────────────────────────────────────────── Conversions

export const kmToAU = (km: number): number => km / KM_PER_AU;
export const auToKm = (au: number): number => au * KM_PER_AU;
export const lyToKm = (ly: number): number => ly * KM_PER_LY;
export const kmToLy = (km: number): number => km / KM_PER_LY;
export const auToLy = (au: number): number => au / AU_PER_LY;
export const lyToAU = (ly: number): number => ly * AU_PER_LY;
export const pcToLy = (pc: number): number => pc * LY_PER_PC;
export const lyToPc = (ly: number): number => ly / LY_PER_PC;

export const solarRadiiToKm = (r: number): number => r * SOLAR_RADIUS_KM;
export const kmToSolarRadii = (km: number): number => km / SOLAR_RADIUS_KM;
export const earthRadiiToKm = (r: number): number => r * EARTH_RADIUS_KM;
export const kmToEarthRadii = (km: number): number => km / EARTH_RADIUS_KM;

export const earthMassesToKg = (m: number): number => m * EARTH_MASS_KG;
export const kgToEarthMasses = (kg: number): number => kg / EARTH_MASS_KG;
export const solarMassesToKg = (m: number): number => m * SOLAR_MASS_KG;
export const kgToSolarMasses = (kg: number): number => kg / SOLAR_MASS_KG;
export const solarMassesToEarth = (m: number): number => m * SOLAR_MASS_EARTH;
export const earthMassesToSolar = (m: number): number => m / SOLAR_MASS_EARTH;

export const daysToSeconds = (d: number): number => d * SECONDS_PER_DAY;
export const secondsToDays = (s: number): number => s / SECONDS_PER_DAY;
export const daysToHours = (d: number): number => d * HOURS_PER_DAY;
export const hoursToDays = (h: number): number => h / HOURS_PER_DAY;
export const yearsToDays = (y: number): number => y * DAYS_PER_YEAR;
export const daysToYears = (d: number): number => d / DAYS_PER_YEAR;
