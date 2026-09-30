/**
 * Orbit geometry for the orbit-line renderer — all in float64, on the CPU.
 *
 * WHY: an orbit line 1.5e8 km across, drawn from a static float32 vertex buffer and placed by a
 * model matrix, has ~10 km of vertex jitter and, with a few hundred vertices, chords that sag by
 * thousands of km. Both are invisible from afar and glaringly obvious ("kinks", shimmering) when
 * the camera flies close to a line. So the polyline is rebuilt every frame:
 *
 *  1. The ellipse is evaluated analytically, `r(E) = D + X cos E + Y sin E`, with D, X, Y already
 *     **relative to the camera** (float64), so the float32 the GPU receives is small near the
 *     camera, where precision matters, and merely proportionally accurate far away.
 *  2. Vertices are chosen adaptively by bisection: a chord is split until the sagitta of the true
 *     curve over it, seen from the camera, is below a fraction of a pixel
 *     (`sagitta / distance · focalPx ≤ tolerance`). Dense where the line is near the camera or
 *     strongly curved, sparse elsewhere — a few hundred vertices at any zoom.
 *  3. Every vertex carries the analytic unit tangent, so the GPU can extrude a screen-space ribbon
 *     with exactly matching edges at shared vertices (no mitre joins, no gaps, no overlaps).
 *
 * Points run from the body's own position backwards along its path: `age` ∈ [0, 2π] is the
 * eccentric-anomaly angle behind the body (E = E_body − age). The shader turns it into the
 * comet-tail brightness; the strip starts and ends at the body.
 */
import { type Quaternion, Vector3 } from 'three';
import { TAU } from '../../core/math';
import type { OrbitalElements } from '../../core/types';
import { MAX_ECCENTRICITY, orbitalPositionKm } from '../../sim/kepler';

const HALF_PI = Math.PI / 2;

function clampEccentricity(e: number): number {
  return e > 0 ? (e < MAX_ECCENTRICITY ? e : MAX_ECCENTRICITY) : 0;
}

// Scratch for `orbitBasis`: a copy of the elements that is re-aimed at two anomalies.
const probe: OrbitalElements = {
  semiMajorAxisKm: 1,
  eccentricity: 0,
  inclinationRad: 0,
  longitudeAscendingNodeRad: 0,
  argumentPeriapsisRad: 0,
  meanAnomalyEpochRad: 0,
  periodDays: 1,
};

/**
 * Perifocal unit vectors of an orbit in its parent frame (float64): P towards periapsis, Q 90°
 * ahead. Taken from `orbitalPositionKm` itself rather than re-deriving the rotation, so this can
 * never drift from src/sim/kepler.ts: at E = 0 the position is a(1−e)·P, and at E = π/2 it is
 * −a·e·P + b·Q (Kepler's equation: M = π/2 − e·sin(π/2)).
 */
export function orbitBasis(orbit: OrbitalElements, outP: Vector3, outQ: Vector3): void {
  const e = clampEccentricity(orbit.eccentricity);
  const a = orbit.semiMajorAxisKm;
  probe.semiMajorAxisKm = a;
  probe.eccentricity = e;
  probe.inclinationRad = orbit.inclinationRad;
  probe.longitudeAscendingNodeRad = orbit.longitudeAscendingNodeRad;
  probe.argumentPeriapsisRad = orbit.argumentPeriapsisRad;
  probe.meanAnomalyEpochRad = 0;
  orbitalPositionKm(probe, 0, outP).multiplyScalar(1 / (a * (1 - e)));
  probe.meanAnomalyEpochRad = HALF_PI - e;
  orbitalPositionKm(probe, 0, outQ)
    .addScaledVector(outP, a * e)
    .multiplyScalar(1 / (a * Math.sqrt(1 - e * e)));
}

/**
 * One orbit as `r(E) = D + X·cos E + Y·sin E`, in frame S axes, relative to the camera (km).
 * Reused across frames; `set` re-aims it at the current camera and parent position.
 */
export class OrbitCurve {
  /** Semi-major axis, km: the orbit's characteristic size. */
  sizeKm = 0;
  dx = 0;
  dy = 0;
  dz = 0;
  xx = 0;
  xy = 0;
  xz = 0;
  yx = 0;
  yy = 0;
  yz = 0;
  private readonly p = new Vector3();
  private readonly q = new Vector3();

