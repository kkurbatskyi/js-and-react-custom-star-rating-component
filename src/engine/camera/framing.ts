/**
 * Orbit poses and composed arrival framings.
 *
 * An orbit pose is (yaw, pitch, distance) in the focus's reference frame (G for galaxy points, the
 * system ecliptic S for stars and bodies). The camera sits at
 *   focus + distance · frame · (cos p sin y, sin p, cos p cos y)
 * looking at the focus with the frame's +Y as up, i.e. camera quaternion = frame · R_Y(y) · R_X(−p)
 * (a three.js camera looks down its local −Z, and R_Y(y)·R_X(−p) maps +Z onto that direction).
 *
 * Arrival framings (the brief's composition rules):
 *  - galactic centre: the ~110 kly overview, 35° above the disk;
 *  - other galaxy points: a 40 ly "neighbourhood" view;
 *  - star: the whole system, 2.5 × the outermost semi-major axis (60 R★ if planetless), 24° above
 *    the ecliptic — slightly oblique;
 *  - planet/moon: ~4 radii (more if ringed), 20° above the ecliptic, in three-quarter lighting: the
 *    camera stands 50° in azimuth from the sun, so the terminator is in view.
 * Azimuths are chosen to minimise the rotation from the current view.
 */
import { Quaternion, Vector3 } from 'three';
import { DEG_TO_RAD } from '../../core/math';
import { KM_PER_LY } from '../../core/units';
import { type FocusHandle, isGalacticCentre } from './focus';
import { nearestAngle } from './damping';

export interface OrbitPose {
  yaw: number;
  pitch: number;
  distanceKm: number;
}

export const OVERVIEW_DISTANCE_KM = 110_000 * KM_PER_LY;
export const OVERVIEW_PITCH = 35 * DEG_TO_RAD;
export const NEIGHBOURHOOD_DISTANCE_KM = 40 * KM_PER_LY;
export const NEIGHBOURHOOD_PITCH = 28 * DEG_TO_RAD;
export const SYSTEM_PITCH = 24 * DEG_TO_RAD;
export const BODY_PITCH = 20 * DEG_TO_RAD;
/** Azimuth between the camera and the sun at a body: 50° shows a gibbous disk and its terminator. */
export const THREE_QUARTER_AZIMUTH = 50 * DEG_TO_RAD;
/** Pitch never quite reaches the poles (the up vector would be undefined). */
export const MAX_PITCH = 89 * DEG_TO_RAD;

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _inv = new Quaternion();
const _d = new Vector3();

/** Camera orientation (galactic axes) for an orbit pose in `frame`. */
export function orbitQuaternion(
  frame: Quaternion,
  yaw: number,
  pitch: number,
  out: Quaternion,
): Quaternion {
  out.setFromAxisAngle(AXIS_Y, yaw);
  _q.setFromAxisAngle(AXIS_X, -pitch);
  return out.multiply(_q).premultiply(frame);
}

/** Unit direction from the focus to the camera (galactic axes) for an orbit pose in `frame`. */
export function orbitDirection(frame: Quaternion, yaw: number, pitch: number, out: Vector3): Vector3 {
  const c = Math.cos(pitch);
  return out.set(c * Math.sin(yaw), Math.sin(pitch), c * Math.cos(yaw)).applyQuaternion(frame);
}

/** Yaw/pitch, in `frame`, of a galactic-axes direction from the focus to the camera. */
export function directionToYawPitch(
  dirG: Vector3,
  frame: Quaternion,
  out: { yaw: number; pitch: number },
): { yaw: number; pitch: number } {
  _d.copy(dirG).applyQuaternion(_inv.copy(frame).invert());
  const len = _d.length();
  if (len === 0) {
    out.yaw = 0;
    out.pitch = 0;
    return out;
  }
  out.yaw = Math.atan2(_d.x, _d.z);
  out.pitch = Math.asin(Math.max(-1, Math.min(1, _d.y / len)));
  return out;
}

/** The composed default viewing distance for a focus, km. */
export function framingDistanceKm(h: FocusHandle): number {
  let d: number;
  if (h.kind === 'galaxy') {
    return isGalacticCentre(h) ? OVERVIEW_DISTANCE_KM : NEIGHBOURHOOD_DISTANCE_KM;
  }
  if (h.body) {
    const ring = h.body.rings?.outerRadiusKm ?? 0;
    d = Math.max(4 * h.radiusKm, 2.4 * ring);
    return Math.min(Math.max(d, 1.2 * h.minDistanceKm), 0.8 * h.planetZoneKm);
  }
  const system = h.system;
  let outer = 0;
  for (const p of system?.planets ?? []) outer = Math.max(outer, p.orbit.semiMajorAxisKm);
  d = outer > 0 ? 2.5 * outer : 60 * h.radiusKm;
  return Math.min(Math.max(d, 1.5 * h.minDistanceKm), 0.8 * h.maxDistanceKm);
}

const _pose = { yaw: 0, pitch: 0 };

/**
 * The arrival pose for a flight to `h`. `fromDirG` is the unit direction from `h` to the camera at
 * departure (galactic axes); the arrival azimuth stays as close to it as the composition allows.
 */
export function arrivalPose(h: FocusHandle, fromDirG: Vector3, out: OrbitPose): OrbitPose {
  directionToYawPitch(fromDirG, h.frame, _pose);
  out.distanceKm = framingDistanceKm(h);
  if (h.kind === 'galaxy') {
    out.yaw = _pose.yaw;
    out.pitch = isGalacticCentre(h) ? OVERVIEW_PITCH : NEIGHBOURHOOD_PITCH;
  } else if (h.body) {
    // The sun (the star at the origin of S) as seen from the body, in S.
    const sunYaw = Math.atan2(-h.posS.x, -h.posS.z);
    const a = nearestAngle(_pose.yaw, sunYaw + THREE_QUARTER_AZIMUTH);
    const b = nearestAngle(_pose.yaw, sunYaw - THREE_QUARTER_AZIMUTH);
    out.yaw = Math.abs(a - _pose.yaw) <= Math.abs(b - _pose.yaw) ? a : b;
    out.pitch = BODY_PITCH;
  } else {
    out.yaw = _pose.yaw;
    out.pitch = SYSTEM_PITCH;
  }
  return out;
}
