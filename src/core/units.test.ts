import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { quaternionToTuple, tupleToQuaternion, tupleToVector3, vector3ToTuple } from './threeUtil';
import {
  AU_PER_LY,
  auToKm,
  daysToYears,
  J2000_UNIX_MS,
  KM_PER_AU,
  KM_PER_LY,
  KM_PER_PC,
  kmToAU,
  kmToLy,
  LY_PER_PC,
  lyToKm,
  pcToLy,
  SECONDS_PER_YEAR,
  SOLAR_LUMINOSITY_W,
  SOLAR_MASS_EARTH,
  SOLAR_MASS_JUPITER,
  SOLAR_RADIUS_KM,
  SOLAR_TEMP_K,
  STEFAN_BOLTZMANN_SI,
  yearsToDays,
} from './units';

describe('units', () => {
  it('derived constants are consistent', () => {
    expect(AU_PER_LY).toBeCloseTo(63_241.077, 2);
    expect(LY_PER_PC).toBeCloseTo(3.26156, 5);
    expect(KM_PER_PC / 3.0856775814913673e13).toBeCloseTo(1, 12);
    expect(SOLAR_MASS_EARTH).toBeCloseTo(332_946, -1);
    expect(SOLAR_MASS_JUPITER).toBeCloseTo(1047.6, 0);
    expect(J2000_UNIX_MS).toBe(946_728_000_000);
    expect(SECONDS_PER_YEAR).toBe(31_557_600);
    // A light-year is c × one Julian year.
    expect(KM_PER_LY).toBeCloseTo(299_792.458 * SECONDS_PER_YEAR, 0);
  });

  it('the nominal Sun satisfies Stefan–Boltzmann: L = 4πR²σT⁴', () => {
    const r = SOLAR_RADIUS_KM * 1000;
    const l = 4 * Math.PI * r * r * STEFAN_BOLTZMANN_SI * SOLAR_TEMP_K ** 4;
    expect(l / SOLAR_LUMINOSITY_W).toBeCloseTo(1, 3);
  });

  it('conversions round-trip', () => {
    expect(kmToAU(auToKm(5.2))).toBeCloseTo(5.2, 12);
    expect(kmToLy(lyToKm(4.24))).toBeCloseTo(4.24, 12);
    expect(pcToLy(1)).toBe(LY_PER_PC);
    expect(daysToYears(yearsToDays(11.86))).toBeCloseTo(11.86, 12);
    expect(auToKm(1)).toBe(KM_PER_AU);
  });
});

describe('threeUtil', () => {
  it('converts tuples ↔ three.js objects, reusing `out`', () => {
    const v = new Vector3();
    expect(tupleToVector3([1, 2, 3], v)).toBe(v);
    expect(vector3ToTuple(v)).toEqual([1, 2, 3]);
    const q = tupleToQuaternion([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    expect(q).toBeInstanceOf(Quaternion);
    expect(quaternionToTuple(q)).toEqual([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  });
});
