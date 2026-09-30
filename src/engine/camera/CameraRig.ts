/**
 * CameraRig — a focus-based orbit camera with hierarchical position (docs/ARCHITECTURE.md §4, §7).
 *
 * AUTHORITATIVE STATE: (anchor focus, offsetKm) — the camera's offset from the anchor's centre in km,
 * galactic axes, float64. The anchor is the focus, or a flight endpoint while flying. Everything
 * else (galactic ly, system km) is derived per frame by the engine, so precision is always relative
 * to what you are looking at, and orbiting a moving planet is jitter-free by construction: the
 * planet's position is never added to and subtracted from the camera's.
 *
 * Orbit mode: yaw/pitch/log-distance in the focus's reference frame (G for galaxy points, the system
 * ecliptic S for stars and bodies), each damped towards its target (frame-rate independent, see
 * ./damping.ts). Zoom is logarithmic, so it feels the same at 100 km and 100 kly.
 *
 * Discontinuities are never shown: whenever the ideal orientation jumps (focus hand-over, a flight
 * interrupted by the user) the rig stores a correction rotation `ideal⁻¹ · actual` and lets it decay
 * to identity, so the view swings smoothly onto the new focus.
 */
import { Quaternion, Vector3 } from 'three';
import { clamp } from '../../core/math';
import type { FocusTarget } from '../../core/types';
import { KM_PER_LY } from '../../core/units';
import { damp, dampFactor } from './damping';
import { Flight } from './flight';
import { type FocusHandle, parentTarget } from './focus';
import { relativeKm } from './frames';
import {
  arrivalPose,
  directionToYawPitch,
  MAX_PITCH,
  type OrbitPose,
  orbitDirection,
  orbitQuaternion,
} from './framing';

/** Orbit (yaw/pitch) convergence rate, 1/s. */
const ROTATE_LAMBDA = 11;
/** Zoom convergence rate, 1/s. */
const ZOOM_LAMBDA = 7;
/** Orientation-correction decay rate, 1/s (~0.45 s to settle). */
const CORRECTION_LAMBDA = 6.5;
/** Orbit momentum friction, 1/s: a released drag coasts ~1/FRICTION seconds. */
const ORBIT_FRICTION = 5;
/** Momentum is only kept for flicks faster than this, rad/s (a slow release just stops). */
const MIN_COAST_SPEED = 0.15;
/** Seconds without input before the galaxy overview starts to drift round. */
const IDLE_BEFORE_AUTOROTATE_SEC = 4;
/** Reduced-motion "flight": fade out, cut, fade in. */
const FADE_OUT_SEC = 0.22;
const FADE_IN_SEC = 0.32;

export interface RigEvents {
  /** A flight or cut reached its destination (not called for interrupted flights). */
  onArrive?(to: FocusHandle, from: FocusHandle): void;
  /** The focus changed without a flight completing (hand-over on zoom-out, interrupted flight). */
  onFocusChanged?(focus: FocusHandle): void;
}

/** Resolves focus targets (the engine binds this to the current universe). */
export type FocusResolver = (target: FocusTarget) => FocusHandle | null;

interface FadeJump {
  from: FocusHandle;
  to: FocusHandle;
  pose: OrbitPose;
  elapsed: number;
  jumped: boolean;
}

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _pose = { yaw: 0, pitch: 0 };
const _arrival: OrbitPose = { yaw: 0, pitch: 0, distanceKm: 1 };
const IDENTITY = new Quaternion();

export class CameraRig {
  /** The orbit focus (after a flight: its destination). */
  focus: FocusHandle;
  /** Camera offset from `anchor`, km, galactic axes — the authoritative camera position. */
  readonly offsetKm = new Vector3();
  /** Camera orientation, galactic axes. */
  readonly quaternion = new Quaternion();
  readonly fovY: number;
  flight: Flight | null = null;
  /** Exposure multiplier for reduced-motion fades (1 = no fade). */
  fade = 1;
  autoRotate = true;
  /** Idle auto-rotation speed, rad/s. */
  autoRotateRate = 0.018;
  /** Viewport width / height (set by the engine): arrival framings fit portrait screens too. */
  viewAspect = 1;
  events: RigEvents = {};
  /** Incremented on every discontinuous camera change (cuts), so overlays can snap instead of fade. */
  cutSerial = 0;

