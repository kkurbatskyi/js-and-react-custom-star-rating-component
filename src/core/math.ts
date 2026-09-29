/**
 * Scalar math helpers and random-variate samplers (all allocation-free).
 *
 * Samplers take an `Rng` and document how many draws they consume; rejection samplers consume a
 * variable number but are bounded (they can never spin forever).
 */
import type { Rng } from './types';

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

// ───────────────────────────────────────────── Interpolation & ranges

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

/** Clamp to [0, 1] (GLSL `saturate`). */
export function saturate(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of `lerp`: where x lies between a and b (unclamped). Returns 0 when a === b. */
export function invLerp(a: number, b: number, x: number): number {
  return a === b ? 0 : (x - a) / (b - a);
}

/** Linearly map x from [inMin, inMax] to [outMin, outMax] (unclamped). */
export function remap(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return outMin + (outMax - outMin) * invLerp(inMin, inMax, x);
}

/** `remap` with the input clamped to its range. */
export function remapClamped(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return outMin + (outMax - outMin) * saturate(invLerp(inMin, inMax, x));
}

/** Hermite smoothstep with GLSL semantics (edge0 may exceed edge1 for a falling edge). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Perlin's quintic smootherstep (C² continuous). */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Geometric interpolation a·(b/a)^t — the right way to tween scales (distances, zoom levels,
 * time scales) so that equal steps in t are equal ratios. a and b must be positive.
 */
export function logLerp(a: number, b: number, t: number): number {
  return a * Math.exp(Math.log(b / a) * t);
}

/** Fractional part, always in [0, 1). */
export function fract(x: number): number {
  return x - Math.floor(x);
}

/** Positive modulo: result in [0, n) for n > 0 (unlike `%`, which keeps the sign of a). */
export function mod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

// ───────────────────────────────────────────── Angles

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

export function radToDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Wrap an angle to [0, 2π). */
export function wrapAnglePositive(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

// ───────────────────────────────────────────── Special functions

/** Lanczos (g = 7, n = 9) coefficients — Numerical Recipes 3rd ed. §6.1. */
const LANCZOS: readonly number[] = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
  12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
];
const HALF_LOG_TAU = 0.5 * Math.log(TAU);

/** ln Γ(x) for x > 0 (Lanczos approximation, ~15 significant digits; reflection for x < ½). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0] as number;
  for (let i = 1; i < LANCZOS.length; i++) a += (LANCZOS[i] as number) / (z + i);
  const t = z + 7.5;
  return HALF_LOG_TAU + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

// ───────────────────────────────────────────── Random variates

/** Uniform in the OPEN interval (0, 1) — safe for logs and inverse CDFs. 1 draw. */
export function uniformOpen(rng: Rng): number {
  return (rng.uint32() + 0.5) / 4294967296;
}

/** Exponential with the given mean. 1 draw. */
export function sampleExponential(rng: Rng, mean: number): number {
  return -mean * Math.log(1 - rng.next());
}

/** Logistic(μ, s) by inversion: μ + s·ln(u / (1 − u)). 1 draw. */
export function sampleLogistic(rng: Rng, mu = 0, s = 1): number {
  const u = uniformOpen(rng);
  return mu + s * Math.log(u / (1 - u));
}

/** Log-normal: exp(N(mu, sigma)) — mu/sigma are those of the underlying normal. 2 draws. */
export function sampleLogNormal(rng: Rng, mu: number, sigma: number): number {
  return Math.exp(rng.normal(mu, sigma));
}

/**
 * Truncated power law p(x) ∝ x^(−alpha) on [xMin, xMax] by inversion (IMF segments, size
 * distributions). 1 draw. Requires 0 < xMin < xMax.
 */
export function samplePowerLaw(rng: Rng, alpha: number, xMin: number, xMax: number): number {
  const u = rng.next();
  const k = 1 - alpha;
  if (Math.abs(k) < 1e-9) return xMin * (xMax / xMin) ** u;
  const lo = xMin ** k;
  const hi = xMax ** k;
  return (lo + u * (hi - lo)) ** (1 / k);
}

/**
 * Gamma(shape k, scale θ) variate — Marsaglia & Tsang (2000), "A simple method for generating
 * gamma variables", ACM TOMS 26(3). Acceptance ≥ 95 % for k ≥ 1; k < 1 uses the boost
 * X·U^(1/k) with X ~ Gamma(k + 1). Mean kθ, variance kθ². Variable draws (bounded).
 */
export function gammaSample(rng: Rng, shape: number, scale = 1): number {
  if (!(shape > 0) || !(scale > 0)) return 0;
  if (shape < 1) {
    const u = uniformOpen(rng);
    return gammaSample(rng, shape + 1, scale) * u ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let iter = 0; iter < 100; iter++) {
    const x = rng.normal();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = uniformOpen(rng);
    const x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) return d * v * scale;
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v * scale;
  }
  return d * scale; // unreachable in practice: P(100 rejections) < 1e-130
}

/**
 * Poisson(λ) variate. λ < 10: Knuth's multiplication method (≈ λ + 1 draws). λ ≥ 10: Hörmann's
 * PTRS transformed rejection (1993, "The transformed rejection method for generating Poisson
 * random variables", Insurance: Mathematics and Economics 12) — exact, O(1), ~2.2 draws on
 * average. Same split as NumPy. Returns 0 for λ ≤ 0 or NaN.
 */
export function poissonSample(rng: Rng, lambda: number): number {
  if (!(lambda > 0)) return 0;
  if (lambda < 10) {
    const limit = Math.exp(-lambda);
    let prod = rng.next();
    let k = 0;
    while (prod > limit && k < 1000) {
      prod *= rng.next();
      k++;
    }
    return k;
  }
  const slam = Math.sqrt(lambda);
  const logLam = Math.log(lambda);
  const b = 0.931 + 2.53 * slam;
  const a = -0.059 + 0.02483 * b;
  const logInvAlpha = Math.log(1.1239 + 1.1328 / (b - 3.4));
  const vr = 0.9277 - 3.6224 / (b - 2);
  for (let iter = 0; iter < 1000; iter++) {
    const u = rng.next() - 0.5;
    const v = rng.next();
    const us = 0.5 - Math.abs(u);
    const k = Math.floor(((2 * a) / us + b) * u + lambda + 0.43);
    if (us >= 0.07 && v <= vr) return k;
    if (k < 0 || (us < 0.013 && v > us)) continue;
    if (
      Math.log(v) + logInvAlpha - Math.log(a / (us * us) + b) <=
      -lambda + k * logLam - logGamma(k + 1)
    ) {
      return k;
    }
  }
  return Math.round(lambda); // unreachable in practice (acceptance ≈ 0.9 per iteration)
}

/**
 * Uniformly distributed unit vector (Archimedes: z = 2u − 1 is uniform on the sphere).
 * Writes into `out` and returns it. 2 draws.
 */
export function sampleUnitVector(
  rng: Rng,
  out: [number, number, number],
): [number, number, number] {
  const z = 2 * rng.next() - 1;
  const phi = TAU * rng.next();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out[0] = r * Math.cos(phi);
  out[1] = z;
  out[2] = r * Math.sin(phi);
  return out;
}
