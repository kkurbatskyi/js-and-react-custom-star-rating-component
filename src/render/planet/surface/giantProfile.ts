/**
 * Latitude profile of a gas/ice giant, baked on the CPU into a 1-D texture:
 *   R  band value  (-1 dark belt .. +1 bright zone), sharpened so belts and zones have crisp edges
 *   G  zonal wind  (-1 west .. +1 east): alternating jets plus an eastward equatorial super-rotation
 *   B  wind shear  |d wind / d latitude|, 0..1: where jets rub, turbulence is strong
 * Deterministic from the body seed (smooth 1-D value noise on hashed lattice values).
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { hash32, hashToUnit } from '../../../core/hash';
import type { GiantLook } from '../appearance';

/** Smooth value noise in [-1, 1] (quintic interpolation of hashed lattice values). */
export function valueNoise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hashToUnit(hash32(seed, i)) * 2 - 1;
  const b = hashToUnit(hash32(seed, i + 1)) * 2 - 1;
  return a + (b - a) * u;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface GiantProfile {
  band: Float32Array;
  wind: Float32Array;
  shear: Float32Array;
}

/** The profile samples over latitude -pi/2 .. +pi/2 (index 0 = south pole). */
export function computeGiantProfile(
  look: Pick<GiantLook, 'bandFreq' | 'contrast'>,
  seed: number,
  size = 1024,
): GiantProfile {
  const band = new Float32Array(size);
  const wind = new Float32Array(size);
  const shear = new Float32Array(size);
  const k = look.bandFreq * 0.38; // periods per radian: ~6-10 belt/zone alternations per hemisphere for Jupiter-like worlds
  const s1 = hash32(seed, 101);
  const s2 = hash32(seed, 102);
  const s3 = hash32(seed, 103);
  const s4 = hash32(seed, 104);
  const s5 = hash32(seed, 105);
  const latOf = (i: number): number => ((i + 0.5) / size - 0.5) * Math.PI;
  for (let i = 0; i < size; i++) {
    const lat = latOf(i);
    const x = lat * k;
    let n =
      valueNoise1(x, s1) * 0.6 +
      valueNoise1(x * 2.3 + 11.7, s2) * 0.28 +
      valueNoise1(x * 5.1 + 3.1, s3) * 0.12;
    n = Math.tanh(n * 2.6);
    n = n * 0.85 + 0.45 * Math.exp(-((lat / 0.13) ** 2)); // the broad bright equatorial zone
    n *= 1 - 0.55 * smooth(1.05, 1.5, Math.abs(lat)); // quieter poles
    band[i] = Math.max(-1, Math.min(1, n));
    let w = valueNoise1(x * 0.9 + 41.3, s4) * 0.8 + valueNoise1(x * 2.1 + 7.7, s5) * 0.2;
    w += 0.9 * Math.exp(-((lat / 0.22) ** 2)); // eastward equatorial jet
    wind[i] = Math.max(-1, Math.min(1, w));
  }
  let maxShear = 1e-6;
  for (let i = 0; i < size; i++) {
    const a = wind[Math.max(0, i - 2)] ?? 0;
    const b = wind[Math.min(size - 1, i + 2)] ?? 0;
    const d = Math.abs(b - a);
    shear[i] = d;
    if (d > maxShear) maxShear = d;
  }
  for (let i = 0; i < size; i++) shear[i] = Math.min(1, (shear[i] ?? 0) / maxShear);
  return { band, wind, shear };
}

/** Pack the profile into an RGBA8 data texture (linear filtering, clamped). */
export function createGiantProfileTexture(
  look: Pick<GiantLook, 'bandFreq' | 'contrast'>,
  seed: number,
  size = 1024,
): DataTexture {
  const { band, wind, shear } = computeGiantProfile(look, seed, size);
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    data[i * 4] = Math.round(((band[i] ?? 0) * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round(((wind[i] ?? 0) * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((shear[i] ?? 0) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, size, 1, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