  private anchorHandle: FocusHandle;
  private fadeJump: FadeJump | null = null;
  private yaw = 0;
  private pitch = 0;
  private logDist = 0;
  private yawT = 0;
  private pitchT = 0;
  private logDistT = 0;
  private readonly correction = new Quaternion();
  /** Orbit input since the last update, and the momentum it implies (rad, rad/s). */
  private pendingYaw = 0;
  private pendingPitch = 0;
  private yawVel = 0;
  private pitchVel = 0;
  private readonly zoomAnchorLy = new Vector3();
  private hasZoomAnchor = false;
  private idleSec = 0;
  private readonly resolve: FocusResolver;

  constructor(resolve: FocusResolver, focus: FocusHandle, pose: OrbitPose, fovY: number) {
    this.resolve = resolve;
    this.focus = focus;
    this.anchorHandle = focus;
    this.fovY = fovY;
    this.setPose(pose);
    this.composeOrbit();
  }

  /** The focus the current `offsetKm` is relative to (a flight endpoint while flying). */
  get anchor(): FocusHandle {
    return this.anchorHandle;
  }

  get distanceKm(): number {
    return this.offsetKm.length();
  }

  /** Destination of the active flight or fade, else null. */
  get destination(): FocusHandle | null {
    return this.flight?.to ?? this.fadeJump?.to ?? null;
  }

  /** 0..1 progress of the active flight or fade, else null. */
  get progress(): number | null {
    if (this.flight) return this.flight.progress;
    if (this.fadeJump) return Math.min(1, this.fadeJump.elapsed / (FADE_OUT_SEC + FADE_IN_SEC));
    return null;
  }

  /** 0..1 normalised travel speed (for FX and audio). */
  get travel(): number {
    return this.flight?.travel ?? 0;
  }

  // ───────────────────────────────────────────── commands

  /** Rotate the orbit by angles (rad); pitch is clamped short of the poles. */
  orbit(dYaw: number, dPitch: number): void {
    this.interrupt();
    this.touch();
    this.hasZoomAnchor = false;
    this.pendingYaw += dYaw;
    this.pendingPitch += dPitch;
  }

  /**
   * Multiply the target distance by `factor` (< 1 zooms in). For galaxy points, `cursorDirG` (unit
   * ray direction under the cursor, galactic axes) keeps the point under the cursor fixed.
   * Zooming out past the focus's maximum hands the focus over to its parent (planet → star → galaxy).
   */
  zoom(factor: number, cursorDirG: Vector3 | null = null): void {
    if (!(factor > 0) || factor === 1) return;
    this.interrupt();
    this.touch();
    let next = this.logDistT + Math.log(factor);
    if (factor > 1 && next > Math.log(this.focus.maxDistanceKm) + 1e-9) {
      const parent = parentTarget(this.focus);
      const handle = parent ? this.resolve(parent) : null;
      if (handle) {
        const excess = next - this.logDistT;
        this.reanchor(handle);
        this.events.onFocusChanged?.(handle);
        next = this.logDistT + excess;
      }
    }
    const lo = Math.log(this.focus.minDistanceKm);
    const hi = Math.max(Math.log(this.focus.maxDistanceKm), Math.min(this.logDistT, next));
    this.logDistT = clamp(next, lo, hi);
    if (this.focus.kind === 'galaxy' && cursorDirG) this.setZoomAnchor(cursorDirG);
    else this.hasZoomAnchor = false;
  }

