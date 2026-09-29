/**
 * Human-readable formatting for the UI: numbers, distances, masses, times, temperatures, dates.
 *
 * Typographic conventions (instrument-panel style, SI brochure §5.4):
 *  - Digit groups are separated by a NARROW NO-BREAK SPACE (U+202F, a non-breaking thin space),
 *    only from five integer digits up: "5772", "38 400".
 *  - A NO-BREAK SPACE (U+00A0) joins a value to its unit, so "4.24 ly" never wraps.
 *  - Negative values use the true minus sign (U+2212): "−63 °C".
 *  - Trailing zeros are trimmed ("5.2 AU", not "5.20 AU") unless `keepZeros` is requested.
 *  - Non-finite input renders as an em dash "—" (∞ for infinities in `formatNumber`).
 * Testing Library's default text matcher normalises these spaces, so `getByText('4.24 ly')` works.
 */
import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  EARTH_MASS_KG,
  EARTH_RADIUS_KM,
  J2000_UNIX_MS,
  JUPITER_MASS_EARTH,
  KM_PER_AU,
  KM_PER_LY,
  MS_PER_DAY,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
  SECONDS_PER_YEAR,
  SOLAR_RADIUS_KM,
} from './units';

/** Joins values to units. */
export const NBSP = ' ';
/** Digit-group separator (narrow no-break space). */
export const THIN_SPACE = ' ';
/** Typographic minus sign. */
export const MINUS = '−';
/** Placeholder for missing / non-finite values. */
export const DASH = '—';

// ───────────────────────────────────────────── Numbers

export interface NumberFormatOptions {
  /** Significant figures. Default: integers are shown in full, other values with 3. */
  sig?: number;
  /** Fixed number of decimals (overrides `sig`). */
  decimals?: number;
  /** Keep trailing zeros ("5.20" instead of "5.2"). Default false. */
  keepZeros?: boolean;
  /** Thin-space digit grouping from 10 000 up. Default true. */
  group?: boolean;
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  const s = String(Math.abs(n))
    .split('')
    .map((d) => SUPERSCRIPT_DIGITS[Number(d)] ?? d)
    .join('');
  return n < 0 ? `⁻${s}` : s;
}

function groupDigits(intPart: string): string {
  return intPart.length > 4 ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE) : intPart;
}

/**
 * Scientific notation with a real times sign and superscript exponent: "1.07 × 10¹⁶".
 * Uses plain formatting when the exponent is 0.
 */
export function formatScientific(x: number, sig = 3): string {
  if (!Number.isFinite(x)) return formatNumber(x);
  if (x === 0) return '0';
  const [mantissa, expPart] = x.toExponential(Math.max(0, sig - 1)).split('e');
  const exp = Number(expPart);
  const m = formatNumber(Number(mantissa), { sig });
  return exp === 0 ? m : `${m}${NBSP}×${NBSP}10${superscript(exp)}`;
}

/**
 * General number formatting — see the module doc for conventions.
 *   formatNumber(38400) → "38 400"   formatNumber(0.72345) → "0.723"
 *   formatNumber(5.2, { sig: 3, keepZeros: true }) → "5.20"
 */
export function formatNumber(x: number, opts: NumberFormatOptions = {}): string {
  if (Number.isNaN(x)) return DASH;
  if (!Number.isFinite(x)) return x > 0 ? '∞' : `${MINUS}∞`;
  let v = x;
  let decimals = 0;
  if (opts.decimals !== undefined) {
    decimals = Math.max(0, Math.min(20, Math.floor(opts.decimals)));
  } else {
    const sig = opts.sig ?? (Number.isInteger(x) ? 0 : 3);
    if (sig > 0 && x !== 0) {
      v = Number(x.toPrecision(Math.min(21, sig)));
      const mag = Math.floor(Math.log10(Math.abs(v)));
      decimals = Math.max(0, Math.min(20, sig - 1 - mag));
    }
  }
  if (Math.abs(v) >= 1e21) return formatScientific(v, opts.sig ?? 3);
  let s = Math.abs(v).toFixed(decimals);
  if (!opts.keepZeros && s.includes('.')) s = s.replace(/\.?0+$/, '');
  const dot = s.indexOf('.');
  const intPart = dot < 0 ? s : s.slice(0, dot);
  const fracPart = dot < 0 ? '' : s.slice(dot);
  const sign = v < 0 && /[1-9]/.test(s) ? MINUS : '';
  return sign + (opts.group === false ? intPart : groupDigits(intPart)) + fracPart;
}

