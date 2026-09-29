/**
 * Two-body Keplerian orbits (elliptic, 0 ≤ e < 1).
 *
 * Elements (src/core/types.ts `OrbitalElements`) are referred to the parent's reference plane in
 * ASTRONOMICAL axes: X = reference direction, Z = north (the plane normal). A position is built
 * the textbook way (e.g. Murray & Dermott, Solar System Dynamics §2.8):
 *
 *   perifocal  (x_p, y_p) = (a(cos E − e), a√(1−e²) sin E)        E from Kepler's equation
 *   r_astro = x_p·P + y_p·Q,   [P Q] = R_z(Ω) · R_x(i) · R_z(ω)  (first two columns)
 *
 * and finally mapped to Sidereal's Y-up frames with (Xa, Ya, Za) → (Xa, Za, −Ya). That map is a
 * proper rotation (det = +1), so handedness is preserved: prograde orbits (i < 90°) run
 * counter-clockwise when seen from +Y, the reference plane is XZ and +Y is its north.
 * Under the map R_z(θ) becomes a rotation about +Y by θ and R_x(θ) a rotation about +X by θ.
 *
 * All functions are allocation-free except `orbitPathKm`, which returns a new buffer.
 */
import type { Vector3 } from 'three';
import { TAU, wrapAngle } from '../core/math';
import type { OrbitalElements } from '../core/types';
import { G_SI, SECONDS_PER_DAY } from '../core/units';

/** Eccentricities are clamped to [0, MAX_ECCENTRICITY] — hyperbolic orbits are not modelled. */
export const MAX_ECCENTRICITY = 0.999_999;

function clampEccentricity(e: number): number {
  return e > 0 ? (e < MAX_ECCENTRICITY ? e : MAX_ECCENTRICITY) : 0;
}

/**
 * Solve Kepler's equation M = E − e·sin E for the eccentric anomaly E.
 *
 * Newton–Raphson from Danby's (1987) starter E₀ = M + 0.85·e·sign(sin M), which converges for
 * every M and e < 1; typically 3–6 iterations, residual ≲ 1e-15. M is reduced to (−π, π] for the
 * iteration and the whole revolutions are added back, so E − e·sin E = M holds for any M.
 */
export function solveKepler(M: number, e: number): number {
  const ecc = clampEccentricity(e);
  const m = wrapAngle(M);
  if (ecc === 0 || m === 0) return M;
  let E = m + 0.85 * ecc * (m > 0 ? 1 : -1);
  for (let k = 0; k < 64; k++) {
    const sinE = Math.sin(E);
    const cosE = Math.cos(E);
    const dE = (E - ecc * sinE - m) / (1 - ecc * cosE);
    E -= dE;
    if (Math.abs(dE) <= 1e-15) break;
  }
  return E + (M - m);
}

/** True anomaly ν from the eccentric anomaly (half-angle form, well conditioned for all E). */
export function trueAnomalyFromEccentric(E: number, e: number): number {
  const ecc = clampEccentricity(e);
  return 2 * Math.atan2(Math.sqrt(1 + ecc) * Math.sin(E / 2), Math.sqrt(1 - ecc) * Math.cos(E / 2));
}

/**
 * Mean anomaly at `simDays`, in (−π, π]. Only the fractional revolution is scaled by 2π, which keeps
 * full precision even after tens of thousands of orbits. A non-positive or non-finite period
 * freezes the body at its epoch anomaly.
 */
export function meanAnomalyAt(orbit: OrbitalElements, simDays: number): number {
  const P = orbit.periodDays;
  if (!(P > 0) || !Number.isFinite(P)) return wrapAngle(orbit.meanAnomalyEpochRad);
  const rev = simDays / P;
  return wrapAngle(orbit.meanAnomalyEpochRad + TAU * (rev - Math.floor(rev)));
}

/** Eccentric anomaly at `simDays`. */
export function eccentricAnomalyAt(orbit: OrbitalElements, simDays: number): number {
  return solveKepler(meanAnomalyAt(orbit, simDays), orbit.eccentricity);
}

/** Mean longitude λ = Ω + ω + M at `simDays`, in (−π, π]. */
export function meanLongitude(orbit: OrbitalElements, simDays: number): number {
  return wrapAngle(
    orbit.longitudeAscendingNodeRad + orbit.argumentPeriapsisRad + meanAnomalyAt(orbit, simDays),
  );
}

/** Scratch perifocal basis: P (towards periapsis) then Q (90° ahead), already in Y-up axes. */
const basis = new Float64Array(6);

/** Fill `b` with the perifocal unit vectors P and Q of `orbit`, mapped to the Y-up parent frame. */
function perifocalBasis(orbit: OrbitalElements, b: Float64Array): Float64Array {
  const cO = Math.cos(orbit.longitudeAscendingNodeRad);
  const sO = Math.sin(orbit.longitudeAscendingNodeRad);
  const ci = Math.cos(orbit.inclinationRad);
  const si = Math.sin(orbit.inclinationRad);
  const cw = Math.cos(orbit.argumentPeriapsisRad);
  const sw = Math.sin(orbit.argumentPeriapsisRad);
  // Columns of R_z(Ω)·R_x(i)·R_z(ω) in astronomical axes …
  const px = cw * cO - sw * ci * sO;
  const py = cw * sO + sw * ci * cO;
  const pz = sw * si;
  const qx = -sw * cO - cw * ci * sO;
  const qy = -sw * sO + cw * ci * cO;
  const qz = cw * si;
  // … mapped (Xa, Ya, Za) → (Xa, Za, −Ya).
  b[0] = px;
  b[1] = pz;
  b[2] = -py;
  b[3] = qx;
  b[4] = qz;
  b[5] = -qy;
  return b;
}