  /**
   * Pan a galaxy-point focus along the galactic plane by a screen drag (CSS px), scaled so the
   * disk follows the pointer. No-op for other foci.
   */
  pan(dxPx: number, dyPx: number, viewportHeightPx: number): void {
    if (this.focus.kind !== 'galaxy') return;
    this.interrupt();
    this.touch();
    this.hasZoomAnchor = false;
    const kmPerPx =
      (this.offsetKm.length() * 2 * Math.tan(this.fovY / 2)) / Math.max(1, viewportHeightPx);
    // Camera right and a "forward on the plane" axis, projected onto the galactic plane (XZ).
    const right = _v.set(1, 0, 0).applyQuaternion(this.quaternion).setY(0);
    const fwd = _w.set(0, 0, -1).applyQuaternion(this.quaternion).setY(0);
    if (fwd.lengthSq() < 0.09) fwd.set(0, 1, 0).applyQuaternion(this.quaternion).setY(0);
    if (right.lengthSq() < 1e-12 || fwd.lengthSq() < 1e-12) return;
    right.normalize();
    fwd.normalize();
    const k = kmPerPx / KM_PER_LY;
    const c = this.focus.starLy;
    this.focus.setGalaxyCenter(
      c.x + (-right.x * dxPx + fwd.x * dyPx) * k,
      c.y,
      c.z + (-right.z * dxPx + fwd.z * dyPx) * k,
    );
  }

  /** Fly to a focus (van Wijk–Nuij), or fade-cut when `reducedMotion`. */
  flyTo(to: FocusHandle, reducedMotion: boolean, simDays: number): void {
    to.update(simDays);
    this.touch();
    this.hasZoomAnchor = false;
    const start = this.captureStart(to);
    arrivalPose(to, _v.copy(start.dir), _arrival, this.viewAspect, this.fovY);
    if (reducedMotion) {
      this.cancelMotion();
      this.fadeJump = { from: this.focus, to, pose: { ..._arrival }, elapsed: 0, jumped: false };
      return;
    }
    const flight = new Flight(
      {
        anchor: this.anchorHandle,
        lookAtKm: start.lookAt,
        distanceKm: start.distanceKm,
        quaternion: this.quaternion,
      },
      to,
      _arrival,
      this.fovY,
    );
    this.cancelMotion();
    this.flight = flight;
  }

  /** Cut to a focus: to `pose` when given, else to its composed arrival framing. */
  jumpTo(to: FocusHandle, simDays: number, pose: OrbitPose | null = null): void {
    to.update(simDays);
    const from = this.focus;
    if (!pose) {
      relativeKm(this.anchorHandle, to, _v).add(this.offsetKm);
      if (_v.lengthSq() === 0) _v.set(0, 0, 1);
      arrivalPose(to, _v.normalize(), _arrival, this.viewAspect, this.fovY);
    }
    this.cancelMotion();
    this.focus = to;
    this.anchorHandle = to;
    this.setPose(pose ?? _arrival);
    this.correction.identity();
    this.composeOrbit();
    this.cutSerial++;
    this.events.onArrive?.(to, from);
  }

  /** Fly back to the composed framing of the current focus. */
  resetView(reducedMotion: boolean, simDays: number): void {
    this.flyTo(this.focus, reducedMotion, simDays);
  }

