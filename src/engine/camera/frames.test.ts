import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { KM_PER_AU, KM_PER_LY } from '../../core/units';
import {
  eclipticToGalactic,
  type GalacticPoint,
  galacticLyOf,
  galacticToSystem,
  relativeKm,
  systemKmOf,
  systemToGalactic,
} from './frames';

const tilt = eclipticToGalactic([0.21, -0.43, 0.12, 0.87], new Quaternion());

function point(starId: string | null, starLy: Vector3, posS: Vector3, frame = tilt): GalacticPoint {
  return { starId, starLy, frame, posS };
}

describe('frames', () => {
  it('round-trips G ↔ S', () => {
    const v = new Vector3(1.2e8, -3.4e7, 9.9e6);
    const g = systemToGalactic(v, tilt, new Vector3());
    const back = galacticToSystem(g, tilt, new Vector3());
    expect(back.distanceTo(v) / v.length()).toBeLessThan(1e-14);
    expect(g.length()).toBeCloseTo(v.length(), 3);
  });

  it('differences points of one system in S, exactly', () => {
    const star = new Vector3(26_000.123456789, 12.5, -3.25);
    const planet = point('s', star, new Vector3(1.5e8, 1e3, -2e7));
    const moon = point('s', star, new Vector3(1.5e8 + 384_400, 1e3 + 7, -2e7 - 11));
    const d = relativeKm(moon, planet, new Vector3());
    const expected = systemToGalactic(new Vector3(384_400, 7, -11), tilt, new Vector3());
    expect(d.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('differences points of different systems through light-years', () => {
    const a = point('a', new Vector3(100, 0, 0), new Vector3(KM_PER_AU, 0, 0));
    const b = point('b', new Vector3(90, 0, 0), new Vector3(), new Quaternion());
    const d = relativeKm(a, b, new Vector3());
    const expected = new Vector3(10 * KM_PER_LY, 0, 0).add(
      systemToGalactic(new Vector3(KM_PER_AU, 0, 0), tilt, new Vector3()),
    );
    expect(d.distanceTo(expected)).toBeLessThan(1);
  });

  it('derives galactic ly and system km from one offset consistently', () => {
    const star = new Vector3(-12_000.5, 40, 25_900.25);
    const planet = point('s', star, new Vector3(2.2e8, 0, 1e7));
    const offset = new Vector3(3e4, -1e4, 2e4);
    const ly = galacticLyOf(planet, offset, new Vector3());
    const km = systemKmOf(planet, offset, point('s', star, new Vector3()), new Vector3());
    // The S position rotated back and added to the star must give the same galactic position.
    const viaS = star.clone().addScaledVector(systemToGalactic(km, tilt, new Vector3()), 1 / KM_PER_LY);
    expect(viaS.distanceTo(ly) * KM_PER_LY).toBeLessThan(100);
    // And the camera sits at planet + offset in S.
    const expectedS = galacticToSystem(offset, tilt, new Vector3()).add(planet.posS);
    expect(km.distanceTo(expectedS)).toBeLessThan(1e-6);
  });

  it('expresses a point of another system in S', () => {
    const sys = point('b', new Vector3(10, 0, 0), new Vector3());
    const free = point(null, new Vector3(10, 0, 0.001), new Vector3(), new Quaternion());
    const km = systemKmOf(free, new Vector3(), sys, new Vector3());
    expect(km.length()).toBeCloseTo(0.001 * KM_PER_LY, -2);
  });
});