/** Big counts in words: 4.1e11 → "410 billion", 2.3e6 → "2.3 million", 12 400 → "12 400". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  const scales: readonly (readonly [number, string])[] = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
  ];
  for (const [scale, word] of scales) {
    if (a >= scale * 0.9995) return `${formatNumber(n / scale, { sig: a / scale >= 100 ? 3 : 2 })}${NBSP}${word}`;
  }
  return formatNumber(Math.round(n));
}

/** Fraction → percentage: 0.713 → "71%", 0.035 → "3.5%", 0.00042 → "0.042%". */
export function formatPercent(fraction: number, opts: { decimals?: number } = {}): string {
  if (!Number.isFinite(fraction)) return DASH;
  const p = fraction * 100;
  if (opts.decimals !== undefined) return `${formatNumber(p, { decimals: opts.decimals, keepZeros: true })}%`;
  const a = Math.abs(p);
  if (a === 0) return '0%';
  if (a >= 10) return `${formatNumber(Math.round(p))}%`;
  if (a >= 1) return `${formatNumber(p, { decimals: 1 })}%`;
  return `${formatNumber(p, { sig: 2 })}%`;
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** 1 → "I", 14 → "XIV", 2026 → "MMXXVI". Outside 1–3999 (or non-integers) → plain digits. */
export function romanNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  let rest = n;
  let out = '';
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

// ───────────────────────────────────────────── Distances & sizes

const KM_PER_0_01_AU = 0.01 * KM_PER_AU;
const KM_PER_0_1_LY = 0.1 * KM_PER_LY;

/**
 * Distance with automatic units:
 *   < 1 km → m · < 0.01 AU → km · < 0.1 ly → AU · else ly (Mly beyond a million).
 *   850 m · 6371 km · 384 400 km · 0.723 AU · 5.2 AU · 4.24 ly · 26 100 ly
 */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km)) return DASH;
  const a = Math.abs(km);
  if (a < 1) {
    const m = km * 1000;
    return `${a >= 0.1 ? formatNumber(Math.round(m)) : formatNumber(m, { sig: 3 })}${NBSP}m`;
  }
  if (a < 100) return `${formatNumber(km, { sig: 3 })}${NBSP}km`;
  if (a < 1e5) return `${formatNumber(Math.round(km))}${NBSP}km`;
  if (a < KM_PER_0_01_AU) return `${formatNumber(km, { sig: 4 })}${NBSP}km`;
  if (a < KM_PER_0_1_LY) return `${formatNumber(km / KM_PER_AU, { sig: 3 })}${NBSP}AU`;
  return formatLy(km / KM_PER_LY);
}

/** Same as `formatDistanceKm` but from light-years (automatic units). */
export function formatDistanceLy(ly: number): string {
  return formatDistanceKm(ly * KM_PER_LY);
}

/** Always in light-years, 3 significant figures: "0.0523 ly", "4.24 ly", "26 100 ly", "1.2 Mly". */
export function formatLy(ly: number): string {
  if (!Number.isFinite(ly)) return DASH;
  if (Math.abs(ly) >= 1e6) return `${formatNumber(ly / 1e6, { sig: 3 })}${NBSP}Mly`;
  return `${formatNumber(ly, { sig: 3 })}${NBSP}ly`;
}

