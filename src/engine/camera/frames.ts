/**
 * Frame conversions between the galactic frame G (ly, galactic axes) and system frames S (km,
 * ecliptic axes) — docs/ARCHITECTURE.md §4.
 *
 * PRECISION: every position is represented hierarchically as (star position in G, ly) + (offset from
 * that star in S, km), never as one absolute number. Two points in the same system are differenced
 * in S — exact to ~1e-8 km at 1e8 km — and only points in different systems go through light-years
 * (float64 resolves ~3e-12 ly ≈ 30 km at 26 kly from the centre, irrelevant at interstellar range).
 * All functions are allocation-free and write into `out`.
 */
import { Quaternion, Vector3 } from 'three';
import type { QuatTuple } from '../../core/types';
import { KM_PER_LY } from '../../core/units';

/** A point addressed hierarchically: a star (or a free point) in G plus an offset in its frame S. */
export interface GalacticPoint {
  /** Owning star; null for a free point in the galaxy. Points sharing a star are differenced in S. */
  readonly starId: string | null;
  /** The star's (or free point's) position in the galactic frame, ly (float64). */
  readonly starLy: Vector3;
  /** Rotation S → G of the owning system (identity for free points). */
  readonly frame: Quaternion;
  /** Offset from the star in frame S, km (zero for stars and free points). */
  readonly posS: Vector3;
}

const _inv = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();

/** S → G rotation from a system's `eclipticToGalactic` tuple (normalised against drift). */
export function eclipticToGalactic(t: QuatTuple, out: Quaternion): Quaternion {
  return out.set(t[0], t[1], t[2], t[3]).normalize();
}

/** Rotate a frame-S vector into galactic axes. `out` may alias `v`. */
export function systemToGalactic(v: Vector3, frame: Quaternion, out: Vector3): Vector3 {
  return out.copy(v).applyQuaternion(frame);
}

/** Rotate a galactic-axes vector into frame S (unit quaternion: inverse = conjugate). `out` may alias `v`. */
export function galacticToSystem(v: Vector3, frame: Quaternion, out: Vector3): Vector3 {
  _inv.copy(frame).invert();
  return out.copy(v).applyQuaternion(_inv);
}

/** Position of `a` relative to `b` (a − b), km, galactic axes. `out` must not alias an input. */
export function relativeKm(a: GalacticPoint, b: GalacticPoint, out: Vector3): Vector3 {
  if (a.starId !== null && a.starId === b.starId) {
    // Same system: difference in S first (exact), then rotate.
    return out.subVectors(a.posS, b.posS).applyQuaternion(a.frame);
  }
  out.subVectors(a.starLy, b.starLy).multiplyScalar(KM_PER_LY);
  out.add(_a.copy(a.posS).applyQuaternion(a.frame));
  return out.sub(_b.copy(b.posS).applyQuaternion(b.frame));
}

/** Galactic position (ly) of the point `p + offsetKm` (offset in galactic axes, km). */
export function galacticLyOf(p: GalacticPoint, offsetKm: Vector3, out: Vector3): Vector3 {
  _a.copy(p.posS).applyQuaternion(p.frame).add(offsetKm);
  return out.copy(p.starLy).addScaledVector(_a, 1 / KM_PER_LY);
}

/**
 * Position, in frame S of system `sys` (km, relative to its star), of the point `p + offsetKm`
 * (offset in galactic axes). Exact when `p` belongs to `sys`.
 */
export function systemKmOf(
  p: GalacticPoint,
  offsetKm: Vector3,
  sys: GalacticPoint,
  out: Vector3,
): Vector3 {
  if (p.starId !== null && p.starId === sys.starId) {
    galacticToSystem(offsetKm, sys.frame, out);
    return out.add(p.posS);
  }
  relativeKm(p, sys, out).add(offsetKm); // p − star(sys), galactic axes (sys.posS is the star: 0)
  return galacticToSystem(out, sys.frame, out);
}
