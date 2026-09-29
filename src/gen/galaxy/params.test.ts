import { describe, expect, it } from 'vitest';
import {
  createGalaxyParams,
  drawGalaxyShape,
  finalizeGalaxyParams,
  HOME_RADIUS_FRACTION,
} from './params';
import { getGalaxyStructure } from './structure';

const DEG = Math.PI / 180;

describe('drawGalaxyShape', () => {
  it('is deterministic and frozen (golden values)', () => {
    expect(drawGalaxyShape(1)).toEqual(drawGalaxyShape(1));
    const s = drawGalaxyShape(1);
    expect(s.name).toBe('IC 1494');
    expect(s.armCount).toBe(3);
    expect(s.radiusLy).toBeCloseTo(55_354.195442050695, 6);
    expect(s.armPitchRad).toBeCloseTo(0.21596250562165673, 12);
    expect(drawGalaxyShape(2)).not.toEqual(s);
  });

  it('stays within realistic ranges with the specified frequencies', () => {
    const n = 3000;
    let barred = 0;
    const arms: Record<number, number> = { 2: 0, 3: 0, 4: 0 };
    for (let seed = 0; seed < n; seed++) {
      const s = drawGalaxyShape(seed);
      expect(s.radiusLy).toBeGreaterThanOrEqual(45_000);
      expect(s.radiusLy).toBeLessThanOrEqual(60_000);
      expect(s.diskScaleLengthLy).toBeGreaterThanOrEqual(10_000);
      expect(s.diskScaleLengthLy).toBeLessThanOrEqual(12_000);
      expect(s.diskScaleHeightLy).toBeGreaterThanOrEqual(800);
      expect(s.diskScaleHeightLy).toBeLessThanOrEqual(1000);
      expect(s.bulgeRadiusLy).toBeGreaterThanOrEqual(3500);
      expect(s.bulgeRadiusLy).toBeLessThanOrEqual(5500);
      expect(s.bulgeFlattening).toBeGreaterThanOrEqual(0.4);
      expect(s.bulgeFlattening).toBeLessThanOrEqual(1);
      expect(s.armPitchRad).toBeGreaterThanOrEqual(11 * DEG);
      expect(s.armPitchRad).toBeLessThanOrEqual(16 * DEG);
      expect(s.armWidthLy).toBeGreaterThanOrEqual(2500);
      expect(s.armWidthLy).toBeLessThanOrEqual(3500);
      expect(s.armStrength).toBeGreaterThanOrEqual(2.5);
      expect(s.armStrength).toBeLessThanOrEqual(4);
      expect(s.dustScaleHeightLy).toBeGreaterThanOrEqual(250);
      expect(s.dustScaleHeightLy).toBeLessThanOrEqual(350);
      expect(s.name).toMatch(/^(NGC|IC|UGC|PGC|ESO) \d+(-\d{3})?$/);
      if (s.barLengthLy > 0) {
        barred++;
        expect(s.barLengthLy).toBeGreaterThanOrEqual(9000);
        expect(s.barLengthLy).toBeLessThanOrEqual(14_000);
        expect(s.armPhaseRad).toBe(s.barAngleRad); // arms spring from the bar ends
      }
      arms[s.armCount] = (arms[s.armCount] ?? 0) + 1;
    }
    expect(barred / n).toBeCloseTo(0.55, 1);
    expect((arms[2] ?? 0) / n).toBeCloseTo(0.4, 1);
    expect((arms[3] ?? 0) / n).toBeCloseTo(0.15, 1);
    expect((arms[4] ?? 0) / n).toBeCloseTo(0.45, 1);
  });
});

describe('createGalaxyParams', () => {
  it('memoises but hands out independent copies', () => {
    const a = createGalaxyParams(3);
    const b = createGalaxyParams(3);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.radiusLy = 1;
    expect(createGalaxyParams(3).radiusLy).not.toBe(1);
  });

  it('places home on the outer (convex) edge of an arm at 0.52 R in the midplane', () => {
    for (const seed of [1, 2, 3, 42]) {
      const p = createGalaxyParams(seed);
      const [x, y, z] = p.homeLy;
      expect(y).toBe(0);
      expect(Math.hypot(x, z) / p.radiusLy).toBeCloseTo(HOME_RADIUS_FRACTION, 6);
      const s = getGalaxyStructure(p);
      const arm = s.armFactor(x, y, z);
      expect(arm).toBeGreaterThanOrEqual(0.3);
      expect(arm).toBeLessThanOrEqual(0.5);
      expect(s.armOffset(x, z)).toBeLessThan(0); // convex side: dust lanes are on the other one
    }
  });

  it('estimates ~1e11 stars', () => {
    for (const seed of [1, 2, 3, 42]) {
      const n = createGalaxyParams(seed).estimatedStarCount;
      expect(n).toBeGreaterThan(2e10);
      expect(n).toBeLessThan(5e11);
    }
  });

  it('finalizeGalaxyParams recomputes derived fields for hand-edited shapes', () => {
    const shape = { ...drawGalaxyShape(9), armStrength: 0 };
    const p = finalizeGalaxyParams(shape);
    expect(p.armStrength).toBe(0);
    expect(p.estimatedStarCount).toBeGreaterThan(1e10);
    expect(Math.hypot(p.homeLy[0], p.homeLy[2]) / p.radiusLy).toBeCloseTo(HOME_RADIUS_FRACTION, 6);
  });
});
