import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { KM_PER_LY } from '../../core/units';
import { getUniverse } from '../../universe';
import { type FocusHandle, resolveFocus } from './focus';
import {
  arrivalPose,
  DEFAULT_FOV_Y,
  framingDistanceKm,
  OVERVIEW_DISTANCE_KM,
  THREE_QUARTER_AZIMUTH,
} from './framing';

const universe = getUniverse();
const centre = resolveFocus(universe, { kind: 'galaxy', centerLy: [0, 0, 0] }) as FocusHandle;

describe('framing', () => {
  it('keeps the composed overview distance on landscape screens', () => {
    expect(framingDistanceKm(centre, 16 / 9)).toBe(OVERVIEW_DISTANCE_KM);
  });

  it('fits the whole disk into a portrait screen’s horizontal field of view', () => {
    for (const aspect of [0.75, 0.5625, 0.46]) {
      const d = framingDistanceKm(centre, aspect);
      expect(d).toBeGreaterThan(OVERVIEW_DISTANCE_KM);
      const halfWidth = Math.atan((universe.galaxy.params.radiusLy * KM_PER_LY) / d);
      const halfHfov = Math.atan(aspect * Math.tan(DEFAULT_FOV_Y / 2));
      expect(halfWidth).toBeLessThan(halfHfov);
      expect(halfWidth).toBeGreaterThan(0.85 * halfHfov); // … without shrinking it needlessly
    }
  });

  it('frames planets in three-quarter light', () => {
    const planet = resolveFocus(universe, {
      kind: 'planet',
      id: `${universe.homeStarId()}.d`,
    }) as FocusHandle;
    planet.update(9800);
    const pose = arrivalPose(planet, new Vector3(0, 1, 0), { yaw: 0, pitch: 0, distanceKm: 0 });
    const sunYaw = Math.atan2(-planet.posS.x, -planet.posS.z);
    const d = Math.abs(((pose.yaw - sunYaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(d).toBeCloseTo(THREE_QUARTER_AZIMUTH, 9);
    expect(pose.distanceKm).toBeCloseTo(4 * planet.radiusKm, 3);
  });
});