/** out = xp·P + yp·Q (the perifocal vector rotated into the parent frame). */
function perifocalToParent(orbit: OrbitalElements, xp: number, yp: number, out: Vector3): Vector3 {
  const b = perifocalBasis(orbit, basis);
  return out.set(
    xp * (b[0] as number) + yp * (b[3] as number),
    xp * (b[1] as number) + yp * (b[4] as number),
    xp * (b[2] as number) + yp * (b[5] as number),
  );
}

/**
 * Position relative to the parent, in the parent's reference frame (Y-up), km. Planets: frame S
 * (ecliptic). Moons: the parent planet's equatorial frame — use `moonPositionKm` in
 * ./orientation.ts to get it in frame S.
 */
export function orbitalPositionKm(orbit: OrbitalElements, simDays: number, out: Vector3): Vector3 {
  const e = clampEccentricity(orbit.eccentricity);
  const a = orbit.semiMajorAxisKm;
  const E = solveKepler(meanAnomalyAt(orbit, simDays), e);
  return perifocalToParent(
    orbit,
    a * (Math.cos(E) - e),
    a * Math.sqrt(1 - e * e) * Math.sin(E),
    out,
  );
}

/**
 * Orbital velocity relative to the parent (same frame as `orbitalPositionKm`), km/s.
 * dE/dt = n / (1 − e cos E), with mean motion n = 2π / P.
 */
export function orbitalVelocityKms(orbit: OrbitalElements, simDays: number, out: Vector3): Vector3 {
  const e = clampEccentricity(orbit.eccentricity);
  const a = orbit.semiMajorAxisKm;
  const P = orbit.periodDays;
  if (!(P > 0) || !Number.isFinite(P)) return out.set(0, 0, 0);
  const E = solveKepler(meanAnomalyAt(orbit, simDays), e);
  const cosE = Math.cos(E);
  const eDot = TAU / (P * SECONDS_PER_DAY) / (1 - e * cosE);
  return perifocalToParent(
    orbit,
    -a * Math.sin(E) * eDot,
    a * Math.sqrt(1 - e * e) * cosE * eDot,
    out,
  );
}

/**
 * Closed orbit polyline relative to the parent (same frame as `orbitalPositionKm`), as xyz
 * triples: `segments + 1` vertices starting at periapsis, the last repeating the first so it can
 * be drawn as a `THREE.Line` (or drop it for `LineLoop`). Sampled uniformly in eccentric anomaly,
 * which spaces vertices evenly around the ellipse — sampling uniformly in time would leave long
 * straight chords at periapsis, where the body moves fastest.
 * Note float32: ~7 significant digits (≈ 450 km at 50 AU) — fine for lines seen at orbit scale.
 */
export function orbitPathKm(orbit: OrbitalElements, segments: number): Float32Array {
  const n = Math.max(3, Math.floor(segments));
  const e = clampEccentricity(orbit.eccentricity);
  const a = orbit.semiMajorAxisKm;
  const semiMinor = a * Math.sqrt(1 - e * e);
  const [px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0] = perifocalBasis(orbit, basis);
  const out = new Float32Array((n + 1) * 3);
  for (let k = 0; k <= n; k++) {
    // k = n wraps to E = 0 exactly, so the loop closes bit-for-bit.
    const E = k === n ? 0 : (TAU * k) / n;
    const xp = a * (Math.cos(E) - e);
    const yp = semiMinor * Math.sin(E);
    out[k * 3] = xp * px + yp * qx;
    out[k * 3 + 1] = xp * py + yp * qy;
    out[k * 3 + 2] = xp * pz + yp * qz;
  }
  return out;
}

/** Unit normal of the orbital plane (direction of the angular momentum) in the parent frame. */
export function orbitNormal(orbit: OrbitalElements, out: Vector3): Vector3 {
  const si = Math.sin(orbit.inclinationRad);
  return out.set(
    si * Math.sin(orbit.longitudeAscendingNodeRad),
    Math.cos(orbit.inclinationRad),
    si * Math.cos(orbit.longitudeAscendingNodeRad),
  );
}

export function periapsisKm(orbit: OrbitalElements): number {
  return orbit.semiMajorAxisKm * (1 - clampEccentricity(orbit.eccentricity));
}

export function apoapsisKm(orbit: OrbitalElements): number {
  return orbit.semiMajorAxisKm * (1 + clampEccentricity(orbit.eccentricity));
}

/** Kepler's third law: P = 2π √(a³ / G(M + m)). Masses in kg. */
export function orbitalPeriodDays(
  semiMajorAxisKm: number,
  centralMassKg: number,
  orbitingMassKg = 0,
): number {
  const aM = semiMajorAxisKm * 1000;
  return (
    (TAU * Math.sqrt((aM * aM * aM) / (G_SI * (centralMassKg + orbitingMassKg)))) / SECONDS_PER_DAY
  );
}

/** Inverse of `orbitalPeriodDays`: a = ∛(G(M + m) (P / 2π)²). */
export function semiMajorAxisKmForPeriod(
  periodDays: number,
  centralMassKg: number,
  orbitingMassKg = 0,
): number {
  const t = (periodDays * SECONDS_PER_DAY) / TAU;
  return Math.cbrt(G_SI * (centralMassKg + orbitingMassKg) * t * t) / 1000;
}