  /** Stop an active flight where it is; the rig then orbits the flight's destination. */
  interrupt(): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    const to = flight.to;
    if (this.anchorHandle !== to) {
      this.offsetKm.add(relativeKm(this.anchorHandle, to, _v));
      this.anchorHandle = to;
    }
    this.focus = to;
    this.adoptCamera();
    this.events.onFocusChanged?.(to);
  }

  /** Debug: freeze an active flight at a progress in [0, 1]. */
  setFlightProgress(t: number): void {
    this.flight?.setProgress(t);
  }

  // ───────────────────────────────────────────── per frame

  /** Advance damping, flights and fades by dtSec; everything is evaluated at `simDays`. */
  update(dtSec: number, simDays: number): void {
    this.focus.update(simDays);
    const flight = this.flight;
    if (flight) {
      if (flight.from !== this.focus) flight.from.update(simDays);
      if (flight.to !== this.focus) flight.to.update(simDays);
      flight.advance(dtSec);
      this.anchorHandle = flight.evaluate(this.offsetKm, this.quaternion);
      if (flight.done) this.finishFlight(flight);
      return;
    }
    const fj = this.fadeJump;
    if (fj) this.stepFade(fj, dtSec, simDays);

    this.applyOrbitInput(dtSec);
    this.idleSec += dtSec;
    if (
      this.autoRotate &&
      this.focus.kind === 'galaxy' &&
      this.idleSec > IDLE_BEFORE_AUTOROTATE_SEC
    ) {
      this.yawT += this.autoRotateRate * dtSec;
    }
    this.yaw = damp(this.yaw, this.yawT, ROTATE_LAMBDA, dtSec);
    this.pitch = damp(this.pitch, this.pitchT, ROTATE_LAMBDA, dtSec);
    const before = this.logDist;
    this.logDist = damp(this.logDist, this.logDistT, ZOOM_LAMBDA, dtSec);
    if (this.hasZoomAnchor) this.followZoomAnchor(this.logDist - before);
    this.correction.slerp(IDENTITY, dampFactor(CORRECTION_LAMBDA, dtSec));
    this.composeOrbit();
  }

  // ───────────────────────────────────────────── internals

  private touch(): void {
    this.idleSec = 0;
  }

  /**
   * Apply this frame's orbit input and keep a velocity estimate; without input the orbit coasts on
   * that velocity with exponential friction, so a flick glides to a stop instead of halting.
   */
  private applyOrbitInput(dtSec: number): void {
    if (dtSec <= 0) return;
    if (this.pendingYaw !== 0 || this.pendingPitch !== 0) {
      const k = dampFactor(20, dtSec); // velocity EMA over the last few frames
      this.yawVel += (this.pendingYaw / dtSec - this.yawVel) * k;
      this.pitchVel += (this.pendingPitch / dtSec - this.pitchVel) * k;
      this.yawT += this.pendingYaw;
      this.pitchT = clamp(this.pitchT + this.pendingPitch, -MAX_PITCH, MAX_PITCH);
      this.pendingYaw = 0;
      this.pendingPitch = 0;
      return;
    }
    if (Math.hypot(this.yawVel, this.pitchVel) < MIN_COAST_SPEED) {
      this.yawVel = 0;
      this.pitchVel = 0;
      return;
    }
    const decay = Math.exp(-ORBIT_FRICTION * dtSec);
    this.yawT += this.yawVel * dtSec;
    this.pitchT = clamp(this.pitchT + this.pitchVel * dtSec, -MAX_PITCH, MAX_PITCH);
    this.yawVel *= decay;
    this.pitchVel *= decay;
  }

  private cancelMotion(): void {
    this.flight = null;
    if (this.fadeJump) {
      this.fadeJump = null;
      this.fade = 1;
    }
  }

  private setPose(pose: OrbitPose): void {
    this.yawVel = this.pitchVel = this.pendingYaw = this.pendingPitch = 0;
    this.yaw = this.yawT = pose.yaw;
    this.pitch = this.pitchT = clamp(pose.pitch, -MAX_PITCH, MAX_PITCH);
    this.logDist = this.logDistT = Math.log(Math.max(pose.distanceKm, 1e-9));
  }

  /** offset/quaternion from the orbit parameters around `focus` (the anchor in orbit mode). */
  private composeOrbit(): void {
    const f = this.focus;
    this.anchorHandle = f;
    orbitDirection(f.frame, this.yaw, this.pitch, this.offsetKm).multiplyScalar(
      Math.exp(this.logDist),
    );
    orbitQuaternion(f.frame, this.yaw, this.pitch, this.quaternion).multiply(this.correction);
  }

  /**
   * Re-express the current camera in a new focus: orbit parameters from the actual offset, and a
   * correction so the orientation stays exactly where it is and then swings onto the new focus.
   */
  private reanchor(to: FocusHandle): void {
    if (this.anchorHandle !== to) {
      this.offsetKm.add(relativeKm(this.anchorHandle, to, _v));
      this.anchorHandle = to;
    }
    this.focus = to;
    this.adoptCamera();
  }

  /** Orbit parameters and correction from the current offset & quaternion (anchor = focus). */
  private adoptCamera(): void {
    const d = this.offsetKm.length();
    if (d > 0) directionToYawPitch(_v.copy(this.offsetKm).divideScalar(d), this.focus.frame, _pose);
    this.yaw = this.yawT = _pose.yaw;
    this.pitch = this.pitchT = clamp(_pose.pitch, -MAX_PITCH, MAX_PITCH);
    this.logDist = this.logDistT = Math.log(Math.max(d, 1e-9));
    orbitQuaternion(this.focus.frame, this.yaw, this.pitch, _q);
    this.correction.copy(_q.invert()).multiply(this.quaternion).normalize();
    this.hasZoomAnchor = false;
  }

  /** Current look-at point (relative to the anchor), distance and direction for a new flight. */
  private captureStart(to: FocusHandle): { lookAt: Vector3; distanceKm: number; dir: Vector3 } {
    const lookAt = new Vector3();
    if (this.flight) lookAt.copy(this.flight.lookAtKm);
    const distanceKm = Math.max(1e-6, _w.subVectors(this.offsetKm, lookAt).length());
    // Direction from the destination to the camera (for the arrival azimuth).
    const dir = relativeKm(this.anchorHandle, to, new Vector3()).add(this.offsetKm);
    if (dir.lengthSq() === 0) dir.set(0, 0, 1).applyQuaternion(this.quaternion);
    dir.normalize();
    return { lookAt, distanceKm, dir };
  }

  private finishFlight(flight: Flight): void {
    this.flight = null;
    const from = flight.from;
    this.focus = flight.to;
    this.anchorHandle = flight.to;
    this.setPose(flight.arrival);
    this.correction.identity();
    this.composeOrbit();
    this.events.onArrive?.(flight.to, from);
  }

  private stepFade(fj: FadeJump, dtSec: number, simDays: number): void {
    fj.elapsed += dtSec;
    if (!fj.jumped) {
      this.fade = Math.max(0, 1 - fj.elapsed / FADE_OUT_SEC);
      if (fj.elapsed < FADE_OUT_SEC) return;
      fj.jumped = true;
      fj.to.update(simDays);
      this.focus = fj.to;
      this.anchorHandle = fj.to;
      this.setPose(fj.pose);
      this.correction.identity();
      this.cutSerial++;
      this.events.onArrive?.(fj.to, fj.from);
    }
    this.fade = Math.min(1, (fj.elapsed - FADE_OUT_SEC) / FADE_IN_SEC);
    if (this.fade >= 1) this.fadeJump = null;
  }

  /** Remember the galactic point under the cursor for a galaxy-point zoom. */
  private setZoomAnchor(dirG: Vector3): void {
    const o = this.offsetKm;
    const d = o.length();
    // Where the cursor ray meets the galactic plane through the focus, else a point at focus depth.
    let t = dirG.y !== 0 ? -o.y / dirG.y : -1;
    if (!(t > 0 && t < 20 * d)) t = d;
    _v.copy(o).addScaledVector(dirG, t); // relative to the focus, km
    this.zoomAnchorLy.copy(this.focus.starLy).addScaledVector(_v, 1 / KM_PER_LY);
    this.hasZoomAnchor = true;
  }

  /** Scale the focus about the zoom anchor by the zoom just applied, keeping it under the cursor. */
  private followZoomAnchor(dLog: number): void {
    // Kept until another command clears it: the damped zoom converges asymptotically.
    if (dLog === 0) return;
    const f = Math.exp(dLog);
    const a = this.zoomAnchorLy;
    const c = this.focus.starLy;
    this.focus.setGalaxyCenter(a.x + (c.x - a.x) * f, a.y + (c.y - a.y) * f, a.z + (c.z - a.z) * f);
  }
}
