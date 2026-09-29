import { describe, expect, it } from 'vitest';
import { hash32, hashString } from './hash';
import { createRng, shuffleInPlace } from './rng';

describe('createRng', () => {
  it('is deterministic per seed and frozen (golden values)', () => {
    const r = createRng(42);
    expect([r.uint32(), r.uint32(), r.uint32()]).toEqual([1959603763, 2423114712, 2466933512]);
    expect(createRng(0).next()).toBe(0.6750985074322671);
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('decorrelates adjacent seeds', () => {
    const firsts = new Set<number>();
    for (let s = 0; s < 1000; s++) firsts.add(createRng(s).uint32());
    expect(firsts.size).toBe(1000);
    // Correlation between the first outputs of seeds s and s + 1.
    let sxy = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    const n = 5000;
    for (let s = 0; s < n; s++) {
      const x = createRng(s).next();
      const y = createRng(s + 1).next();
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
      syy += y * y;
    }
    const cov = sxy / n - (sx / n) * (sy / n);
    const corr = cov / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
    expect(Math.abs(corr)).toBeLessThan(0.05);
  });

  it('exposes its seed as uint32', () => {
    expect(createRng(-1).seed).toBe(0xffffffff);
    expect(createRng(2 ** 32 + 3).seed).toBe(3);
    expect(createRng(12.7).seed).toBe(12);
  });

  it('next() is uniform in [0, 1)', () => {
    const r = createRng(1);
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const v = r.next();
      sum += v;
      sumSq += v * v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(0.5, 2);
    expect(sumSq / n - mean * mean).toBeCloseTo(1 / 12, 3);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it('range, int, chance', () => {
    const r = createRng(2);
    const hits = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.range(-3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(5);
      const k = r.int(1, 6);
      expect(Number.isInteger(k)).toBe(true);
      hits.add(k);
    }
    expect([...hits].sort()).toEqual([1, 2, 3, 4, 5, 6]); // both ends inclusive
    expect(r.int(4, 4)).toBe(4);
    expect(r.int(9, 2)).toBe(9); // degenerate range: lower bound
    let yes = 0;
    for (let i = 0; i < 20_000; i++) if (r.chance(0.3)) yes++;
    expect(yes / 20_000).toBeCloseTo(0.3, 1);
  });

  it('normal() has the requested mean and standard deviation', () => {
    const r = createRng(3);
    const n = 100_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = r.normal(10, 2);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(10, 1);
    expect(Math.sqrt(sumSq / n - mean * mean)).toBeCloseTo(2, 1);
  });

  it('consumes a fixed number of draws per call (determinism contract)', () => {
    const probe = (fn: (r: ReturnType<typeof createRng>) => void, draws: number) => {
      const a = createRng(99);
      const b = createRng(99);
      fn(a);
      for (let i = 0; i < draws; i++) b.uint32();
      expect(a.uint32()).toBe(b.uint32());
    };
    probe((r) => r.next(), 1);
    probe((r) => r.range(0, 1), 1);
    probe((r) => r.int(0, 10), 1);
    probe((r) => r.int(5, 5), 1);
    probe((r) => r.chance(0.5), 1);
    probe((r) => r.pick([1, 2, 3]), 1);
    probe((r) => r.weighted([1, 2]), 1);
    probe((r) => r.normal(), 2);
    probe((r) => r.fork('anything'), 0);
  });

  it('pick and weighted', () => {
    const r = createRng(4);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 40_000; i++) {
      const k = r.weighted([1, 0, 3, -2]);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts[1]).toBe(0);
    expect(counts[3]).toBe(0);
    expect((counts[2] ?? 0) / 40_000).toBeCloseTo(0.75, 1);
    // No positive weight → uniform.
    const k = r.weighted([0, 0, 0]);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThan(3);
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    expect(() => r.pick([])).toThrow(RangeError);
    expect(() => r.weighted([])).toThrow(RangeError);
  });

  it('fork() derives from the seed only and never advances the parent', () => {
    const a = createRng(5);
    const b = createRng(5);
    const child1 = a.fork('planet');
    a.next();
    a.next();
    const child2 = a.fork('planet');
    expect(child1.uint32()).toBe(child2.uint32());
    expect(a.next()).not.toBe(b.next()); // a advanced by our own draws only…
    const c = createRng(5);
    c.fork('x');
    c.fork(7);
    expect(c.next()).toBe(createRng(5).next()); // …forking alone consumed nothing
  });

  it('fork(label) = createRng(hash32(seed, label hash))', () => {
    expect(createRng(42).fork('planet').next()).toBe(createRng(hash32(42, hashString('planet'))).next());
    expect(createRng(42).fork(3).next()).toBe(createRng(hash32(42, 3)).next());
    expect(createRng(42).fork('planet').uint32()).toBe(3336638367);
    expect(createRng(42).fork(3).uint32()).toBe(3992018385);
    expect(createRng(42).fork('a').uint32()).not.toBe(createRng(42).fork('b').uint32());
    expect(createRng(42).fork(1).fork(2).seed).toBe(hash32(hash32(42, 1), 2));
  });

  it('is fast: 1e7 next() calls well under a second', () => {
    const r = createRng(6);
    let acc = 0;
    const t0 = performance.now();
    for (let i = 0; i < 1e7; i++) acc += r.next();
    const ms = performance.now() - t0;
    expect(acc).toBeGreaterThan(0);
    expect(ms).toBeLessThan(800);
  });
});

describe('shuffleInPlace', () => {
  it('permutes deterministically', () => {
    const a = shuffleInPlace(createRng(8), [1, 2, 3, 4, 5, 6, 7, 8]);
    const b = shuffleInPlace(createRng(8), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
