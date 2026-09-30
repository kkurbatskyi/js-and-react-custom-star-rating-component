/**
 * Flights: a van Wijk–Nuij zoom-and-pan (./vanWijkNuij.ts) between the current camera state and a
 * composed arrival pose (./framing.ts), between endpoints that MOVE (planets orbit during the
 * flight).
 *
 * The path is planned once (path length S, hence the duration), then re-evaluated every frame
 * against the endpoints' current positions:
 *   - the look-at point travels the straight segment from the start look-at to the destination,
 *     its progress given by the path's pan fraction;
 *   - the camera stands `w(s)/k` from it (k = 2·tan(fov/2): the view width at the look-at point),
 *     along the slerped orientation — so it always looks at the moving look-at point, and the up
 *     vector blends from the start frame (e.g. galactic north) to the destination's ecliptic north.
 *
 * PRECISION: in the first half the camera is expressed relative to the START focus using u(s)
 * (exact near s = 0); in the second half relative to the DESTINATION using u1 − u(s) (exact near
 * s = S). The separation vector is recomputed per frame with frames.relativeKm (exact within one
 * system), so arriving 10⁴ km above a planet after crossing 50 ly is free of jitter.
 */
import { Quaternion, Vector3 } from 'three';
import { smootherstep, smoothstep } from '../../core/math';
import type { FocusHandle } from './focus';
import { relativeKm } from './frames';
import { type OrbitPose, orbitQuaternion } from './framing';
import { ZoomPanPath } from './vanWijkNuij';

/** Duration per unit of path length S (the paper's "perceived distance"). */
export const FLIGHT_SECONDS_PER_UNIT = 0.3;
export const FLIGHT_MIN_SEC = 1.5;
export const FLIGHT_MAX_SEC = 9;
/** Peak of d/dτ smootherstep(τ) = 30τ²(1−τ)², at τ = ½. */
const EASE_PEAK_SLOPE = 30 / 16;

/** Camera state a flight departs from. */
export interface FlightStart {
  /** The focus the state is expressed against. */
  anchor: FocusHandle;
  /** Look-at point relative to the anchor, km, galactic axes (zero when orbiting the focus). */
  lookAtKm: Vector3;
  /** Camera distance from the look-at point, km. */
  distanceKm: number;
  /** Camera orientation, galactic axes. */
  quaternion: Quaternion;
}

const AXIS_Z = new Vector3(0, 0, 1);
const _sep = new Vector3();
const _dir = new Vector3();

export class Flight {
  readonly from: FocusHandle;
  readonly to: FocusHandle;
  readonly arrival: OrbitPose;
  readonly path: ZoomPanPath;
  readonly durationSec: number;
  /** Look-at point relative to the current anchor after the last `evaluate` (km, galactic axes). */
  readonly lookAtKm = new Vector3();
  private readonly look0 = new Vector3();
  private readonly q0 = new Quaternion();
  private readonly q1 = new Quaternion();
  private readonly widthPerKm: number;
  /** 0..1 — how "interstellar" this flight is (drives the travel FX). */
  private readonly travelScale: number;
  private elapsedSec = 0;

  constructor(start: FlightStart, to: FocusHandle, arrival: OrbitPose, fovY: number) {
    this.from = start.anchor;
    this.to = to;
    this.arrival = { ...arrival };
    this.look0.copy(start.lookAtKm);
    this.q0.copy(start.quaternion);
    orbitQuaternion(to.frame, arrival.yaw, arrival.pitch, this.q1);
    this.widthPerKm = 2 * Math.tan(fovY / 2);

    const u1 = relativeKm(to, this.from, _sep).sub(this.look0).length();
    this.path = new ZoomPanPath(
      u1,
      Math.max(start.distanceKm, 1e-6) * this.widthPerKm,
      arrival.distanceKm * this.widthPerKm,
    );
    this.durationSec = Math.min(
      FLIGHT_MAX_SEC,
      Math.max(FLIGHT_MIN_SEC, FLIGHT_SECONDS_PER_UNIT * this.path.S),
    );
    // Interplanetary hops (≲ 1e9 km) are not "travel"; interstellar ones (≳ 1e13 km) fully are.
    this.travelScale = u1 > 0 ? smoothstep(9, 13, Math.log10(u1)) : 0;
  }

  /** 0..1 real-time progress. */
  get progress(): number {
    return this.elapsedSec / this.durationSec;
  }

  get done(): boolean {
    return this.elapsedSec >= this.durationSec;
  }

  /** 0..1 normalised perceived speed, weighted by how interstellar the flight is. */
  get travel(): number {
    const t = this.progress;
    return ((30 * t * t * (1 - t) * (1 - t)) / EASE_PEAK_SLOPE) * this.travelScale;
  }

  advance(dtSec: number): void {
    this.elapsedSec = Math.min(this.durationSec, this.elapsedSec + Math.max(0, dtSec));
  }

  /** Debug/screenshots: jump to a progress in [0, 1]. */
  setProgress(t: number): void {
    this.elapsedSec = Math.min(1, Math.max(0, t)) * this.durationSec;
  }

  /**
   * Camera state at the current progress. Both endpoints must already be updated to the current
   * sim time. Writes the camera offset from the returned anchor (km, galactic axes) and its
   * orientation.
   */
  evaluate(outOffsetKm: Vector3, outQuat: Quaternion): FocusHandle {
    const e = smootherstep(0, 1, this.progress);
    const path = this.path;
    const s = path.S * e;
    const distanceKm = path.width(s) / this.widthPerKm;
    outQuat.slerpQuaternions(this.q0, this.q1, e);
    _dir.copy(AXIS_Z).applyQuaternion(outQuat);

    // Separation from the start look-at point to the destination, now: (to − from) − look0.
    relativeKm(this.to, this.from, _sep).sub(this.look0);
    let anchor: FocusHandle;
    if (2 * s <= path.S) {
      anchor = this.from;
      this.lookAtKm.copy(this.look0).addScaledVector(_sep, path.panFraction(s));
    } else {
      anchor = this.to;
      this.lookAtKm.copy(_sep).multiplyScalar(-path.panRemaining(s));
    }
    outOffsetKm.copy(this.lookAtKm).addScaledVector(_dir, distanceKm);
    return anchor;
  }
}