/**
 * Body radius with an Earth comparison: "6371 km (1 R⊕)", "69 911 km (11 R⊕)".
 * Bodies under ~64 km get no comparison: "11 km".
 */
export function formatRadiusKm(km: number): string {
  if (!Number.isFinite(km)) return DASH;
  const base = formatDistanceKm(km);
  const ratio = km / EARTH_RADIUS_KM;
  if (Math.abs(ratio) < 0.01) return base;
  return `${base} (${formatNumber(ratio, { sig: 3 })}${NBSP}R⊕)`;
}

/**
 * Stellar radius: "1.02 R☉", "850 R☉"; compact remnants add scale: white dwarfs
 * "0.0126 R☉ (1.38 R⊕)", neutron stars in km "12 km".
 */
export function formatRadiusSolar(radiusSolar: number): string {
  if (!Number.isFinite(radiusSolar)) return DASH;
  const km = radiusSolar * SOLAR_RADIUS_KM;
  if (Math.abs(km) < 1000) return formatDistanceKm(km);
  const base = `${formatNumber(radiusSolar, { sig: 3 })}${NBSP}R☉`;
  if (Math.abs(radiusSolar) < 0.05) return `${base} (${formatNumber(km / EARTH_RADIUS_KM, { sig: 3 })}${NBSP}R⊕)`;
  return base;
}

// ───────────────────────────────────────────── Masses

export interface MassFormatOptions {
  /** Words instead of symbols: "1.2 Jupiter masses". */
  long?: boolean;
}

function massUnit(value: string, symbol: string, singular: string, plural: string, long?: boolean): string {
  if (!long) return `${value}${NBSP}${symbol}`;
  return `${value} ${value === '1' ? singular : plural}`;
}

/**
 * Planet/moon mass. Giants (≥ 50 M⊕) switch to Jupiter masses; tiny bodies (< 0.001 M⊕) to kg.
 *   "1 M⊕" · "0.0123 M⊕" · "17.1 M⊕" · "1.2 M♃" · "9.39 × 10²⁰ kg"
 */
export function formatMassEarth(massEarth: number, opts: MassFormatOptions = {}): string {
  if (!Number.isFinite(massEarth)) return DASH;
  const a = Math.abs(massEarth);
  if (a >= 50) {
    const v = formatNumber(massEarth / JUPITER_MASS_EARTH, { sig: 3 });
    return massUnit(v, 'M♃', 'Jupiter mass', 'Jupiter masses', opts.long);
  }
  if (a > 0 && a < 1e-3) return `${formatScientific(massEarth * EARTH_MASS_KG, 3)}${NBSP}kg`;
  return massUnit(formatNumber(massEarth, { sig: 3 }), 'M⊕', 'Earth mass', 'Earth masses', opts.long);
}

/** Stellar mass: "1 M☉", "0.0891 M☉", "15.2 M☉". */
export function formatMassSolar(massSolar: number, opts: MassFormatOptions = {}): string {
  if (!Number.isFinite(massSolar)) return DASH;
  return massUnit(formatNumber(massSolar, { sig: 3 }), 'M☉', 'solar mass', 'solar masses', opts.long);
}

// ───────────────────────────────────────────── Physical quantities

/**
 * Kelvin with Celsius for planetary temperatures: "288 K (15 °C)", "737 K (464 °C)", "5772 K",
 * "28 400 K". Celsius is shown below 1500 K unless `celsius` forces it on/off.
 */
export function formatTemperature(tempK: number, opts: { celsius?: boolean } = {}): string {
  if (!Number.isFinite(tempK)) return DASH;
  const a = Math.abs(tempK);
  // 3 significant figures for cryogenic and stellar extremes; whole kelvin in between.
  const k = a < 100 || a >= 1e4 ? formatNumber(tempK, { sig: 3 }) : formatNumber(Math.round(tempK));
  const kelvin = `${k}${NBSP}K`;
  if (!(opts.celsius ?? tempK < 1500)) return kelvin;
  return `${kelvin} (${formatNumber(Math.round(tempK - 273.15))}${NBSP}°C)`;
}

