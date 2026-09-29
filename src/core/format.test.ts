import { describe, expect, it } from 'vitest';
import {
  formatAgeGyr,
  formatAngle,
  formatCount,
  formatDensityGcc,
  formatDistanceKm,
  formatDistanceLy,
  formatGravityG,
  formatLuminositySolar,
  formatLy,
  formatMagnitude,
  formatMassEarth,
  formatMassSolar,
  formatNumber,
  formatPercent,
  formatPeriodDays,
  formatPressureAtm,
  formatRadiusKm,
  formatRadiusSolar,
  formatScientific,
  formatSimDate,
  formatTemperature,
  formatTimeScale,
  formatVelocityKms,
  MINUS,
  NBSP,
  romanNumeral,
  THIN_SPACE,
} from './format';
import { DAYS_PER_YEAR, J2000_UNIX_MS, JUPITER_MASS_EARTH, KM_PER_AU, KM_PER_LY, MS_PER_DAY } from './units';

/** Replace typographic spaces/minus with ASCII so expectations stay readable. */
const plain = (s: string): string =>
  s.replace(/[\u00A0\u202F]/g, ' ').replace(/\u2212/g, '-');

describe('typography', () => {
  it('groups digits with a narrow no-break space and joins units with a no-break space', () => {
    expect(formatNumber(38_400)).toBe(`38${THIN_SPACE}400`);
    expect(formatLy(4.24)).toBe(`4.24${NBSP}ly`);
    expect(formatTemperature(210)).toContain(`${MINUS}63`);
  });
});

