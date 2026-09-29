/**
 * Seedable 3D simplex noise and fractal sums for CPU-side generation.
 *
 * Simplex noise after Perlin (2001) in Gustavson's formulation ("Simplex noise demystified",
 * 2005/2012): skew to the simplicial grid, sum four radially-attenuated gradient contributions
 * (r² = 0.6, output ×32 → approximately [−1, 1]). The permutation table is a Fisher–Yates shuffle
 * driven by our deterministic `Rng`, so a seed fully determines the field.
 *
 * Everything is allocation-free per call; build the noise function once and reuse it.
 * (GPU shaders have their own GLSL noise in src/render/shaders — the two are not bit-identical.)
 */
import { createRng, shuffleInPlace } from './rng';

export type Noise3 = (x: number, y: number, z: number) => number;

const F3 = 1 / 3;
const G3 = 1 / 6;
/** The 12 cube-edge gradient directions (x, y, z interleaved). */
const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1,
  -1,
]);

/** Seeded 3D simplex noise: range ≈ [−1, 1], mean 0, feature size ≈ 1 unit. */
export function createNoise3(seed: number): Noise3 {
  const source: number[] = [];
  for (let i = 0; i < 256; i++) source.push(i);
  shuffleInPlace(createRng(seed).fork('simplex3'), source);
  const perm = new Uint8Array(512);
  const permGrad = new Uint8Array(512); // perm % 12 × 3: offset into GRAD3
  for (let i = 0; i < 512; i++) {
    const v = source[i & 255] as number;
    perm[i] = v;
    permGrad[i] = (v % 12) * 3;
  }

  return (xin: number, yin: number, zin: number): number => {
    // Skew input space to find the containing simplex cell.
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    // Which of the six tetrahedra are we in? (i1,j1,k1) and (i2,j2,k2) are the middle corners.
    let i1: number;
    let j1: number;
    let k1: number;
    let i2: number;
    let j2: number;
    let k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = permGrad[ii + (perm[jj + (perm[kk] as number)] as number)] as number;
      t0 *= t0;
      n += t0 * t0 * ((GRAD3[g] as number) * x0 + (GRAD3[g + 1] as number) * y0 + (GRAD3[g + 2] as number) * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = permGrad[ii + i1 + (perm[jj + j1 + (perm[kk + k1] as number)] as number)] as number;
      t1 *= t1;
      n += t1 * t1 * ((GRAD3[g] as number) * x1 + (GRAD3[g + 1] as number) * y1 + (GRAD3[g + 2] as number) * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = permGrad[ii + i2 + (perm[jj + j2 + (perm[kk + k2] as number)] as number)] as number;
      t2 *= t2;
      n += t2 * t2 * ((GRAD3[g] as number) * x2 + (GRAD3[g + 1] as number) * y2 + (GRAD3[g + 2] as number) * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = permGrad[ii + 1 + (perm[jj + 1 + (perm[kk + 1] as number)] as number)] as number;
      t3 *= t3;
      n += t3 * t3 * ((GRAD3[g] as number) * x3 + (GRAD3[g + 1] as number) * y3 + (GRAD3[g + 2] as number) * z3);
    }
    return 32 * n;
  };
}

// Per-octave domain offsets: decorrelate octaves (otherwise every octave is 0 at the origin).
const OCTAVE_OFFSETS = new Float64Array([
  0, 0, 0, 31.416, 17.23, -5.87, -12.71, 43.19, 21.4, 7.77, -29.1, 38.3, 53.2, 11.9, -44.6, -21.3, -7.4, 15.8, 19.9,
  -37.2, 29.6, 45.5, 27.1, 9.3,
]);
const MAX_OCTAVES = OCTAVE_OFFSETS.length / 3;

/**
 * Fractional Brownian motion: Σ gainⁱ · noise(p · lacunarityⁱ + offsetᵢ), normalised by Σ gainⁱ
 * so the result stays ≈ [−1, 1]. At most 8 octaves.
 */
export function fbm3(
  noise: Noise3,
  x: number,
  y: number,
  z: number,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
): number {
  const n = Math.min(MAX_OCTAVES, Math.max(1, Math.floor(octaves)));
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < n; o++) {
    const q = o * 3;
    sum +=
      amp *
      noise(
        x * freq + (OCTAVE_OFFSETS[q] as number),
        y * freq + (OCTAVE_OFFSETS[q + 1] as number),
        z * freq + (OCTAVE_OFFSETS[q + 2] as number),
      );
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/**
 * Ridged multifractal (Musgrave): sharp crests where the noise crosses zero — mountain ranges,
 * filaments. Each octave is weighted by the previous one so detail concentrates on the ridges.
 * Range [0, 1]. At most 8 octaves.
 */
export function ridged3(
  noise: Noise3,
  x: number,
  y: number,
  z: number,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
): number {
  const n = Math.min(MAX_OCTAVES, Math.max(1, Math.floor(octaves)));
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < n; o++) {
    const q = o * 3;
    let r =
      1 -
      Math.abs(
        noise(
          x * freq + (OCTAVE_OFFSETS[q] as number),
          y * freq + (OCTAVE_OFFSETS[q + 1] as number),
          z * freq + (OCTAVE_OFFSETS[q + 2] as number),
        ),
      );
    r *= r * weight;
    weight = r < 0 ? 0 : r > 1 ? 1 : r;
    sum += r * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  /** Multiplies input coordinates (1 / feature size). Default 1. */
  frequency?: number;
}

/** Convenience: a seeded fbm field as a plain `(x, y, z) → ≈[−1, 1]` function. */
export function createFbm3(seed: number, opts: FbmOptions = {}): Noise3 {
  const noise = createNoise3(seed);
  const octaves = opts.octaves ?? 5;
  const lacunarity = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  const f = opts.frequency ?? 1;
  return (x, y, z) => fbm3(noise, x * f, y * f, z * f, octaves, lacunarity, gain);
}