/** Surface pressure: "1 atm", "92 atm", "0.0063 atm", "1.2 × 10⁻⁵ atm". */
export function formatPressureAtm(atm: number): string {
  if (!Number.isFinite(atm)) return DASH;
  if (atm !== 0 && Math.abs(atm) < 1e-3) return `${formatScientific(atm, 2)}${NBSP}atm`;
  return `${formatNumber(atm, { sig: 3 })}${NBSP}atm`;
}

/** Surface gravity in standard gravities: "0.378 g", "1 g", "2.53 g". */
export function formatGravityG(g: number): string {
  if (!Number.isFinite(g)) return DASH;
  return `${formatNumber(g, { sig: 3 })}${NBSP}g`;
}

/** Bulk density: "5.51 g/cm³". */
export function formatDensityGcc(gcc: number): string {
  if (!Number.isFinite(gcc)) return DASH;
  return `${formatNumber(gcc, { sig: 3 })}${NBSP}g/cm³`;
}

/** Speed: "11.2 km/s"; below 1 km/s in m/s: "640 m/s". */
export function formatVelocityKms(kms: number): string {
  if (!Number.isFinite(kms)) return DASH;
  if (Math.abs(kms) < 1) return `${formatNumber(kms * 1000, { sig: 3 })}${NBSP}m/s`;
  return `${formatNumber(kms, { sig: 3 })}${NBSP}km/s`;
}

/** Luminosity: "1 L☉", "0.0017 L☉", "52 000 L☉", "3.2 × 10⁻⁵ L☉". */
export function formatLuminositySolar(lum: number): string {
  if (!Number.isFinite(lum)) return DASH;
  if (lum !== 0 && Math.abs(lum) < 1e-3) return `${formatScientific(lum, 2)}${NBSP}L☉`;
  return `${formatNumber(lum, { sig: 3 })}${NBSP}L☉`;
}

/** Age: "4.57 Gyr", "320 Myr", "850 kyr". */
export function formatAgeGyr(gyr: number): string {
  if (!Number.isFinite(gyr)) return DASH;
  const a = Math.abs(gyr);
  if (a >= 1) return `${formatNumber(gyr, { sig: 3 })}${NBSP}Gyr`;
  if (a >= 1e-3) return `${formatNumber(gyr * 1e3, { sig: 3 })}${NBSP}Myr`;
  return `${formatNumber(gyr * 1e6, { sig: 3 })}${NBSP}kyr`;
}

/** Angle in degrees: "23.4°" (`decimals` fixes precision, e.g. 0 → "23°"). */
export function formatAngle(rad: number, opts: { decimals?: number } = {}): string {
  if (!Number.isFinite(rad)) return DASH;
  const deg = (rad * 180) / Math.PI;
  const text =
    opts.decimals !== undefined ? formatNumber(deg, { decimals: opts.decimals }) : formatNumber(deg, { sig: 3 });
  return `${text}°`;
}

/** Astronomical magnitude, always signed with two decimals: "+4.83", "−1.46". */
export function formatMagnitude(mag: number): string {
  if (!Number.isFinite(mag)) return DASH;
  const s = Math.abs(mag).toFixed(2);
  return `${mag < 0 && s !== '0.00' ? MINUS : '+'}${s}`;
}

// ───────────────────────────────────────────── Time

/**
 * Period or duration given in days, with natural units:
 *   "1.34 ms" · "42 s" · "38.5 min" · "27.3 h" (below 2 days) · "88 days" · "687 days" · "11.9 yr".
 * Negative (retrograde) values keep a leading minus.
 */
