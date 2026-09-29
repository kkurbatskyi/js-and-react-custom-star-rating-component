import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import type { OrbitalElements } from '../core/types';
import { KM_PER_AU } from '../core/units';
import { orbitalPositionKm, orbitNormal } from './kepler';
import {
  bodyOrientation,
  equatorialFrame,
  moonOrientation,
  moonPositionKm,
  type OrientedBody,
  orbitFrame,
  spinAngleRad,
  spinAxis,
} from './orientation';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

function body(patch: Partial<OrientedBody> = {}, orbitPatch: Partial<OrbitalElements> = {}): OrientedBody {
  return {
    orbit: {
      semiMajorAxisKm: KM_PER_AU,
      eccentricity: 0,
      inclinationRad: 0,
      longitudeAscendingNodeRad: 0,
      argumentPeriapsisRad: 0,
      meanAnomalyEpochRad: 0,
      periodDays: 365.25,
      ...orbitPatch,
    },
    axialTiltRad: 0,
    axialAzimuthRad: 0,
    rotationPeriodHours: 24,
    tidallyLocked: false,
    ...patch,
  };
}

function randomBody(r: ReturnType<typeof createRng>, patch: Partial<OrientedBody> = {}): OrientedBody {
  return body(
    { axialTiltRad: r.range(0, Math.PI), axialAzimuthRad: r.range(0, 2 * Math.PI), rotationPeriodHours: r.range(-500, 500), ...patch },
    {
      eccentricity: r.range(0, 0.5),
      inclinationRad: r.range(0, Math.PI),
      longitudeAscendingNodeRad: r.range(0, 2 * Math.PI),
      argumentPeriapsisRad: r.range(0, 2 * Math.PI),
      meanAnomalyEpochRad: r.range(-Math.PI, Math.PI),
      periodDays: r.range(0.5, 5000),
    },
  );
}

describe('frames', () => {
  it('orbitFrame maps Y to the orbit normal and X to the ascending node', () => {
    const b = body({}, { inclinationRad: 0.4, longitudeAscendingNodeRad: 1.1 });
    const q = orbitFrame(b.orbit, new Quaternion());
    const n = orbitNormal(b.orbit, new Vector3());
    expect(Y.clone().applyQuaternion(q).distanceTo(n)).toBeLessThan(1e-12);
    // The ascending node is where the orbit crosses the reference plane going north.
    const node = X.clone().applyQuaternion(q);
    expect(node.y).toBeCloseTo(0, 12);
    expect(node.x).toBeCloseTo(Math.cos(1.1), 12);
    expect(node.z).toBeCloseTo(-Math.sin(1.1), 12);
  });

  it('spin axis follows the documented convention (sin ε sin α, cos ε, sin ε cos α)', () => {
    const r = createRng(1);
    const axis = new Vector3();
    for (let i = 0; i < 100; i++) {
      const e = r.range(0, Math.PI);
      const a = r.range(0, 2 * Math.PI);
      spinAxis(body({ axialTiltRad: e, axialAzimuthRad: a }), axis);
      expect(axis.x).toBeCloseTo(Math.sin(e) * Math.sin(a), 12);
      expect(axis.y).toBeCloseTo(Math.cos(e), 12);
      expect(axis.z).toBeCloseTo(Math.sin(e) * Math.cos(a), 12);
    }
  });

  it('obliquity is the angle between spin axis and orbit normal', () => {
    const r = createRng(2);
    const axis = new Vector3();
    const n = new Vector3();
    for (let i = 0; i < 100; i++) {
      const b = randomBody(r);
      spinAxis(b, axis);
      orbitNormal(b.orbit, n);
      expect(axis.angleTo(n)).toBeCloseTo(b.axialTiltRad, 9);
    }
  });

  it('every quaternion is normalised', () => {
    const r = createRng(3);
    const q = new Quaternion();
    for (let i = 0; i < 200; i++) {
      const b = randomBody(r, { tidallyLocked: r.chance(0.3) });
      const t = r.range(-1e4, 1e4);
      expect(equatorialFrame(b, q).length()).toBeCloseTo(1, 12);
      expect(bodyOrientation(b, t, q).length()).toBeCloseTo(1, 12);
      expect(moonOrientation(b, randomBody(r), t, q).length()).toBeCloseTo(1, 12);
    }
  });
});

