import { describe, expect, it } from 'vitest';
import { VWN_RHO, ZoomPanPath } from './vanWijkNuij';

/** The textbook formulas (fine for moderate b; the reference we check the stable forms against). */
function naive(u1: number, w0: number, w1: number, rho: number) {
  const b0 = (w1 * w1 - w0 * w0 + rho ** 4 * u1 * u1) / (2 * w0 * rho * rho * u1);
  const b1 = (w1 * w1 - w0 * w0 - rho ** 4 * u1 * u1) / (2 * w1 * rho * rho * u1);
  const r0 = Math.log(-b0 + Math.sqrt(b0 * b0 + 1));
  const r1 = Math.log(-b1 + Math.sqrt(b1 * b1 + 1));
  const S = (r1 - r0) / rho;
  const w = (s: number) => (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0);
  const u = (s: number) =>
    (w0 / (rho * rho)) * Math.cosh(r0) * Math.tanh(rho * s + r0) -
    (w0 / (rho * rho)) * Math.sinh(r0);
  return { S, w, u };
}

const samples = (S: number, n = 64) => Array.from({ length: n + 1 }, (_, i) => (S * i) / n);

describe('ZoomPanPath', () => {
  it('matches the paper for moderate zoom/pan ratios', () => {
    const [u1, w0, w1] = [10, 1, 2];
    const ref = naive(u1, w0, w1, VWN_RHO);
    const path = new ZoomPanPath(u1, w0, w1);
    expect(path.S).toBeCloseTo(ref.S, 12);
    for (const s of samples(path.S)) {
      expect(path.width(s)).toBeCloseTo(ref.w(s), 10);
      expect(path.panFraction(s) * u1).toBeCloseTo(ref.u(s), 9);
      expect((1 - path.panRemaining(s)) * u1).toBeCloseTo(ref.u(s), 9);
    }
  });

  it('hits both endpoints exactly', () => {
    const path = new ZoomPanPath(4.2e8, 2.5e4, 1.3e10);
    expect(path.width(0)).toBe(2.5e4);
    expect(path.width(path.S)).toBe(1.3e10);
    expect(path.panFraction(0)).toBe(0);
    expect(path.panRemaining(0)).toBe(1);
    expect(path.panFraction(path.S)).toBe(1);
    expect(path.panRemaining(path.S)).toBe(0);
  });

  it('progresses monotonically and the two pan forms agree mid-path', () => {
    const path = new ZoomPanPath(3e8, 1e4, 4e4);
    let prev = -1;
    for (const s of samples(path.S, 200)) {
      const f = path.panFraction(s);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
      expect(f + path.panRemaining(s)).toBeCloseTo(1, 12);
    }
  });

  it('stays finite and exact for inter-system flights (b ≈ 1e13)', () => {
    // A camera 47 km from a moon flying to a star system 50 ly away: b0 = ρ²u1/(2w0) ≈ 1e13.
    const u1 = 4.73e14;
    const w0 = 47.3;
    const w1 = 1.5e10;
    const path = new ZoomPanPath(u1, w0, w1);
    expect(Number.isFinite(path.S)).toBe(true);
    expect(path.S).toBeGreaterThan(20);
    let peak = 0;
    for (const s of samples(path.S, 400)) {
      const w = path.width(s);
      const f = path.panFraction(s);
      const r = path.panRemaining(s);
      for (const v of [w, f, r]) expect(Number.isFinite(v)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      peak = Math.max(peak, w);
    }
    // The view zooms out to about the separation (w_max ≈ ρ²u1/2 = u1 for ρ = √2) …
    expect(peak / u1).toBeGreaterThan(0.9);
    expect(peak / u1).toBeLessThan(1.1);
    // … and the remaining distance just before arrival is resolved to well below a kilometre.
    const sLate = path.S - 1e-9;
    const remainingKm = path.panRemaining(sLate) * u1;
    expect(remainingKm).toBeGreaterThan(0);
    expect(remainingKm).toBeLessThan(1);
    expect(path.width(sLate)).toBeCloseTo(w1, -3);
  });

  it('handles coincident endpoints without NaN', () => {
    const zoomOnly = new ZoomPanPath(0, 100, 1e6);
    expect(zoomOnly.degenerate).toBe(true);
    expect(zoomOnly.S).toBeCloseTo(Math.log(1e4) / VWN_RHO, 12);
    for (const s of samples(zoomOnly.S)) {
      expect(Number.isFinite(zoomOnly.width(s))).toBe(true);
      expect(zoomOnly.panFraction(s) + zoomOnly.panRemaining(s)).toBeCloseTo(1, 12);
    }
    expect(zoomOnly.width(zoomOnly.S / 2)).toBeCloseTo(1e4, 6); // geometric midpoint

    const still = new ZoomPanPath(0, 5, 5);
    expect(still.S).toBe(0);
    expect(still.width(0)).toBe(5);
    expect(still.panFraction(0)).toBe(0);
    expect(still.panRemaining(still.S)).toBe(0);

    const zoomIn = new ZoomPanPath(1e-12, 1e6, 100);
    expect(zoomIn.degenerate).toBe(true);
    expect(zoomIn.width(zoomIn.S)).toBe(100);
  });

  it('rejects invalid widths', () => {
    expect(() => new ZoomPanPath(1, 0, 1)).toThrow(RangeError);
    expect(() => new ZoomPanPath(Number.NaN, 1, 1)).toThrow(RangeError);
  });
});
