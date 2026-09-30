import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FocusTarget } from '../../core/types';
import { KM_PER_LY } from '../../core/units';
import { getUniverse } from '../../universe';
import { CameraRig } from './CameraRig';
import { type FocusHandle, resolveFocus } from './focus';
import { type GalacticPoint, relativeKm } from './frames';
import { orbitQuaternion } from './framing';

const universe = getUniverse();
const HOME = universe.homeStarId();
const HALCYON = `${HOME}.d`;
const FOV = (50 * Math.PI) / 180;
const DAYS = 9800;

const resolve = (t: FocusTarget): FocusHandle | null => resolveFocus(universe, t);
const handle = (t: FocusTarget): FocusHandle => resolve(t) as FocusHandle;

function rigAt(target: FocusTarget, distanceKm: number): CameraRig {
  const focus = handle(target);
  focus.update(DAYS);
  return new CameraRig(resolve, focus, { yaw: 0.4, pitch: 0.3, distanceKm }, FOV);
}

/** Camera position relative to a fixed reference point (km, galactic axes). */
function cameraFrom(rig: CameraRig, ref: GalacticPoint): Vector3 {
  return relativeKm(rig.anchor, ref, new Vector3()).add(rig.offsetKm);
}

function run(rig: CameraRig, seconds: number, simDays = DAYS, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) rig.update(dt, simDays);
}