export function formatPeriodDays(days: number): string {
  if (!Number.isFinite(days)) return DASH;
  const sign = days < 0 ? MINUS : '';
  const d = Math.abs(days);
  const sec = d * SECONDS_PER_DAY;
  let body: string;
  if (d === 0) body = `0${NBSP}s`;
  else if (sec < 1) body = `${formatNumber(sec * 1000, { sig: 3 })}${NBSP}ms`;
  else if (sec < SECONDS_PER_MINUTE) body = `${formatNumber(sec, { sig: 3 })}${NBSP}s`;
  else if (sec < SECONDS_PER_HOUR) body = `${formatNumber(sec / SECONDS_PER_MINUTE, { sig: 3 })}${NBSP}min`;
  else if (d < 2) body = `${formatNumber(d * 24, { sig: 3 })}${NBSP}h`;
  else if (d < 100) body = `${formatNumber(d, { sig: 3 })}${NBSP}days`;
  else if (d < 1000) body = `${formatNumber(Math.round(d))}${NBSP}days`;
  else body = `${formatNumber(d / DAYS_PER_YEAR, { sig: 3 })}${NBSP}yr`;
  return sign + body;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Simulation clock (days since J2000) → "2026-09-29 14:03 UTC". Proleptic Gregorian calendar via
 * H. Hinnant's `civil_from_days`, so any year works (JS Date stops at ±275 760). The minute is
 * floored, like a clock.
 */
export function formatSimDate(simDays: number): string {
  if (!Number.isFinite(simDays)) return DASH;
  const unixMinutes = Math.floor((J2000_UNIX_MS + simDays * MS_PER_DAY) / 60_000);
  const days = Math.floor(unixMinutes / 1440);
  const minuteOfDay = unixMinutes - days * 1440;
  // civil_from_days (http://howardhinnant.github.io/date_algorithms.html)
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  const yearText = year < 0 ? `${MINUS}${String(-year).padStart(4, '0')}` : String(year).padStart(4, '0');
  const hh = Math.floor(minuteOfDay / 60);
  const mm = minuteOfDay - hh * 60;
  return `${yearText}-${pad2(month)}-${pad2(day)} ${pad2(hh)}:${pad2(mm)} UTC`;
}

const TIME_UNITS: readonly (readonly [seconds: number, singular: string, plural: string])[] = [
  [SECONDS_PER_YEAR, 'yr', 'yr'],
  [DAYS_PER_MONTH * SECONDS_PER_DAY, 'month', 'months'],
  [7 * SECONDS_PER_DAY, 'week', 'weeks'],
  [SECONDS_PER_DAY, 'day', 'days'],
  [SECONDS_PER_HOUR, 'h', 'h'],
  [SECONDS_PER_MINUTE, 'min', 'min'],
];

/**
 * Simulation speed (sim seconds per real second): 0 → "paused", 1 → "real time",
 * 10 → "10× real time", 3600 → "1 h/s", 86 400 → "1 day/s", 3.156e7 → "1 yr/s".
 * Matches the labels of `TIME_SCALES` in src/sim/time.ts.
 */
export function formatTimeScale(simSecondsPerSecond: number): string {
  const s = simSecondsPerSecond;
  if (!Number.isFinite(s)) return DASH;
  if (s === 0) return 'paused';
  if (s === 1) return 'real time';
  const a = Math.abs(s);
  const sign = s < 0 ? MINUS : '';
  if (a < SECONDS_PER_MINUTE) return `${sign}${formatNumber(a, { sig: 2 })}×${NBSP}real time`;
  for (const [unit, singular, plural] of TIME_UNITS) {
    if (a >= unit * 0.9995) {
      const value = formatNumber(a / unit, { sig: 3 });
      return `${sign}${value}${NBSP}${value === '1' ? singular : plural}/s`;
    }
  }
  return `${sign}${formatNumber(a, { sig: 3 })}${NBSP}s/s`;
}
