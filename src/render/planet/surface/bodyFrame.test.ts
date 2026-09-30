import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { PlanetUniforms } from '../../contracts';
import { BodyFrame } from './bodyFrame';

const uniforms = (over: Partial<PlanetUniforms> = {}): PlanetUniforms =>
  ({
    positionKm: new Vector3(0, 0, -10_000),
    orientation: new Quaternion(),
    sunDirection: new Vector3(1, 0, 0),
    sunColor: { r: 1, g: 1, b: 1 },
    sunAngularRadiusRad: 0.0047,
    sunIntensity: 1,
    intensity: 1,
    ...over,
  }) as PlanetUniforms;

describe('BodyFrame', () => {
  it('is the identity for an unrotated body: camera at -position', () => {
    const f = new BodyFrame();
    f.update({ radiusKm: 6000 }, uniforms());
    expect(f.sunDir.toArray()).toEqual([1, 0, 0]);
    expect(f.camPos.toArray()).toEqual([0, 0, 10_000]);
    expect(f.occluderCount).toBe(0);
  });

  it('rotates world vectors into the body frame', () => {
    const f = new BodyFrame();
    // Body yawed +90 degrees about Y: body +X points to world -Z.
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    f.update({ radiusKm: 6000 }, uniforms({ orientation: q, sunDirection: new Vector3(0, 0, -1) }));
    expect(f.sunDir.x).toBeCloseTo(1, 12);
    expect(f.sunDir.z).toBeCloseTo(0, 12);
  });

  it('keeps only casters between the sun and the body, within the shadow cylinder', () => {
    const f = new BodyFrame();
    const sun = new Vector3(1, 0, 0);
    const pos = new Vector3(0, 0, -50_000);
    const occluders = [
      { positionKm: pos.clone().add(new Vector3(30_000, 0, 0)), radiusKm: 1500 }, // sunward, on axis: kept
      { positionKm: pos.clone().add(new Vector3(-30_000, 0, 0)), radiusKm: 1500 }, // behind the body: dropped
      { positionKm: pos.clone().add(new Vector3(30_000, 40_000, 0)), radiusKm: 1500 }, // far off axis: dropped
      { positionKm: pos.clone().add(new Vector3(20_000, 6_500, 0)), radiusKm: 1500 }, // grazing: kept
    ];
    f.update({ radiusKm: 6000 }, uniforms({ positionKm: pos, sunDirection: sun, occluders }));
    expect(f.occluderCount).toBe(2);
    const first = f.occluders[0];
    expect(first?.x).toBeCloseTo(30_000, 6);
    expect(first?.w).toBe(1500);
  });

  it('caps the caster list', () => {
    const f = new BodyFrame();
    const many = Array.from({ length: 9 }, (_, i) => ({
      positionKm: new Vector3(20_000 + i, 0, -10_000),
      radiusKm: 500,
    }));
    f.update({ radiusKm: 6000 }, uniforms({ occluders: many }));
    expect(f.occluderCount).toBe(4);
  });
});
