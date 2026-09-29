import { describe, expect, it } from 'vitest';
import {
  BLACKBODY_MAX_K,
  BLACKBODY_MIN_K,
  blackbodyRGB,
  blackbodyRGBExact,
  blackbodyRGBInto,
  blackbodyXYZ,
  cssToRgb,
  linearToSrgb,
  mixRGB,
  rgbLuminance,
  rgbToCss,
  saturateRGB,
  spectralClassOf,
  spectralSubtypeOf,
  spectralTypeCode,
  srgbToLinear,
} from './color';

describe('blackbodyRGB', () => {
  it('the Sun (5772 K) is a very slightly warm white', () => {
    const [r, g, b] = blackbodyRGB(5772);
    expect(r).toBe(1);
    expect(g).toBeGreaterThan(0.82);
    expect(g).toBeLessThan(0.95);
    expect(b).toBeGreaterThan(0.72);
    expect(b).toBeLessThan(g);
  });

  it('3000 K is clearly orange, 1000 K deep red', () => {
    const [r, g, b] = blackbodyRGB(3000);
    expect(r).toBe(1);
    expect(g).toBeLessThan(0.6);
    expect(b).toBeLessThan(0.3);
    const deep = blackbodyRGB(1000);
    expect(deep[1]).toBeLessThan(0.1);
    expect(deep[2]).toBeLessThan(0.01);
  });

  it('~6500 K is close to the D65 white point', () => {
    const c = blackbodyRGB(6504);
    expect(Math.min(...c)).toBeGreaterThan(0.93);
  });

  it('10 000 K and hotter are bluish', () => {
    for (const t of [10_000, 20_000, 40_000]) {
      const [r, g, b] = blackbodyRGB(t);
      expect(b).toBe(1);
      expect(r).toBeLessThan(0.7);
      expect(g).toBeLessThan(0.8);
    }
  });

  it('agrees with Mitchell Charity’s CIE 1931 2° blackbody table (sRGB, ±6/255)', () => {
    // http://www.vendian.org/mncharity/dir3/blackbody/ — tabulated 2° CMFs, D65 white, gamma-encoded.
    // The residual (≤ 5/255) is the ~1 % error of the analytic CMF fit.
    const reference: readonly (readonly [number, string])[] = [
      [3000, '#ffb46b'],
      [5000, '#ffe4ce'],
      [6500, '#fff9fd'],
      [10_000, '#c9d9ff'],
    ];
    for (const [t, css] of reference) {
      const ours = rgbToCss(blackbodyRGB(t));
      for (let k = 0; k < 3; k++) {
        const a = Number.parseInt(ours.slice(1 + 2 * k, 3 + 2 * k), 16);
        const b = Number.parseInt(css.slice(1 + 2 * k, 3 + 2 * k), 16);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(6);
      }
    }
  });

  it('is max-normalised, non-negative and gets bluer monotonically', () => {
    let lastBR = 0;
    for (let t = BLACKBODY_MIN_K; t <= BLACKBODY_MAX_K; t *= 1.07) {
      const c = blackbodyRGB(t);
      expect(Math.max(...c)).toBeCloseTo(1, 12);
      expect(Math.min(...c)).toBeGreaterThanOrEqual(0);
      const br = c[2] / c[0];
      expect(br).toBeGreaterThanOrEqual(lastBR);
      lastBR = br;
    }
  });

  it('the LUT matches the exact integral within 0.5 %', () => {
    for (let t = 1000; t <= 40_000; t += 137) {
      const lut = blackbodyRGB(t);
      const exact = blackbodyRGBExact(t);
      for (let k = 0; k < 3; k++)
        expect(Math.abs((lut[k] as number) - (exact[k] as number))).toBeLessThan(5e-3);
    }
  });

  it('clamps the temperature range and blacks out invalid input', () => {
    expect(blackbodyRGB(500)).toEqual(blackbodyRGB(1000));
    expect(blackbodyRGB(1e6)).toEqual(blackbodyRGB(40_000));
    expect(blackbodyRGB(0)).toEqual([0, 0, 0]);
    expect(blackbodyRGB(-5)).toEqual([0, 0, 0]);
    expect(blackbodyRGB(Number.NaN)).toEqual([0, 0, 0]);
  });

  it('blackbodyRGBInto writes into typed arrays at an offset', () => {
    const buf = new Float32Array(9);
    blackbodyRGBInto(5772, buf, 3);
    const expected = blackbodyRGB(5772);
    expect(buf[0]).toBe(0);
    for (let k = 0; k < 3; k++) expect(buf[3 + k]).toBeCloseTo(expected[k] as number, 6);
    expect(buf[6]).toBe(0);
  });

  it('blackbodyXYZ: luminance peaks where the Planck curve sits on the eye (Wien)', () => {
    const y = (t: number) => blackbodyXYZ(t)[1] / t ** 4; // luminous efficacy ∝ Y / σT⁴
    expect(y(6600)).toBeGreaterThan(y(3000));
    expect(y(6600)).toBeGreaterThan(y(20_000));
  });
});

