import { describe, expect, it } from 'vitest';
import {
  fmix32,
  hash1,
  hash2,
  hash3,
  hash4,
  hash32,
  hashFloat,
  hashString,
  hashToUnit,
} from './hash';

function popcount(x: number): number {
  let v = x >>> 0;
  let c = 0;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

describe('hash32', () => {
  it('returns a deterministic uint32', () => {
    for (const args of [[], [0], [1, 2, 3], [-5, 7, 123456789, -2147483648]]) {
      const h = hash32(...args);
      expect(h).toBe(hash32(...args));
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('is frozen — these golden values define the universe', () => {
    expect(fmix32(1)).toBe(0x514e28b7); // canonical MurmurHash3 finaliser value
    expect(hash32(1, 2, 3)).toBe(2107016148);
    expect(hash32()).toBe(2462723854);
    expect(hash32(0)).toBe(3026550934);
    expect(hashString('system')).toBe(3546687659);
    expect(hashString('')).toBe(2628190328);
    expect(hashFloat(1.5)).toBe(1050545846);
  });

  it('fixed-arity twins match the variadic form', () => {
    for (const [a, b, c, d] of [
      [0, 0, 0, 0],
      [1, -2, 3, -4],
      [2147483647, -2147483648, 0xffffffff, 12345],
    ] as const) {
      expect(hash1(a)).toBe(hash32(a));
      expect(hash2(a, b)).toBe(hash32(a, b));
      expect(hash3(a, b, c)).toBe(hash32(a, b, c));
      expect(hash4(a, b, c, d)).toBe(hash32(a, b, c, d));
    }
  });

  it('depends on order and arity', () => {
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
    expect(hash32(0)).not.toBe(hash32(0, 0));
    expect(hash32(5)).not.toBe(hash32());
  });

  it('truncates inputs to int32 (ToInt32 semantics)', () => {
    expect(hash32(1.9)).toBe(hash32(1));
    expect(hash32(-1.9)).toBe(hash32(-1));
    expect(hash32(2 ** 32 + 5)).toBe(hash32(5));
    expect(hash32(0xffffffff)).toBe(hash32(-1)); // uint32 seeds hash losslessly
    expect(hash32(Number.NaN)).toBe(hash32(0));
    expect(hash32(Number.POSITIVE_INFINITY)).toBe(hash32(0));
  });

  it('avalanches: one flipped input bit flips ~16 of 32 output bits', () => {
    let total = 0;
    let n = 0;
    for (let seed = 0; seed < 200; seed++) {
      const base = hash32(seed, 77);
      for (let bit = 0; bit < 32; bit++) {
        total += popcount(base ^ hash32(seed ^ (1 << bit), 77));
        n++;
      }
    }
    expect(total / n).toBeGreaterThan(15.5);
    expect(total / n).toBeLessThan(16.5);
  });

  it('is uniform over buckets (chi-square)', () => {
    const buckets = new Array<number>(64).fill(0);
    const n = 64_000;
    for (let i = 0; i < n; i++) {
      const b = hash32(i, 3) >>> 26;
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    const expected = n / 64;
    const chi2 = buckets.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(120); // 63 dof: p ≈ 1e-5
  });

  it('has no collisions over a 32³ block of sector coordinates', () => {
    const seen = new Set<number>();
    for (let x = -16; x < 16; x++) {
      for (let y = -16; y < 16; y++) for (let z = -16; z < 16; z++) seen.add(hash32(42, x, y, z));
    }
    expect(seen.size).toBe(32 ** 3);
  });
});

describe('hashString / hashFloat / hashToUnit', () => {
  it('hashString distinguishes near-identical labels', () => {
    const labels = ['planet', 'planets', 'Planet', 'plane', 'a', 'b', 'ab', 'ba', 'system', 'moon'];
    expect(new Set(labels.map(hashString)).size).toBe(labels.length);
  });

  it('hashFloat hashes the exact bit pattern and folds −0 into +0', () => {
    expect(hashFloat(0.1 + 0.2)).not.toBe(hashFloat(0.3));
    expect(hashFloat(-0)).toBe(hashFloat(0));
    expect(hashFloat(1e300)).toBe(hashFloat(1e300));
  });

  it('hashToUnit maps into [0, 1)', () => {
    expect(hashToUnit(0)).toBe(0);
    expect(hashToUnit(0xffffffff)).toBeLessThan(1);
    expect(hashToUnit(0x80000000)).toBe(0.5);
  });
});
