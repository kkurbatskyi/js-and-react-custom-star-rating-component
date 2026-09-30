import { describe, expect, it } from 'vitest';
import { KM_PER_AU, KM_PER_LY } from '../../core/units';
import { kmPerPixel, niceFloor, scaleBarFor } from './scale';

const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('niceFloor', () => {
  it.each([
    [0.7, 0.5],
    [1, 1],
    [1.9, 1],
    [2, 2],
    [4.9, 2],
    [5, 5],
    [9.99, 5],
    [123, 100],
    [250, 200],
    [0.034, 0.02],
  ])('%s → %s', (x, expected) => {
    expect(niceFloor(x)).toBeCloseTo(expected, 12);
  });
});

describe('kmPerPixel', () => {
  it('follows 2·d·tan(fov/2) / height', () => {
    // 90° fov: the view spans 2d, so 800 px cover 2e6 km at d = 1e6 km
    expect(kmPerPixel(1e6, 800, 90)).toBeCloseTo(2500, 6);
  });
  it('is 0 for unusable input', () => {
    expect(kmPerPixel(0, 800, 50)).toBe(0);
    expect(kmPerPixel(1e6, 0, 50)).toBe(0);
    expect(kmPerPixel(Number.NaN, 800, 50)).toBe(0);
  });
});

describe('scaleBarFor', () => {
  it('returns null without a scale', () => {
    expect(scaleBarFor(0, 120)).toBeNull();
    expect(scaleBarFor(Number.POSITIVE_INFINITY, 120)).toBeNull();
  });

  it('steps through the units and stays within the target width', () => {
    const cases: [kmPerPx: number, label: string][] = [
      [0.002, '200 m'], // 240 m target → 200 m
      [50, '5000 km'], // 6000 km → 5000 km
      [KM_PER_AU / 60, '2 AU'], // 2 AU target
      [KM_PER_LY / 100, '1 ly'], // 1.2 ly
      [(20_000 * KM_PER_LY) / 100, '20 000 ly'],
    ];
    for (const [kmPerPx, label] of cases) {
      const spec = scaleBarFor(kmPerPx, 120);
      expect(spec, label).not.toBeNull();
      expect(plain(spec?.label ?? '')).toBe(label);
      // A 1–2–5 sequence never undershoots by more than 2.5×, and never overshoots.
      expect(spec?.px).toBeLessThanOrEqual(120 + 1e-6);
      expect(spec?.px).toBeGreaterThan(120 / 2.5 - 1e-6);
    }
  });

  it('keeps kilometres below ~0.1 AU and switches to AU above', () => {
    expect(plain(scaleBarFor(1e5 / 120, 120)?.label ?? '')).toMatch(/km$/);
    expect(plain(scaleBarFor(3e7 / 120, 120)?.label ?? '')).toMatch(/AU$/);
  });
});
