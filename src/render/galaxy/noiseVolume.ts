/**
 * Tileable 3D fbm value noise, baked once on the CPU into an R8 `Data3DTexture` (repeat-wrapped,
 * trilinear). The volume pass samples it at two incommensurate scales to add dust clouds and
 * filaments near the camera, where the planar map (~70–140 ly texels) is too coarse.
 */
import { Data3DTexture, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three';
import { hash32, hashToUnit } from '../../core/hash';

/** Lattice cells per tile and amplitude of each octave. */
const OCTAVES: readonly (readonly [number, number])[] = [
  [4, 0.5],
  [8, 0.3],
  [16, 0.2],
];

/** size³ bytes of tileable fbm value noise (quintic interpolation), stretched to 0..255. */
export function tileableNoise3D(size: number, seed: number): Uint8Array {
  const n = size * size * size;
  const acc = new Float32Array(n);
  const i0 = new Int32Array(size);
  const i1 = new Int32Array(size);
  const w = new Float32Array(size);
  OCTAVES.forEach(([cells, amp], o) => {
    const lattice = new Float32Array(cells * cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = hashToUnit(hash32(seed, o, i));
    for (let x = 0; x < size; x++) {
      const f = (x * cells) / size;
      const a = Math.floor(f);
      const t = f - a;
      i0[x] = a % cells;
      i1[x] = (a + 1) % cells;
      w[x] = t * t * t * (t * (t * 6 - 15) + 10);
    }
    const at = (x: number, y: number, z: number): number =>
      lattice[(z * cells + y) * cells + x] as number;
    for (let z = 0; z < size; z++) {
      const z0 = i0[z] as number;
      const z1 = i1[z] as number;
      const wz = w[z] as number;
      for (let y = 0; y < size; y++) {
        const y0 = i0[y] as number;
        const y1 = i1[y] as number;
        const wy = w[y] as number;
        const row = (z * size + y) * size;
        for (let x = 0; x < size; x++) {
          const x0 = i0[x] as number;
          const x1 = i1[x] as number;
          const wx = w[x] as number;
          const c00 = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * wx;
          const c10 = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * wx;
          const c01 = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * wx;
          const c11 = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * wx;
          const c0 = c00 + (c10 - c00) * wy;
          const c1 = c01 + (c11 - c01) * wy;
          acc[row + x] = (acc[row + x] as number) + amp * (c0 + (c1 - c0) * wz);
        }
      }
    }
  });
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const v = acc[i] as number;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Uint8Array(n);
  const k = max > min ? 255 / (max - min) : 0;
  for (let i = 0; i < n; i++) out[i] = Math.round(((acc[i] as number) - min) * k);
  return out;
}

export function createNoiseTexture(size: number, seed: number): Data3DTexture {
  const texture = new Data3DTexture(tileableNoise3D(size, seed), size, size, size);
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.wrapR = RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}
