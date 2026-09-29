import { describe, expect, it } from 'vitest';
import { createFbm3, createNoise3, fbm3, ridged3 } from './noise';
import { createRng } from './rng';

describe('createNoise3', () => {
  it('is deterministic per seed (golden values) and differs between seeds', () => {
    const n = createNoise3(7);
    expect(n(0.3, 0.7, 1.1)).toBeCloseTo(0.5934657280000002, 12);
    expect(n(-12.5, 3.25, 100.125)).toBeCloseTo(-0.05351789875893924, 12);
    expect(createNoise3(7)(4.2, -1.3, 0.8)).toBe(n(4.2, -1.3, 0.8));
    expect(createNoise3(8)(4.2, -1.3, 0.8)).not.toBe(n(4.2, -1.3, 0.8));
  });

  it('stays within [−1, 1] with zero mean and useful contrast', () => {
    const n = createNoise3(1);
    const r = createRng(2);
    let sum = 0;
    let sumSq = 0;
    let min = 1;
    let max = -1;
    const count = 100_000;
    for (let i = 0; i < count; i++) {
      const v = n(r.range(-100, 100), r.range(-100, 100), r.range(-100, 100));
      sum += v;
      sumSq += v * v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(Math.abs(sum / count)).toBeLessThan(0.01);
    const std = Math.sqrt(sumSq / count);
    expect(std).toBeGreaterThan(0.15);
    expect(std).toBeLessThan(0.45);
    expect(max - min).toBeGreaterThan(1.4);
  });

  it('is continuous (Lipschitz at small scales)', () => {
    const n = createNoise3(3);
    const r = createRng(4);
    const h = 1e-4;
    for (let i = 0; i < 2000; i++) {
      const x = r.range(-50, 50);
      const y = r.range(-50, 50);
      const z = r.range(-50, 50);
      expect(Math.abs(n(x + h, y, z) - n(x, y, z))).toBeLessThan(10 * h);
    }
  });

  it('is fast: 1e6 evaluations', () => {
    const n = createNoise3(5);
    let acc = 0;
    const t0 = performance.now();
    for (let i = 0; i < 1e6; i++) acc += n(i * 0.013, i * 0.007, i * 0.003);
    expect(performance.now() - t0).toBeLessThan(800);
    expect(Number.isFinite(acc)).toBe(true);
  });
});

describe('fractal sums', () => {
  it('fbm3 stays ≈ [−1, 1] and adds detail', () => {
    const n = createNoise3(6);
    const r = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = fbm3(n, r.range(-20, 20), r.range(-20, 20), r.range(-20, 20), 6);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    // Octaves are decorrelated: fbm is non-zero at the origin even though every octave's grid is aligned.
    expect(fbm3(n, 0, 0, 0, 4)).not.toBe(0);
  });

  it('ridged3 is in [0, 1]', () => {
    const n = createNoise3(8);
    const r = createRng(9);
    for (let i = 0; i < 5000; i++) {
      const v = ridged3(n, r.range(-20, 20), r.range(-20, 20), r.range(-20, 20), 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('createFbm3 applies frequency and matches fbm3', () => {
    const f = createFbm3(10, { octaves: 3, frequency: 0.5 });
    const n = createNoise3(10);
    expect(f(2, 4, 6)).toBeCloseTo(fbm3(n, 1, 2, 3, 3), 12);
  });
});