describe('formatNumber', () => {
  it.each([
    [38_400, {}, '38 400'],
    [5772, {}, '5772'],
    [1_234_567, {}, '1 234 567'],
    [0.72345, {}, '0.723'],
    [5.2, { sig: 3, keepZeros: true }, '5.20'],
    [5.2, { sig: 3 }, '5.2'],
    [-0.0001, { sig: 3 }, '-0.0001'],
    [2.5, { decimals: 0 }, '3'],
    [-0.4, { decimals: 0 }, '0'],
    [-0, {}, '0'],
    [999.95, { sig: 3 }, '1000'],
    [38_400, { group: false }, '38400'],
    [1e21, {}, '1 × 10²¹'],
  ] as const)('%s %o → %s', (x, opts, expected) => {
    expect(plain(formatNumber(x, opts))).toBe(expected);
  });

  it('renders non-finite values', () => {
    expect(formatNumber(Number.NaN)).toBe('—');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(plain(formatNumber(Number.NEGATIVE_INFINITY))).toBe('-∞');
  });

  it('formatScientific uses a times sign and superscripts', () => {
    expect(plain(formatScientific(9.39e20))).toBe('9.39 × 10²⁰');
    expect(plain(formatScientific(1.5e-7, 2))).toBe('1.5 × 10⁻⁷');
    expect(formatScientific(5)).toBe('5');
    expect(formatScientific(0)).toBe('0');
  });

  it('formatCount speaks in words for big numbers', () => {
    expect(plain(formatCount(4.1e11))).toBe('410 billion');
    expect(plain(formatCount(6.86e10))).toBe('69 billion');
    expect(plain(formatCount(2.3e6))).toBe('2.3 million');
    expect(plain(formatCount(999.6e6))).toBe('1 billion');
    expect(plain(formatCount(12_400))).toBe('12 400');
  });

  it('formatPercent adapts precision', () => {
    expect(formatPercent(0.713)).toBe('71%');
    expect(formatPercent(0.035)).toBe('3.5%');
    expect(formatPercent(0.04)).toBe('4%');
    expect(formatPercent(0.00042)).toBe('0.042%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.5, { decimals: 1 })).toBe('50.0%');
  });

  it('romanNumeral', () => {
    const cases: readonly (readonly [number, string])[] = [
      [1, 'I'],
      [4, 'IV'],
      [9, 'IX'],
      [14, 'XIV'],
      [40, 'XL'],
      [90, 'XC'],
      [400, 'CD'],
      [1994, 'MCMXCIV'],
      [2026, 'MMXXVI'],
      [3999, 'MMMCMXCIX'],
    ];
    for (const [n, s] of cases) expect(romanNumeral(n)).toBe(s);
    expect(romanNumeral(0)).toBe('0');
    expect(romanNumeral(4000)).toBe('4000');
    expect(romanNumeral(2.5)).toBe('2.5');
  });
});

describe('distances and sizes', () => {
  it.each([
    [0.85, '850 m'],
    [0.05, '50 m'],
    [12.34, '12.3 km'],
    [6371, '6371 km'],
    [38_400, '38 400 km'],
    [384_400, '384 400 km'],
    [0.723 * KM_PER_AU, '0.723 AU'],
    [KM_PER_AU, '1 AU'],
    [5.2 * KM_PER_AU, '5.2 AU'],
    [1500 * KM_PER_AU, '1500 AU'],
    [4.24 * KM_PER_LY, '4.24 ly'],
    [26_100 * KM_PER_LY, '26 100 ly'],
  ] as const)('formatDistanceKm(%s) → %s', (km, expected) => {
    expect(plain(formatDistanceKm(km))).toBe(expected);
  });

  it('formatLy always uses light-years', () => {
    expect(plain(formatLy(0.0523))).toBe('0.0523 ly');
    expect(plain(formatLy(26_100))).toBe('26 100 ly');
    expect(plain(formatLy(1.2e6))).toBe('1.2 Mly');
    expect(plain(formatDistanceLy(1e-6))).toBe('0.0632 AU');
  });

  it('formatRadiusKm compares with Earth', () => {
    expect(plain(formatRadiusKm(6371))).toBe('6371 km (1 R⊕)');
    expect(plain(formatRadiusKm(69_911))).toBe('69 911 km (11 R⊕)');
    expect(plain(formatRadiusKm(1737.4))).toBe('1737 km (0.273 R⊕)');
    expect(plain(formatRadiusKm(11))).toBe('11 km');
  });

  it('formatRadiusSolar scales for remnants', () => {
    expect(plain(formatRadiusSolar(1.02))).toBe('1.02 R☉');
    expect(plain(formatRadiusSolar(850))).toBe('850 R☉');
    expect(plain(formatRadiusSolar(0.0126))).toBe('0.0126 R☉ (1.38 R⊕)');
    expect(plain(formatRadiusSolar(1.7e-5))).toBe('11.8 km');
  });
});

describe('masses', () => {
  it('formatMassEarth switches to Jupiter masses for giants and kg for pebbles', () => {
    expect(plain(formatMassEarth(1))).toBe('1 M⊕');
    expect(plain(formatMassEarth(0.0123))).toBe('0.0123 M⊕');
    expect(plain(formatMassEarth(17.1))).toBe('17.1 M⊕');
    expect(plain(formatMassEarth(JUPITER_MASS_EARTH))).toBe('1 M♃');
    expect(plain(formatMassEarth(95.16))).toBe('0.299 M♃');
    expect(plain(formatMassEarth(1.57e-4))).toBe('9.38 × 10²⁰ kg');
    expect(plain(formatMassEarth(0))).toBe('0 M⊕');
  });

  it('long form', () => {
    expect(formatMassEarth(1, { long: true })).toBe('1 Earth mass');
    expect(formatMassEarth(2, { long: true })).toBe('2 Earth masses');
    expect(formatMassEarth(1.2 * JUPITER_MASS_EARTH, { long: true })).toBe('1.2 Jupiter masses');
    expect(formatMassSolar(2, { long: true })).toBe('2 solar masses');
  });

  it('formatMassSolar', () => {
    expect(plain(formatMassSolar(1))).toBe('1 M☉');
    expect(plain(formatMassSolar(0.0891))).toBe('0.0891 M☉');
  });
});

describe('physical quantities', () => {
  it('formatTemperature adds Celsius for planetary temperatures', () => {
    expect(plain(formatTemperature(288))).toBe('288 K (15 °C)');
    expect(plain(formatTemperature(210))).toBe('210 K (-63 °C)');
    expect(plain(formatTemperature(737))).toBe('737 K (464 °C)');
    expect(plain(formatTemperature(2.725))).toBe('2.73 K (-270 °C)');
    expect(plain(formatTemperature(5772))).toBe('5772 K');
    expect(plain(formatTemperature(28_400))).toBe('28 400 K');
    expect(plain(formatTemperature(288, { celsius: false }))).toBe('288 K');
    expect(plain(formatTemperature(5772, { celsius: true }))).toBe('5772 K (5499 °C)');
  });

  it('pressure, gravity, density, velocity, luminosity, age, angle, magnitude', () => {
    expect(plain(formatPressureAtm(1))).toBe('1 atm');
    expect(plain(formatPressureAtm(92))).toBe('92 atm');
    expect(plain(formatPressureAtm(0.0063))).toBe('0.0063 atm');
    expect(plain(formatPressureAtm(1.2e-5))).toBe('1.2 × 10⁻⁵ atm');
    expect(plain(formatPressureAtm(0))).toBe('0 atm');
    expect(plain(formatGravityG(0.378))).toBe('0.378 g');
    expect(plain(formatGravityG(1))).toBe('1 g');
    expect(plain(formatDensityGcc(5.514))).toBe('5.51 g/cm³');
    expect(plain(formatVelocityKms(11.186))).toBe('11.2 km/s');
    expect(plain(formatVelocityKms(0.64))).toBe('640 m/s');
    expect(plain(formatLuminositySolar(1))).toBe('1 L☉');
    expect(plain(formatLuminositySolar(0.0017))).toBe('0.0017 L☉');
    expect(plain(formatLuminositySolar(52_000))).toBe('52 000 L☉');
    expect(plain(formatLuminositySolar(3.2e-5))).toBe('3.2 × 10⁻⁵ L☉');
    expect(plain(formatAgeGyr(4.57))).toBe('4.57 Gyr');
    expect(plain(formatAgeGyr(0.32))).toBe('320 Myr');
    expect(plain(formatAgeGyr(0.00085))).toBe('850 kyr');
    expect(formatAngle((23.44 * Math.PI) / 180)).toBe('23.4°');
    expect(formatAngle((23.44 * Math.PI) / 180, { decimals: 0 })).toBe('23°');
    expect(formatMagnitude(4.83)).toBe('+4.83');
    expect(plain(formatMagnitude(-1.46))).toBe('-1.46');
    expect(formatMagnitude(-0.001)).toBe('+0.00');
  });

  it('every formatter renders non-finite input as a dash', () => {
    for (const f of [
      formatDistanceKm,
      formatLy,
      formatRadiusKm,
      formatRadiusSolar,
      formatMassEarth,
      formatMassSolar,
      formatTemperature,
      formatPressureAtm,
      formatGravityG,
      formatPeriodDays,
      formatSimDate,
      formatTimeScale,
      formatPercent,
    ]) {
      expect(f(Number.NaN)).toBe('—');
    }
  });
});

describe('time', () => {
  it.each([
    [27.3 / 24, '27.3 h'],
    [88, '88 days'],
    [687, '687 days'],
    [365.25, '365 days'],
    [4332.6, '11.9 yr'],
    [60_190, '165 yr'],
    [1.34 / 86_400, '1.34 s'],
    [0.00134 / 86_400, '1.34 ms'],
    [30 / 1440, '30 min'],
    [-243, '-243 days'],
    [0, '0 s'],
  ] as const)('formatPeriodDays(%s) → %s', (days, expected) => {
    expect(plain(formatPeriodDays(days))).toBe(expected);
  });

  const simDaysOf = (unixMs: number) => (unixMs - J2000_UNIX_MS) / MS_PER_DAY;

  it('formatSimDate', () => {
    expect(formatSimDate(0)).toBe('2000-01-01 12:00 UTC');
    expect(formatSimDate(simDaysOf(Date.UTC(2026, 8, 29, 14, 3, 30)))).toBe('2026-09-29 14:03 UTC');
    expect(formatSimDate(simDaysOf(Date.UTC(2024, 1, 29, 0, 0, 30)))).toBe('2024-02-29 00:00 UTC');
    expect(formatSimDate(simDaysOf(Date.UTC(1999, 11, 31, 23, 59, 30)))).toBe('1999-12-31 23:59 UTC');
    expect(formatSimDate(1e9)).toMatch(/^\d{7}-\d\d-\d\d \d\d:\d\d UTC$/); // past JS Date's range
  });

  it('formatSimDate agrees with Date for random instants (years 0000–9999)', () => {
    let seed = 12345;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    const start = new Date(0); // Date.UTC(0, …) would mean 1900, so set year 0 explicitly
    start.setUTCFullYear(0, 0, 1);
    const end = Date.UTC(9999, 11, 31, 23, 0);
    for (let i = 0; i < 2000; i++) {
      const minute = Math.floor((start.getTime() + next() * (end - start.getTime())) / 60_000);
      const unixMs = minute * 60_000 + 30_000; // mid-minute: immune to rounding
      const iso = new Date(unixMs).toISOString();
      expect(formatSimDate(simDaysOf(unixMs))).toBe(`${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);
    }
  });

  it.each([
    [0, 'paused'],
    [1, 'real time'],
    [0.5, '0.5× real time'],
    [10, '10× real time'],
    [60, '1 min/s'],
    [3600, '1 h/s'],
    [7200, '2 h/s'],
    [86_400, '1 day/s'],
    [172_800, '2 days/s'],
    [604_800, '1 week/s'],
    [1_209_600, '2 weeks/s'],
    [2.63e6, '1 month/s'],
    [DAYS_PER_YEAR * 86_400, '1 yr/s'],
    [3.156e7, '1 yr/s'],
    [-86_400, '-1 day/s'],
  ] as const)('formatTimeScale(%s) → %s', (sps, expected) => {
    expect(plain(formatTimeScale(sps))).toBe(expected);
  });
});
