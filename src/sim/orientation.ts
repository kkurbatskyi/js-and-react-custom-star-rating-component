/**
 * Body orientation: orbit plane, axial tilt, spin and tidal locking.
 *
 * Every quaternion here maps BODY vectors into the PARENT's reference frame (Y-up):
 *   planet → system ecliptic frame S;   moon → its planet's (non-rotating) equatorial frame.
 * Compose with `equatorialFrame(planet)` to bring a moon's vectors into S (`moonOrientation`,
 * `moonPositionKm` do that for you).
 *
 *   orbitFrame      = R_Y(Ω) · R_X(i)                 Y → orbit normal, X → ascending node
 *   equatorialFrame = orbitFrame · R_Y(α) · R_X(ε)    Y → spin axis (obliquity ε, lean azimuth α)
 *   bodyOrientation = equatorialFrame · R_Y(φ(t))     φ = spin angle (see `spinAngleRad`)
 *
 * R_A(θ) is a right-handed rotation by θ about axis A (counter-clockwise seen from +A); R_Y/R_X are
 * the Y-up images of the astronomical R_z/R_x (see ./kepler.ts).
 *
 * AXIAL TILT CONVENTION (ε = axialTiltRad, α = axialAzimuthRad) — other modules depend on this:
 *   Orbit-frame axes: x̂ₒ = ascending node, ŷₒ = orbit normal (angular momentum), ẑₒ = x̂ₒ × ŷₒ.
 *   For i = 0, Ω = 0 these are simply the parent frame's +X, +Y, +Z.
 *   • The north pole (body +Y) is ŷₒ tipped by ε towards the in-plane direction
 *         lean(α) = sin α · x̂ₒ + cos α · ẑₒ
 *     so  spin axis = sin ε · lean(α) + cos ε · ŷₒ = (sin ε sin α, cos ε, sin ε cos α) in (x̂ₒ, ŷₒ, ẑₒ).
 *     α = 0 leans the pole towards +ẑₒ, α = π/2 towards +x̂ₒ (the ascending node); α grows
 *     counter-clockwise seen from the orbit's north (right-hand rule about ŷₒ).
 *   • The tilt hinge — the equator's line of nodes on the orbit plane, and the equatorial frame's
 *     +X axis before spin — is  cos α · x̂ₒ − sin α · ẑₒ.
 *   • ε > π/2 flips the pole below the orbit plane (retrograde rotators like Venus may instead use
 *     a negative rotationPeriodHours with a small ε — both are honoured).
 *   • Seasons: with ŝ the unit vector from the planet to its star (in the orbit plane), the
 *     sub-stellar latitude is δ = asin(sin ε · (ŝ · lean(α))). Northern midsummer is when the
 *     planet sits at −lean(α) as seen from the star (the pole leans straight at it), northern
 *     midwinter at +lean(α).
 *
 * Body-fixed frame: +Y = north pole (the spin axis, right-hand rule), +X = prime meridian on the
 * equator. For tidally locked bodies +X is the sub-parent point: it faces the parent (up to the
 * physical libration caused by uniform spin on an eccentric orbit, amplitude ≈ 2e rad).
 *
 * All functions are allocation-free and write into `out`.
 */
import { Quaternion, Vector3 } from 'three';
import { TAU } from '../core/math';
import type { BodyBase, OrbitalElements } from '../core/types';
import { meanAnomalyAt, orbitalPositionKm } from './kepler';

/**
 * The subset of `BodyBase` that orientation depends on. Every `Planet`/`Moon` satisfies it, and so
 * can anything else that orbits and spins (a star in a binary, a test fixture).
 */
export type OrientedBody = Pick<
  BodyBase,
  'orbit' | 'axialTiltRad' | 'axialAzimuthRad' | 'rotationPeriodHours' | 'tidallyLocked'
>;

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
// Scratch objects — each is written by exactly one function (see src/core/threeUtil.ts).
const _rotA = new Quaternion(); // orbitFrame / tiltInOrbitFrame temporaries
const _rotB = new Quaternion();
const _orbit = new Quaternion(); // equatorialFrame: orbit-frame factor
const _tilt = new Quaternion(); // equatorialFrame / spinAngleRad: tilt factor
const _spin = new Quaternion(); // bodyOrientation: spin factor
const _parentEq = new Quaternion(); // spinAxis / moon helpers: the parent's equatorial frame
const _dir = new Vector3(); // spinAngleRad: direction to the parent