describe('sRGB helpers', () => {
  it('transfer functions round-trip and hit known values', () => {
    expect(linearToSrgb(0.5)).toBeCloseTo(0.735357, 5);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    for (let c = 0; c <= 1; c += 0.01) expect(srgbToLinear(linearToSrgb(c))).toBeCloseTo(c, 10);
  });

  it('rgbToCss / cssToRgb', () => {
    expect(rgbToCss([1, 1, 1])).toBe('#ffffff');
    expect(rgbToCss([0, 0, 0])).toBe('#000000');
    expect(rgbToCss([2, -1, srgbToLinear(128 / 255)])).toBe('#ff0080');
    const c = cssToRgb('#ff0080');
    expect(c?.[0]).toBe(1);
    expect(c?.[1]).toBe(0);
    expect(rgbToCss(c ?? [0, 0, 0])).toBe('#ff0080');
    expect(cssToRgb('#abc')).toEqual(cssToRgb('#aabbcc'));
    expect(cssToRgb('tomato')).toBeNull();
  });

  it('saturateRGB scales chroma and keeps the peak', () => {
    const sun = blackbodyRGB(5772);
    const same = saturateRGB(sun, 1);
    for (let k = 0; k < 3; k++) expect(same[k]).toBeCloseTo(sun[k] as number, 12);
    const grey = saturateRGB(sun, 0);
    expect(grey[0]).toBeCloseTo(grey[1], 12);
    expect(grey[1]).toBeCloseTo(grey[2], 12);
    const boosted = saturateRGB(sun, 1.25);
    expect(Math.max(...boosted)).toBeCloseTo(1, 12);
    expect(boosted[2]).toBeLessThan(sun[2]);
    const red = saturateRGB([1, 0.1, 0], 3);
    expect(Math.min(...red)).toBeGreaterThanOrEqual(0);
  });

  it('mixRGB and rgbLuminance', () => {
    expect(mixRGB([0, 0, 0], [1, 1, 1], 0.25)).toEqual([0.25, 0.25, 0.25]);
    expect(rgbLuminance([1, 1, 1])).toBeCloseTo(1, 12);
  });
});

describe('spectral classification', () => {
  it('classifies main-sequence temperatures (Pecaut & Mamajek 2013)', () => {
    expect(spectralClassOf(40_000)).toBe('O');
    expect(spectralClassOf(20_000)).toBe('B');
    expect(spectralClassOf(8500)).toBe('A');
    expect(spectralClassOf(6500)).toBe('F');
    expect(spectralClassOf(5772)).toBe('G');
    expect(spectralClassOf(4500)).toBe('K');
    expect(spectralClassOf(3000)).toBe('M');
  });

  it('gives MK subtypes in half steps', () => {
    expect(spectralTypeCode(5772)).toBe('G2');
    expect(spectralTypeCode(3100)).toBe('M4.5');
    expect(spectralTypeCode(9700)).toBe('A0');
    expect(spectralTypeCode(100_000)).toBe('O3');
    expect(spectralTypeCode(1500)).toBe('M9.5');
    const { letter, subclass } = spectralSubtypeOf(5270);
    expect(letter).toBe('K');
    expect(subclass).toBe(0);
    for (let t = 2000; t < 50_000; t *= 1.01) {
      const s = spectralSubtypeOf(t).subclass;
      expect(s * 2).toBe(Math.round(s * 2));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(9.5);
    }
  });
});