  /**
   * @param orbit       elements, relative to the parent's reference frame
   * @param parentFrame rotation from that reference frame into S (planets: null = identity;
   *                    moons: the parent's `equatorialFrame`)
   * @param parentS     the parent's position in S (planets: null = the star, at the origin)
   * @param cameraS     the camera's position in S (float64)
   */
  set(
    orbit: OrbitalElements,
    parentFrame: Quaternion | null,
    parentS: Vector3 | null,
    cameraS: Vector3,
  ): this {
    const { p, q } = this;
    orbitBasis(orbit, p, q);
    if (parentFrame) {
      p.applyQuaternion(parentFrame);
      q.applyQuaternion(parentFrame);
    }
    const e = clampEccentricity(orbit.eccentricity);
    const a = orbit.semiMajorAxisKm;
    const b = a * Math.sqrt(1 - e * e);
    this.sizeKm = a;
    this.xx = a * p.x;
    this.xy = a * p.y;
    this.xz = a * p.z;
    this.yx = b * q.x;
    this.yy = b * q.y;
    this.yz = b * q.z;
    // The centre of the ellipse is offset from the focus (the parent) by −a·e along P.
    this.dx = (parentS ? parentS.x : 0) - cameraS.x - a * e * p.x;
    this.dy = (parentS ? parentS.y : 0) - cameraS.y - a * e * p.y;
    this.dz = (parentS ? parentS.z : 0) - cameraS.z - a * e * p.z;
    return this;
  }

  /** Writes r(E) to out[o..o+2]. */
  evalTo(E: number, out: Float64Array, o: number): void {
    const c = Math.cos(E);
    const s = Math.sin(E);
    out[o] = this.dx + this.xx * c + this.yx * s;
    out[o + 1] = this.dy + this.xy * c + this.yy * s;
    out[o + 2] = this.dz + this.xz * c + this.yz * s;
  }

  /** Writes the unit tangent dr/dE (direction of motion) to out[o..o+2]. */
  tangentTo(E: number, out: Float64Array, o: number): void {
    const c = Math.cos(E);
    const s = Math.sin(E);
    const tx = -this.xx * s + this.yx * c;
    const ty = -this.xy * s + this.yy * c;
    const tz = -this.xz * s + this.yz * c;
    const k = 1 / (Math.hypot(tx, ty, tz) || 1);
    out[o] = tx * k;
    out[o + 1] = ty * k;
    out[o + 2] = tz * k;
  }
}

/** What the tessellator needs to know about the view. */
export interface TessellationView {
  /** Camera forward axis in frame S (unit). */
  fx: number;
  fy: number;
  fz: number;
  /** Focal length in drawing-buffer pixels: `projection[5] · height / 2`. */
  focalPx: number;
}

export interface TessellationOptions {
  /** Uniform pieces the orbit starts with (also the smoothness floor of the tail gradient). */
  baseSegments: number;
  /** Allowed screen-space deviation of a chord from the true curve, in pixels. */
  tolerancePx: number;
  /** Depth (km) along the view axis below which geometry is behind/at the camera and is clipped. */
  minDepthKm: number;
}

/** Floats per polyline point: position xyz (camera-relative, S axes), unit tangent xyz, age. */
export const POINT_STRIDE = 7;
/** Floats per instanced segment: p0 (3), t0 (3), age0, p1 (3), t1 (3), age1. */
export const SEGMENT_STRIDE = 14;

/** Clip-plane depth as a fraction of a vertex's distance (float32 rounding guard band). */
const CLIP_REL = 1e-6;
const MAX_DEPTH = 12;
/** Ages (rad) within this of the body get extra density: the bright head and its lead-in ramp. */
const HEAD_ZONE = 0.4;
const HEAD_SPAN = 0.0125;

