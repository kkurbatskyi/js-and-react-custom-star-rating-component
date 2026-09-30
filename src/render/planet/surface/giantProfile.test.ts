import { describe, expect, it } from 'vitest';
import { computeGiantProfile, valueNoise1 } from './giantProfile';

describe('valueNoise1', () => {
  it('is deterministic, bounded and continuous', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.173;
      const v = valueNoise1(x, 7);
      expect(v).toBe(valueNoise1(x, 7));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(valueNoise1(x + 1e-6, 7) - v)).toBeLessThan(1e-3);
    }
    expect(valueNoise1(3.3, 1)).not.toBe(valueNoise1(3.3, 2));
  });
});

describe('computeGiantProfile', () => {
  const look = { bandFreq: 7, contrast: 0.75 };

  it('produces bounded, deterministic band/wind/shear curves with belts and zones of both signs', () => {
    const a = computeGiantProfile(look, 12345, 512);
    const b = computeGiantProfile(look, 12345, 512);
    expect(Array.from(a.band)).toEqual(Array.from(b.band));
    expect(Math.max(...a.band)).toBeGreaterThan(0.5);
    expect(Math.min(...a.band)).toBeLessThan(-0.3);
    for (const v of [...a.band, ...a.wind]) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    for (const v of a.shear) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...a.shear)).toBeCloseTo(1, 6);
  });

  it('has an eastward equatorial jet and a quieter pole', () => {
    const p = computeGiantProfile(look, 99, 1024);
    const mid = p.wind[512] as number;
    expect(mid).toBeGreaterThan(0.2);
    const poleBand = Math.max(...Array.from(p.band.slice(0, 40)).map(Math.abs));
    const eqBand = Math.max(...Array.from(p.band.slice(450, 570)).map(Math.abs));
    expect(poleBand).toBeLessThanOrEqual(eqBand + 0.35);
  });

  it('has fewer bands for a low band frequency (ice giants)', () => {
    const count = (bandFreq: number): number => {
      const p = computeGiantProfile({ bandFreq, contrast: 0.2 }, 5, 1024);
      let n = 0;
      for (let i = 1; i < p.band.length; i++)
        if (Math.sign(p.band[i] as number) !== Math.sign(p.band[i - 1] as number)) n++;
      return n;
    };
    expect(count(3)).toBeLessThan(count(8));
  });
});