/** Orbit-plane frame: Y → orbit normal, X → ascending node. */
export function orbitFrame(orbit: OrbitalElements, out: Quaternion): Quaternion {
  _rotA.setFromAxisAngle(AXIS_Y, orbit.longitudeAscendingNodeRad);
  _rotB.setFromAxisAngle(AXIS_X, orbit.inclinationRad);
  return out.multiplyQuaternions(_rotA, _rotB);
}

/** Tilt inside the orbit frame: the spin axis leans ε from the orbit normal towards azimuth α. */
function tiltInOrbitFrame(body: OrientedBody, out: Quaternion): Quaternion {
  _rotA.setFromAxisAngle(AXIS_Y, body.axialAzimuthRad);
  _rotB.setFromAxisAngle(AXIS_X, body.axialTiltRad);
  return out.multiplyQuaternions(_rotA, _rotB);
}

/**
 * Rotation from the body's (non-rotating) equatorial frame — Y = spin axis — to its parent
 * reference frame: the orbit frame tilted by `axialTiltRad` about the in-plane axis selected by
 * `axialAzimuthRad`. Rings and moon orbits live in this frame.
 */
export function equatorialFrame(body: OrientedBody, out: Quaternion): Quaternion {
  orbitFrame(body.orbit, _orbit);
  tiltInOrbitFrame(body, _tilt);
  return out.multiplyQuaternions(_orbit, _tilt);
}

/** Spin axis (body +Y, the north pole) in the parent frame. */
export function spinAxis(body: OrientedBody, out: Vector3): Vector3 {
  return out.copy(AXIS_Y).applyQuaternion(equatorialFrame(body, _parentEq));
}

/**
 * Rotation angle about the spin axis at `simDays`.
 *  - Free rotation: φ = 2π · frac(simDays · 24 / rotationPeriodHours), in [0, 2π). A negative
 *    period spins backwards (retrograde); a zero or non-finite period does not spin.
 *  - Tidally locked: φ turns the prime meridian (+X) towards the parent as seen along the orbit's
 *    MEAN argument of latitude ω + M. Using the mean rather than the true anomaly is exactly what
 *    produces real optical libration in longitude. With a tilted axis the parent direction is
 *    projected onto the equator. Result in (−π, π].
 */
export function spinAngleRad(body: OrientedBody, simDays: number): number {
  if (body.tidallyLocked) {
    const u = body.orbit.argumentPeriapsisRad + meanAnomalyAt(body.orbit, simDays);
    // In the orbit frame the body sits at (cos u, 0, −sin u) from the parent; look back at it.
    _dir.set(-Math.cos(u), 0, Math.sin(u));
    _dir.applyQuaternion(tiltInOrbitFrame(body, _tilt).invert());
    // R_Y(φ)·X = (cos φ, 0, −sin φ) must point along the projected parent direction.
    return Math.atan2(-_dir.z, _dir.x);
  }
  const P = body.rotationPeriodHours;
  if (P === 0 || !Number.isFinite(P)) return 0;
  const rev = (simDays * 24) / P;
  return TAU * (rev - Math.floor(rev));
}

/** Full orientation (body-fixed → parent frame) = equatorialFrame × spin about Y. */
export function bodyOrientation(body: OrientedBody, simDays: number, out: Quaternion): Quaternion {
  _spin.setFromAxisAngle(AXIS_Y, spinAngleRad(body, simDays));
  return equatorialFrame(body, out).multiply(_spin);
}

/** A moon's position relative to its planet, in the planet's parent frame S (km). */
export function moonPositionKm(
  moon: Pick<BodyBase, 'orbit'>,
  parent: OrientedBody,
  simDays: number,
  out: Vector3,
): Vector3 {
  orbitalPositionKm(moon.orbit, simDays, out);
  return out.applyQuaternion(equatorialFrame(parent, _parentEq));
}

/** A moon's orientation (body-fixed → system frame S) = equatorialFrame(planet) × bodyOrientation(moon). */
export function moonOrientation(
  moon: OrientedBody,
  parent: OrientedBody,
  simDays: number,
  out: Quaternion,
): Quaternion {
  bodyOrientation(moon, simDays, out);
  return out.premultiply(equatorialFrame(parent, _parentEq));
}