/** Builds the adaptive polyline of one orbit. Allocation-free after construction. */
export class OrbitTessellator {
  /** `count` points of `POINT_STRIDE` floats, age 0 → 2π. */
  readonly points: Float64Array;
  count = 0;
  private readonly capacity: number;
  private readonly s = new Float64Array(9);
  private curve!: OrbitCurve;
  private headE = 0;
  private view!: TessellationView;
  private opts!: TessellationOptions;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.points = new Float64Array(capacity * POINT_STRIDE);
  }

  /** Tessellates `curve` for a body whose eccentric anomaly is `headE`. Returns the point count. */
  build(
    curve: OrbitCurve,
    headE: number,
    view: TessellationView,
    opts: TessellationOptions,
  ): number {
    this.curve = curve;
    this.headE = headE;
    this.view = view;
    this.opts = opts;
    this.count = 0;
    const n = Math.max(3, Math.floor(opts.baseSegments));
    this.push(0);
    for (let k = 1; k <= n; k++) {
      this.refine((TAU * (k - 1)) / n, (TAU * k) / n, 0);
    }
    return this.count;
  }

  private push(age: number): void {
    const o = this.count * POINT_STRIDE;
    const E = this.headE - age;
    this.curve.evalTo(E, this.points, o);
    this.curve.tangentTo(E, this.points, o + 3);
    this.points[o + 6] = age;
    this.count++;
  }

  /** Emits the points of (a0, a1], left to right, splitting while the chord is not flat enough. */
  private refine(a0: number, a1: number, depth: number): void {
    if (depth < MAX_DEPTH && this.count < this.capacity - 2 && this.needsSplit(a0, a1)) {
      const am = 0.5 * (a0 + a1);
      this.refine(a0, am, depth + 1);
      this.refine(am, a1, depth + 1);
    } else {
      this.push(a1);
    }
  }

  private needsSplit(a0: number, a1: number): boolean {
    if (a1 - a0 > HEAD_SPAN && (a0 < HEAD_ZONE || a1 > TAU - HEAD_ZONE)) return true;
    const { s, curve, headE, view, opts } = this;
    curve.evalTo(headE - a0, s, 0);
    curve.evalTo(headE - 0.5 * (a0 + a1), s, 3);
    curve.evalTo(headE - a1, s, 6);
    const min = opts.minDepthKm;
    const d0 = s[0] * view.fx + s[1] * view.fy + s[2] * view.fz;
    const dm = s[3] * view.fx + s[4] * view.fy + s[5] * view.fz;
    const d1 = s[6] * view.fx + s[7] * view.fy + s[8] * view.fz;
    if (d0 < min && dm < min && d1 < min) return false; // behind the camera: never drawn
    // Sagitta: how far the true midpoint lies from the chord's midpoint.
    const dev = Math.hypot(
      s[3] - 0.5 * (s[0] + s[6]),
      s[4] - 0.5 * (s[1] + s[7]),
      s[5] - 0.5 * (s[2] + s[8]),
    );
    // Nearest of the three samples: a long chord with one end at the camera must still split.
    const dist = Math.max(
      Math.min(
        Math.hypot(s[0], s[1], s[2]),
        Math.hypot(s[3], s[4], s[5]),
        Math.hypot(s[6], s[7], s[8]),
      ),
      min,
    );
    return (dev * view.focalPx) / dist > opts.tolerancePx;
  }

  /**
   * Writes the polyline as instanced segments (`SEGMENT_STRIDE` floats each), clipping against the
   * plane `depth = minDepthKm` so nothing at or behind the camera reaches the projection. Returns
   * the number of segments written.
   *
   * The plane is pushed out to `CLIP_REL · |p|` for far vertices: float32 rounds a coordinate of
   * magnitude M by up to ~6e-8·M, which would otherwise flip the sign of a vertex's clip-space w
   * on the GPU. The visible part of a chord is unchanged, because the clipped end lies on it.
   */
  writeSegments(out: Float32Array, view: TessellationView, minDepthKm: number): number {
    const pts = this.points;
    const maxSeg = Math.floor(out.length / SEGMENT_STRIDE);
    let n = 0;
    for (let i = 0; i + 1 < this.count && n < maxSeg; i++) {
      const a = i * POINT_STRIDE;
      const b = a + POINT_STRIDE;
      const mag = Math.max(
        Math.hypot(pts[a], pts[a + 1], pts[a + 2]),
        Math.hypot(pts[b], pts[b + 1], pts[b + 2]),
      );
      const lim = Math.max(minDepthKm, CLIP_REL * mag);
      const da = pts[a] * view.fx + pts[a + 1] * view.fy + pts[a + 2] * view.fz;
      const db = pts[b] * view.fx + pts[b + 1] * view.fy + pts[b + 2] * view.fz;
      if (da < lim && db < lim) continue;
      const o = n * SEGMENT_STRIDE;
      if (da >= lim && db >= lim) {
        for (let k = 0; k < 7; k++) {
          out[o + k] = pts[a + k];
          out[o + 7 + k] = pts[b + k];
        }
      } else {
        // Straddles the clip plane: replace the hidden end by the plane crossing on the chord.
        const t = (lim - da) / (db - da);
        const hideFirst = da < lim;
        for (let k = 0; k < 7; k++) {
          const va = pts[a + k];
          const vb = pts[b + k];
          const vc = va + (vb - va) * t;
          out[o + k] = hideFirst ? vc : va;
          out[o + 7 + k] = hideFirst ? vb : vc;
        }
      }
      n++;
    }
    return n;
  }
}
