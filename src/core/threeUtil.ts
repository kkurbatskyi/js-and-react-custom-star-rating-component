/**
 * Bridges between the plain-tuple data model (./types.ts) and three.js math objects.
 *
 * Scratch-object guidance (no per-frame allocations — docs/ARCHITECTURE.md §8):
 *  - Keep scratch objects module-private: `const _v = new Vector3();` at module scope, reused on
 *    every call. Never export them and never share them between modules — any function you call
 *    may use its own scratch objects, so sharing breaks re-entrancy in subtle ways.
 *  - Public functions write into a caller-supplied `out` and return it (the three.js convention),
 *    so the caller decides whether to allocate. Never return a scratch object.
 *  - Never retain a reference to an `out` argument after returning.
 *  - Inputs may alias `out` only where a function documents it.
 */
import { Quaternion, Vector3 } from 'three';
import type { QuatTuple, Vec3Tuple } from './types';

/** Tuple → Vector3 (allocates only when `out` is omitted). */
export function tupleToVector3(t: Vec3Tuple, out: Vector3 = new Vector3()): Vector3 {
  return out.set(t[0], t[1], t[2]);
}

/** Tuple (x, y, z, w) → Quaternion (allocates only when `out` is omitted). */
export function tupleToQuaternion(t: QuatTuple, out: Quaternion = new Quaternion()): Quaternion {
  return out.set(t[0], t[1], t[2], t[3]);
}

/** Vector3 → fresh tuple (for storing in data records). */
export function vector3ToTuple(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

/** Quaternion → fresh (x, y, z, w) tuple. */
export function quaternionToTuple(q: Quaternion): [number, number, number, number] {
  return [q.x, q.y, q.z, q.w];
}
