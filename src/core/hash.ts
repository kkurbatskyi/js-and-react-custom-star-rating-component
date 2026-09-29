/**
 * Integer hashing for deterministic procedural generation.
 *
 * `hash32` is MurmurHash3 (x86, 32-bit) applied to a sequence of 32-bit words: each input is one
 * 4-byte block, followed by Murmur's `fmix32` finaliser (full avalanche: flipping any input bit
 * flips each output bit with probability ≈ ½).
 *
 * Inputs are truncated to int32 with ToInt32 semantics (`v | 0`): fractions are dropped towards
 * zero, values are taken modulo 2³², and NaN/±Infinity become 0. Consequently uint32 seeds hash
 * losslessly (same bits as their int32 reinterpretation) — but do NOT pass unscaled fractional
 * coordinates; use `hashFloat` for those.
 *
 * ⚠ FROZEN: these functions define the universe. Changing any constant or the mixing order changes
 * every star, planet and deep link. Add new functions instead.
 */

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;
/** Seed for integer hashing (the 32-bit golden ratio). */
const SEED_INT = 0x9e3779b9;
/** Different seed for strings so `hashString('')` ≠ `hash32()` (domain separation). */
const SEED_STR = 0x2545f491;

/** Murmur3 block scramble of one 32-bit word. */
function scramble(k: number): number {
  let x = Math.imul(k, C1);
  x = (x << 15) | (x >>> 17);
  return Math.imul(x, C2);
}

/** Murmur3 body step: absorb one block into the running state. */
function absorb(h: number, k: number): number {
  let x = h ^ scramble(k);
  x = (x << 13) | (x >>> 19);
  return (Math.imul(x, 5) + 0xe6546b64) | 0;
}

/** Murmur3 finaliser: bijective uint32 → uint32 avalanche mix. Useful on its own for re-mixing. */
export function fmix32(h: number): number {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Well-mixed uint32 hash of any number of int32 values (see the module note on truncation).
 * Order matters: `hash32(1, 2) !== hash32(2, 1)`. Allocation-free fixed-arity twins with identical
 * output: `hash2`, `hash3`, `hash4`.
 */
export function hash32(...values: number[]): number {
  let h = SEED_INT;
  for (let i = 0; i < values.length; i++) h = absorb(h, values[i] | 0);
  return fmix32(h ^ (values.length * 4));
}

/** `hash32(a)` without the rest-parameter array. */
export function hash1(a: number): number {
  return fmix32(absorb(SEED_INT, a | 0) ^ 4);
}

/** `hash32(a, b)` without the rest-parameter array. */
export function hash2(a: number, b: number): number {
  return fmix32(absorb(absorb(SEED_INT, a | 0), b | 0) ^ 8);
}

/** `hash32(a, b, c)` without the rest-parameter array. */
export function hash3(a: number, b: number, c: number): number {
  return fmix32(absorb(absorb(absorb(SEED_INT, a | 0), b | 0), c | 0) ^ 12);
}

/** `hash32(a, b, c, d)` without the rest-parameter array. */
export function hash4(a: number, b: number, c: number, d: number): number {
  return fmix32(absorb(absorb(absorb(absorb(SEED_INT, a | 0), b | 0), c | 0), d | 0) ^ 16);
}

/**
 * uint32 hash of a string's UTF-16 code units (Murmur3 over pairs of code units).
 * Used for `Rng.fork('label')` and name-keyed seeds.
 */
export function hashString(s: string): number {
  const n = s.length;
  let h = SEED_STR;
  let i = 0;
  for (; i + 1 < n; i += 2) h = absorb(h, s.charCodeAt(i) | (s.charCodeAt(i + 1) << 16));
  if (i < n) h ^= scramble(s.charCodeAt(i));
  return fmix32(h ^ (n * 2));
}

const f64View = new DataView(new ArrayBuffer(8));

/**
 * uint32 hash of a float64's exact bit pattern (little-endian, so it is platform independent).
 * −0 is folded into +0; distinct NaN payloads are not canonicalised (don't hash NaN).
 */
export function hashFloat(x: number): number {
  f64View.setFloat64(0, x + 0, true);
  return hash2(f64View.getUint32(0, true), f64View.getUint32(4, true));
}

/** Map a uint32 hash to a float in [0, 1). */
export function hashToUnit(h: number): number {
  return (h >>> 0) / 4294967296;
}
