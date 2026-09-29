import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import type { OrbitalElements } from '../core/types';
import { EARTH_MASS_KG, G_SI, KM_PER_AU, SOLAR_MASS_KG } from '../core/units';
import {
  apoapsisKm,
  eccentricAnomalyAt,
  meanAnomalyAt,
  meanLongitude,
  orbitalPeriodDays,
  orbitalPositionKm,
  orbitalVelocityKms,
  orbitNormal,
  orbitPathKm,
  periapsisKm,
  semiMajorAxisKmForPeriod,
  solveKepler,
  trueAnomalyFromEccentric,
} from './kepler';

function orbit(patch: Partial<OrbitalElements> = {}): OrbitalElements {
  return {
    semiMajorAxisKm: KM_PER_AU,
    eccentricity: 0,
    inclinationRad: 0,
    longitudeAscendingNodeRad: 0,
    argumentPeriapsisRad: 0,
    meanAnomalyEpochRad: 0,
    periodDays: 365.25,
    ...patch,
  };
}

describe('solveKepler', () => {
  it('residual |E − e sin E − M| < 1e-12 for e ≤ 0.97 (and beyond)', () => {
    let worst = 0;
    for (const e of [0, 1e-6, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.95, 0.97, 0.99, 0.999]) {
      for (let M = -10; M <= 10; M += 0.0137) {
        const E = solveKepler(M, e);
        worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - M));
      }
      for (const M of [0, 1e-12, -1e-9, Math.PI, -Math.PI, 2 * Math.PI, 1e-3]) {
        const E = solveKepler(M, e);
        worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - M));
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('is exact for circles and stays in the same revolution as M', () => {
    expect(solveKepler(1.234, 0)).toBe(1.234);
    expect(solveKepler(100.5, 0.3)).toBeGreaterThan(99);
    expect(solveKepler(100.5, 0.3)).toBeLessThan(102);
  });

  it('true anomaly from eccentric anomaly', () => {
    expect(trueAnomalyFromEccentric(0, 0.5)).toBe(0);
    expect(trueAnomalyFromEccentric(Math.PI, 0.5)).toBeCloseTo(Math.PI, 12);
    // cos ν = (cos E − e)/(1 − e cos E)
    const E = 1.1;
    const e = 0.4;
    expect(Math.cos(trueAnomalyFromEccentric(E, e))).toBeCloseTo(
      (Math.cos(E) - e) / (1 - e * Math.cos(E)),
      12,
    );
  });
});

describe('orbitalPositionKm', () => {
  const v = new Vector3();

  it('circular orbit: +X at epoch, −Z a quarter period later (counter-clockwise seen from +Y)', () => {
    const o = orbit();
    orbitalPositionKm(o, 0, v);
    expect(v.x).toBeCloseTo(KM_PER_AU, 3);
    expect(Math.abs(v.y)).toBeLessThan(1e-6);
    expect(Math.abs(v.z)).toBeLessThan(1e-6);
    orbitalPositionKm(o, o.periodDays / 4, v);
    expect(Math.abs(v.x)).toBeLessThan(1e-3);
    expect(v.z).toBeCloseTo(-KM_PER_AU, 3);
    // Angular momentum r × v points to +Y for a prograde orbit.
    const vel = orbitalVelocityKms(o, o.periodDays / 4, new Vector3());
    expect(new Vector3().crossVectors(v, vel).normalize().y).toBeCloseTo(1, 12);
  });

  it('periapsis at epoch (M₀ = 0) and apoapsis half a period later', () => {
    const o = orbit({
      eccentricity: 0.6,
      argumentPeriapsisRad: 0.7,
      inclinationRad: 0.3,
      longitudeAscendingNodeRad: 2,
    });
    expect(orbitalPositionKm(o, 0, v).length()).toBeCloseTo(periapsisKm(o), 2);
    expect(orbitalPositionKm(o, o.periodDays / 2, v).length()).toBeCloseTo(apoapsisKm(o), 2);
    expect(periapsisKm(o)).toBeCloseTo(0.4 * KM_PER_AU, 3);
    expect(apoapsisKm(o)).toBeCloseTo(1.6 * KM_PER_AU, 3);
  });

  it('inclined orbits lie in the plane ⊥ orbitNormal and rise through the ascending node', () => {
    const r = createRng(1);
    const n = new Vector3();
    for (let k = 0; k < 50; k++) {
      const o = orbit({
        eccentricity: r.range(0, 0.9),
        inclinationRad: r.range(0, Math.PI),
        longitudeAscendingNodeRad: r.range(0, 2 * Math.PI),
        argumentPeriapsisRad: r.range(0, 2 * Math.PI),
        meanAnomalyEpochRad: r.range(-Math.PI, Math.PI),
      });
      orbitNormal(o, n);
      expect(n.length()).toBeCloseTo(1, 12);
      for (let t = 0; t < o.periodDays; t += o.periodDays / 7) {
        orbitalPositionKm(o, t, v);
        expect(Math.abs(v.dot(n)) / v.length()).toBeLessThan(1e-12);
      }
    }
    // Ω = 0, ω = 0, M₀ = 0: the body starts at the ascending node on +X, moving towards +Y (north).
    const o = orbit({ inclinationRad: 0.5 });
    orbitalPositionKm(o, 0, v);
    expect(v.x).toBeCloseTo(KM_PER_AU, 3);
    expect(orbitalVelocityKms(o, 0, new Vector3()).y).toBeGreaterThan(0);
  });

  it('velocity matches the finite-difference derivative and vis-viva', () => {
    const o = orbit({
      eccentricity: 0.3,
      inclinationRad: 0.2,
      argumentPeriapsisRad: 1,
      periodDays: orbitalPeriodDays(KM_PER_AU, SOLAR_MASS_KG),
    });
    const mu = (G_SI * SOLAR_MASS_KG) / 1e9; // km³/s²
    const vel = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    for (const t of [0, 40, 100, 200, 300]) {
      orbitalVelocityKms(o, t, vel);
      const h = 1e-4; // days
      orbitalPositionKm(o, t + h, a);
      orbitalPositionKm(o, t - h, b);
      const fd = a.sub(b).divideScalar(2 * h * 86_400);
      expect(fd.distanceTo(vel) / vel.length()).toBeLessThan(1e-6);
      const rr = orbitalPositionKm(o, t, v).length();
      expect(vel.lengthSq() / (mu * (2 / rr - 1 / o.semiMajorAxisKm))).toBeCloseTo(1, 9);
    }
  });

  it('keeps precision after many revolutions', () => {
    const o = orbit({ periodDays: 0.37 });
    const M = meanAnomalyAt(o, 1e6 * 0.37 + 0.37 / 4);
    expect(M).toBeCloseTo(Math.PI / 2, 8);
    expect(M).toBeGreaterThan(-Math.PI);
    expect(M).toBeLessThanOrEqual(Math.PI);
    expect(eccentricAnomalyAt(o, 0)).toBe(0);
    expect(meanAnomalyAt(orbit({ periodDays: 0, meanAnomalyEpochRad: 1 }), 50)).toBe(1);
    expect(
      meanLongitude(orbit({ longitudeAscendingNodeRad: 1, argumentPeriapsisRad: 0.5 }), 0),
    ).toBeCloseTo(1.5, 12);
  });
});