describe('spin', () => {
  it('turns once per sidereal day about the spin axis, backwards when the period is negative', () => {
    const b = body({ axialTiltRad: 0.41, axialAzimuthRad: 1.3, rotationPeriodHours: 10 }, { inclinationRad: 0.2 });
    const q0 = bodyOrientation(b, 100, new Quaternion());
    const q1 = bodyOrientation(b, 100 + 10 / 24, new Quaternion());
    expect(Math.abs(q0.dot(q1))).toBeCloseTo(1, 9);
    const axis = spinAxis(b, new Vector3());
    const quarter = bodyOrientation(b, 100 + 2.5 / 24, new Quaternion());
    // X after a quarter turn = axis-rotated X: right-handed (counter-clockwise seen from the north pole).
    const x0 = X.clone().applyQuaternion(q0);
    const x1 = X.clone().applyQuaternion(quarter);
    expect(new Vector3().crossVectors(x0, x1).dot(axis)).toBeCloseTo(1, 9);
    const retro = body({ axialTiltRad: 0.41, axialAzimuthRad: 1.3, rotationPeriodHours: -10 }, { inclinationRad: 0.2 });
    const r0 = X.clone().applyQuaternion(bodyOrientation(retro, 100, new Quaternion()));
    const r1 = X.clone().applyQuaternion(bodyOrientation(retro, 100 + 2.5 / 24, new Quaternion()));
    expect(new Vector3().crossVectors(r0, r1).dot(axis)).toBeCloseTo(-1, 9);
    expect(spinAngleRad(body({ rotationPeriodHours: 0 }), 123)).toBe(0);
  });

  it('keeps the spin angle precise far from the epoch', () => {
    const b = body({ rotationPeriodHours: 9.925 });
    const days = (1e6 * 9.925) / 24; // a million rotations
    expect(spinAngleRad(b, days)).toBeCloseTo(0, 6);
  });
});

describe('tidal locking', () => {
  const faceError = (b: OrientedBody, t: number): number => {
    const toParent = orbitalPositionKm(b.orbit, t, new Vector3()).negate().normalize();
    const face = X.clone().applyQuaternion(bodyOrientation(b, t, new Quaternion()));
    return face.angleTo(toParent);
  };

  it('keeps the prime meridian pointed at the parent (circular orbits)', () => {
    const r = createRng(4);
    for (let i = 0; i < 50; i++) {
      const b = randomBody(r, { tidallyLocked: true, axialTiltRad: 0 });
      b.orbit.eccentricity = 0;
      for (let k = 0; k < 8; k++) expect(faceError(b, r.range(-5000, 5000))).toBeLessThan(1e-9);
    }
  });

  it('a tilted locked body still faces its parent to within the tilt', () => {
    const r = createRng(5);
    for (let i = 0; i < 50; i++) {
      const tilt = r.range(0, 0.2);
      const b = randomBody(r, { tidallyLocked: true, axialTiltRad: tilt });
      b.orbit.eccentricity = 0;
      for (let k = 0; k < 8; k++) expect(faceError(b, r.range(-5000, 5000))).toBeLessThanOrEqual(tilt + 1e-9);
    }
  });

  it('eccentric orbits librate by at most ~2e', () => {
    const r = createRng(6);
    for (let i = 0; i < 30; i++) {
      const b = randomBody(r, { tidallyLocked: true, axialTiltRad: 0 });
      b.orbit.eccentricity = r.range(0.01, 0.1);
      let worst = 0;
      for (let k = 0; k < 64; k++) worst = Math.max(worst, faceError(b, (k / 64) * b.orbit.periodDays));
      expect(worst).toBeLessThan(2.1 * b.orbit.eccentricity + 1e-3);
      expect(worst).toBeGreaterThan(1.5 * b.orbit.eccentricity); // real libration, not a hack
    }
  });
});

describe('moons', () => {
  it('equatorial moons orbit in the planet’s equatorial plane, expressed in frame S', () => {
    const planet = body({ axialTiltRad: 0.47, axialAzimuthRad: 2.2 }, { inclinationRad: 0.1, longitudeAscendingNodeRad: 0.7 });
    const moon = body({}, { semiMajorAxisKm: 421_700, periodDays: 1.769 });
    const axis = spinAxis(planet, new Vector3());
    const p = new Vector3();
    for (let t = 0; t < 2; t += 0.1) {
      moonPositionKm(moon, planet, t, p);
      expect(p.length()).toBeCloseTo(421_700, 3);
      expect(Math.abs(p.dot(axis)) / p.length()).toBeLessThan(1e-12);
    }
  });

  it('moonOrientation composes the planet’s equatorial frame with the moon’s own orientation', () => {
    const planet = body({ axialTiltRad: 0.47, axialAzimuthRad: 2.2 }, { inclinationRad: 0.1 });
    const moon = body({ tidallyLocked: true }, { semiMajorAxisKm: 421_700, periodDays: 1.769, inclinationRad: 0.01 });
    const q = moonOrientation(moon, planet, 3.3, new Quaternion());
    const expected = equatorialFrame(planet, new Quaternion()).multiply(bodyOrientation(moon, 3.3, new Quaternion()));
    expect(Math.abs(q.dot(expected))).toBeCloseTo(1, 12);
    // A locked moon faces its planet in frame S too.
    const toPlanet = moonPositionKm(moon, planet, 3.3, new Vector3()).negate().normalize();
    expect(X.clone().applyQuaternion(q).angleTo(toPlanet)).toBeLessThan(1e-9);
  });
});
