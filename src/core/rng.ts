/**
 * Deterministic pseudo-random streams (the `Rng` contract in ./types.ts).
 *
 * Generator: SFC32 (Chris Doty-Humphrey's "Small Fast Chaotic" PRNG, PractRand-clean to ≥ 2⁴⁰
 * bytes) — four 32-bit words of state, only adds/xors/shifts, so it JITs to a handful of
 * instructions. The 32-bit seed is expanded into state with a SplitMix32-style mixer
 * (C. Wellons' low-bias constants) and the generator is warmed up for 12 rounds, so adjacent
 * seeds (0, 1, 2, …) yield uncorrelated streams.
 *
 * Draw accounting (part of the determinism contract — keep it stable):
 *   next / range / int / chance / pick / weighted / uint32 → exactly 1 draw each
 *   normal                                                 → exactly 2 draws (no cached spare)
 *   fork                                                   → 0 draws (derived from the seed)
 *
 * ⚠ FROZEN: changing the algorithm, the seeding or the draw accounting changes the universe.
 */
import { hash2, hashString } from './hash';
import type { Rng } from './types';

const TWO_POW_NEG_32 = 1 / 4294967296;
const TAU = Math.PI * 2;
const GOLDEN_GAMMA = 0x9e3779b9;

/** SplitMix32-style output mixer (bijective on uint32). */
function splitmixOut(state: number): number {
  let z = state;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) | 0;
}

class Sfc32 implements Rng {
  readonly seed: number;
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    let s = this.seed | 0;
    s = (s + GOLDEN_GAMMA) | 0;
    this.a = splitmixOut(s);
    s = (s + GOLDEN_GAMMA) | 0;
    this.b = splitmixOut(s);
    s = (s + GOLDEN_GAMMA) | 0;
    this.c = splitmixOut(s);
    this.d = 1;
    for (let i = 0; i < 12; i++) this.uint32();
  }

  uint32(): number {
    const a = this.a;
    const b = this.b;
    const c = this.c;
    const d = this.d;
    const t = (((a + b) | 0) + d) | 0;
    this.d = (d + 1) | 0;
    this.a = b ^ (b >>> 9);
    this.b = (c + (c << 3)) | 0;
    this.c = (((c << 21) | (c >>> 11)) + t) | 0;
    return t >>> 0;
  }

  next(): number {
    return this.uint32() * TWO_POW_NEG_32;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Inclusive integer range; bounds are rounded inwards. Spans beyond 2³² lose resolution. */
  int(min: number, max: number): number {
    const u = this.next();
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (!(hi > lo)) return lo;
    return lo + Math.floor(u * (hi - lo + 1));
  }

  /** Box–Muller (cosine branch only, so every call costs exactly two draws). |z| ≤ 6.66σ. */
  normal(mean = 0, std = 1): number {
    const u1 = 1 - this.next(); // (0, 1] — never log(0)
    const u2 = this.next();
    return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const u = this.next();
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[Math.floor(u * items.length)] as T;
  }

  /** Non-positive / NaN weights are never chosen; if no weight is positive, picks uniformly. */
  weighted(weights: readonly number[]): number {
    const n = weights.length;
    const u = this.next();
    if (n === 0) throw new RangeError('Rng.weighted: empty weights');
    let total = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i] as number;
      if (w > 0) total += w;
    }
    if (!(total > 0)) return Math.floor(u * n);
    let r = u * total;
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i] as number;
      if (w > 0) {
        r -= w;
        last = i;
        if (r < 0) return i;
      }
    }
    return last; // floating-point shortfall: fall back to the last eligible index
  }

  fork(label: number | string): Rng {
    return new Sfc32(hash2(this.seed, typeof label === 'string' ? hashString(label) : label));
  }
}

/** Create a deterministic stream. `seed` is truncated to uint32 (`seed >>> 0`). */
export function createRng(seed: number): Rng {
  return new Sfc32(seed);
}

/** Fisher–Yates shuffle in place (n − 1 draws). Returns the same array. */
export function shuffleInPlace<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