describe('CameraRig', () => {
  it('arrives exactly at the composed pose, relative to the moving destination', () => {
    const rig = rigAt({ kind: 'galaxy', centerLy: [0, 0, 0] }, 110_000 * KM_PER_LY);
    const to = handle({ kind: 'planet', id: HALCYON });
    let arrived: FocusHandle | null = null;
    rig.events = { onArrive: (h) => (arrived = h) };
    rig.flyTo(to, false, DAYS);
    const flight = rig.flight;
    expect(flight).not.toBeNull();
    expect(flight?.durationSec).toBeGreaterThan(1.5);
    expect(flight?.durationSec).toBeLessThanOrEqual(9);
    run(rig, 10);
    expect(arrived).toBe(to);
    expect(rig.flight).toBeNull();
    expect(rig.anchor).toBe(to);
    const pose = flight?.arrival ?? { yaw: 0, pitch: 0, distanceKm: 0 };
    expect(rig.offsetKm.length() / pose.distanceKm).toBeCloseTo(1, 12);
    const q = orbitQuaternion(to.frame, pose.yaw, pose.pitch, new Quaternion());
    expect(rig.quaternion.angleTo(q)).toBeLessThan(1e-9);
  });

  it('keeps the camera continuous when the flight anchor switches at mid-path', () => {
    const rig = rigAt({ kind: 'planet', id: HALCYON }, 40_000);
    const to = handle({ kind: 'star', id: '1.399.-1.-277.1' });
    rig.flyTo(to, false, DAYS);
    const flight = rig.flight;
    if (!flight) throw new Error('no flight');
    const ref = handle({ kind: 'star', id: HOME }).starPoint;
    // Find the progress where s = S/2 by bisection on the anchor switch.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      flight.setProgress(mid);
      rig.update(0, DAYS);
      if (rig.anchor === flight.from) lo = mid;
      else hi = mid;
    }
    flight.setProgress(lo);
    rig.update(0, DAYS);
    const before = cameraFrom(rig, ref);
    flight.setProgress(hi);
    rig.update(0, DAYS);
    const after = cameraFrom(rig, ref);
    // Tens of light-years out, the two anchors agree to well under a kilometre.
    expect(before.distanceTo(after)).toBeLessThan(1);
    expect(before.length()).toBeGreaterThan(1e12);
  });

  it('interrupting a flight keeps position and orientation, then settles on the destination', () => {
    const rig = rigAt({ kind: 'planet', id: HALCYON }, 40_000);
    const to = handle({ kind: 'planet', id: `${HOME}.f` });
    rig.flyTo(to, false, DAYS);
    run(rig, 1.2);
    const ref = handle({ kind: 'star', id: HOME }).starPoint;
    const pos = cameraFrom(rig, ref);
    const q = rig.quaternion.clone();
    rig.orbit(0, 0); // user grabs the camera
    rig.update(0, DAYS);
    expect(rig.flight).toBeNull();
    expect(rig.focus).toBe(to);
    expect(cameraFrom(rig, ref).distanceTo(pos) / pos.length()).toBeLessThan(1e-12);
    expect(rig.quaternion.angleTo(q)).toBeLessThan(1e-6); // angleTo's acos is noise-limited near 0
    run(rig, 3);
    // The view has swung onto the new focus: it looks straight at it.
    const forward = new Vector3(0, 0, -1).applyQuaternion(rig.quaternion);
    const toFocus = rig.offsetKm.clone().negate().normalize();
    expect(forward.angleTo(toFocus)).toBeLessThan(1e-3);
  });

  it('hands the focus over to the parent when zooming out, without moving the camera', () => {
    const rig = rigAt({ kind: 'planet', id: HALCYON }, 30_000);
    const ref = handle({ kind: 'star', id: HOME }).starPoint;
    run(rig, 0.1);
    const pos = cameraFrom(rig, ref);
    let changed: FocusHandle | null = null;
    rig.events = { onFocusChanged: (h) => (changed = h) };
    rig.zoom(rig.focus.maxDistanceKm / 20_000);
    expect(changed).not.toBeNull();
    expect(rig.focus.kind).toBe('star');
    rig.update(0, DAYS);
    expect(cameraFrom(rig, ref).distanceTo(pos)).toBeLessThan(1e-3);
  });

  it('follows a moving planet: the offset is unchanged as sim time advances', () => {
    const rig = rigAt({ kind: 'planet', id: HALCYON }, 25_000);
    run(rig, 0.5);
    const offset = rig.offsetKm.clone();
    rig.update(1 / 60, DAYS + 30); // a month later the planet is ~7e7 km away
    expect(rig.offsetKm.distanceTo(offset)).toBeLessThan(1e-6);
  });

  it('keeps the point under the cursor fixed while zooming a galaxy point', () => {
    const rig = rigAt({ kind: 'galaxy', centerLy: [0, 0, 0] }, 60_000 * KM_PER_LY);
    run(rig, 0.1);
    // A ray 10° off the view axis, towards screen right.
    const dir = new Vector3(Math.sin(0.17), 0, -Math.cos(0.17)).applyQuaternion(rig.quaternion);
    const t = -rig.offsetKm.y / dir.y;
    const anchorLy = rig.focus.starLy
      .clone()
      .addScaledVector(rig.offsetKm.clone().addScaledVector(dir, t), 1 / KM_PER_LY);
    rig.autoRotate = false;
    rig.zoom(0.25, dir);
    run(rig, 3);
    const cam = rig.focus.starLy.clone().addScaledVector(rig.offsetKm, 1 / KM_PER_LY);
    const seen = anchorLy.clone().sub(cam).normalize();
    expect(seen.angleTo(dir)).toBeLessThan(1e-6);
  });

  it('coasts after a flick and stops after a slow release', () => {
    const yawOf = (rig: CameraRig) =>
      Math.atan2(
        rig.offsetKm.clone().applyQuaternion(rig.focus.frame.clone().invert()).x,
        rig.offsetKm.clone().applyQuaternion(rig.focus.frame.clone().invert()).z,
      );
    const flick = rigAt({ kind: 'planet', id: HALCYON }, 30_000);
    for (let i = 0; i < 6; i++) {
      flick.orbit(0.02, 0); // 1.2 rad/s
      flick.update(1 / 60, DAYS);
    }
    const released = yawOf(flick);
    run(flick, 0.5);
    const coasted = yawOf(flick) - released;
    expect(coasted).toBeGreaterThan(0.2); // 0.12 rad of pending damping + ~0.24 rad of momentum
    run(flick, 2);
    const settled = yawOf(flick);
    run(flick, 1);
    expect(Math.abs(yawOf(flick) - settled)).toBeLessThan(1e-4);

    const slow = rigAt({ kind: 'planet', id: HALCYON }, 30_000);
    for (let i = 0; i < 6; i++) {
      slow.orbit(0.001, 0); // 0.06 rad/s: below the coasting threshold
      slow.update(1 / 60, DAYS);
    }
    run(slow, 1);
    const stop = yawOf(slow);
    run(slow, 1);
    expect(Math.abs(yawOf(slow) - stop)).toBeLessThan(1e-6);
  });

  it('fades instead of flying under reduced motion', () => {
    const rig = rigAt({ kind: 'planet', id: HALCYON }, 30_000);
    const to = handle({ kind: 'star', id: HOME });
    rig.flyTo(to, true, DAYS);
    expect(rig.flight).toBeNull();
    run(rig, 0.1);
    expect(rig.fade).toBeLessThan(1);
    run(rig, 1);
    expect(rig.fade).toBe(1);
    expect(rig.focus).toBe(to);
  });
});
