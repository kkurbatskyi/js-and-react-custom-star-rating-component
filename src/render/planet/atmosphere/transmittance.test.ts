import { DataUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { deriveAtmosphere } from './params';
import { makeBody } from './testBody';
import {
  buildTransmittanceLut,
  distanceToTop,
  LUT_MU_SIZE,
  LUT_R_SIZE,
  lutGeometry,
  lutToRMu,
  makeExtinctionTable,
  opticalDepthToTop,
} from './transmittance';

const params = (() => {
  const p = deriveAtmosphere(makeBody());
  if (!p) throw new Error('no atmosphere');
  return p;
})();
const geo = lutGeometry(params);
const table = makeExtinctionTable(params);

describe('transmittance table', () => {
  it('maps the corners of the table to the zenith at the ground and the top boundary', () => {
    const ground = lutToRMu(geo, 0, 0);
    expect(ground.r).toBeCloseTo(geo.rp, 6);
    expect(ground.mu).toBeCloseTo(1, 6);
    const horizon = lutToRMu(geo, 1, 0);
    expect(horizon.mu).toBeCloseTo(0, 6); // grazing ray at the ground
    const top = lutToRMu(geo, 0.5, 1);
    expect(top.r).toBeCloseTo(geo.rt, 3);
  });

  it('reproduces the analytic zenith optical depth at the ground', () => {
    const od = opticalDepthToTop(table, geo, geo.rp, 1);
    for (let c = 0; c < 3; c++) {
      expect(od[c] ?? 0).toBeCloseTo(params.zenithTau[c] ?? 0, 2);
    }
  });

  it('grows towards the horizon (airmass ~ 38 at 90 degrees for Earth) and vanishes at the top', () => {
    const zenith = opticalDepthToTop(table, geo, geo.rp, 1)[2];
    const horizon = opticalDepthToTop(table, geo, geo.rp, 0)[2];
    expect(horizon / zenith).toBeGreaterThan(25);
    expect(horizon / zenith).toBeLessThan(50);
    const atTop = opticalDepthToTop(table, geo, geo.rt, 1);
    expect(atTop[0]).toBeCloseTo(0, 9);
    expect(distanceToTop(geo, geo.rt, 1)).toBeCloseTo(0, 6);
  });

  it('is monotone in mu along every row and packs half floats in the right layout', () => {
    const lut = buildTransmittanceLut(params);
    expect(lut.length).toBe(LUT_MU_SIZE * LUT_R_SIZE * 4);
    for (const row of [0, 10, 31]) {
      let prev = -1;
      for (let i = 0; i < LUT_MU_SIZE; i++) {
        const v = DataUtils.fromHalfFloat(lut[(row * LUT_MU_SIZE + i) * 4 + 2] ?? 0);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-3 * Math.max(prev, 1));
        prev = v;
      }
    }
    // Ground zenith texel (row 0, column 0) matches the direct integral within half-float precision.
    const direct = opticalDepthToTop(table, geo, geo.rp, 1)[2];
    expect(DataUtils.fromHalfFloat(lut[2] ?? 0)).toBeCloseTo(direct, 2);
    // Alpha is 1.
    expect(DataUtils.fromHalfFloat(lut[3] ?? 0)).toBe(1);
  });
});