describe('orbitPathKm', () => {
  it('is a closed loop of segments + 1 vertices on the ellipse, smooth at periapsis', () => {
    const o = orbit({
      eccentricity: 0.7,
      inclinationRad: 0.4,
      longitudeAscendingNodeRad: 1,
      argumentPeriapsisRad: 2,
    });
    const segs = 128;
    const path = orbitPathKm(o, segs);
    expect(path).toBeInstanceOf(Float32Array);
    expect(path.length).toBe((segs + 1) * 3);
    expect([path[0], path[1], path[2]]).toEqual([
      path[segs * 3],
      path[segs * 3 + 1],
      path[segs * 3 + 2],
    ]);
    const n = orbitNormal(o, new Vector3());
    const p = new Vector3();
    for (let i = 0; i <= segs; i++) {
      p.fromArray(path, i * 3);
      const r = p.length();
      expect(r).toBeGreaterThan(periapsisKm(o) * 0.9999);
      expect(r).toBeLessThan(apoapsisKm(o) * 1.0001);
      expect(Math.abs(p.dot(n)) / r).toBeLessThan(1e-6);
    }
    // Vertex 0 is periapsis and matches the position at epoch.
    const epoch = orbitalPositionKm(o, 0, new Vector3());
    expect(p.fromArray(path, 0).distanceTo(epoch) / epoch.length()).toBeLessThan(1e-6);
    // Uniform in E: the periapsis chord is short, where sampling uniformly in time (M) would leave
    // a long straight segment because the body moves fastest there.
    const periChord = p.fromArray(path, 0).distanceTo(new Vector3().fromArray(path, 3));
    const timeChord = orbitalPositionKm(o, 0, new Vector3()).distanceTo(
      orbitalPositionKm(o, o.periodDays / segs, new Vector3()),
    );
    // Near periapsis dE/dM = 1/(1 − e), so the time-uniform chord is ≈ 1/(1 − e) = 3.3× longer.
    expect(timeChord / periChord).toBeCloseTo(1 / (1 - o.eccentricity), 0);
  });
});

describe("Kepler's third law", () => {
  it('Earth around the Sun takes a sidereal year', () => {
    expect(orbitalPeriodDays(KM_PER_AU, SOLAR_MASS_KG, EARTH_MASS_KG)).toBeCloseTo(365.2564, 2);
    const a = semiMajorAxisKmForPeriod(27.321_661, EARTH_MASS_KG, 0.0123 * EARTH_MASS_KG);
    expect(a / 384_400).toBeCloseTo(1, 2); // the Moon
    expect(semiMajorAxisKmForPeriod(orbitalPeriodDays(7e7, 1e27), 1e27)).toBeCloseTo(7e7, 3);
  });
});
