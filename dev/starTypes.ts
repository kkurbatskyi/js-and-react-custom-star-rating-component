/**
 * Synthetic StarDetails for the star dev pages: one representative of every look the StarVisual
 * supports, built from textbook relations (Stefan-Boltzmann, Reed 1998 bolometric correction).
 * Independent of the mock universe so it keeps working when the real generators land.
 */
import { blackbodyRGB } from '../src/core/color';
import type { SpectralClass, StarDetails, StarKind } from '../src/core/types';
import {
  G_SI,
  SOLAR_ABS_MAG_BOL,
  SOLAR_ABS_MAG_V,
  SOLAR_MASS_KG,
  SOLAR_RADIUS_KM,
  SOLAR_TEMP_K,
  SPEED_OF_LIGHT_KMS,
} from '../src/core/units';

export const STAR_TYPES = [
  'O',
  'B',
  'A',
  'F',
  'G',
  'K',
  'M',
  'K-giant',
  'M-supergiant',
  'white-dwarf',
  'neutron-star',
  'black-hole',
  'smbh',
] as const;
export type StarTypeName = (typeof STAR_TYPES)[number];

interface Spec {
  kind: StarKind;
  cls: SpectralClass;
  type: string;
  tempK: number;
  radiusSolar: number;
  massSolar: number;
  activity: number;
  rotationDays: number;
  extra?: Partial<StarDetails>;
}

/** Schwarzschild radius, km. */
const schwarzschildKm = (massSolar: number): number =>
  (2 * G_SI * massSolar * SOLAR_MASS_KG) / (SPEED_OF_LIGHT_KMS * 1000) ** 2 / 1000;

const SPECS: Record<StarTypeName, Spec> = {
  O: {
    kind: 'main-sequence',
    cls: 'O',
    type: 'O6V',
    tempK: 38000,
    radiusSolar: 9,
    massSolar: 30,
    activity: 0,
    rotationDays: 2,
  },
  B: {
    kind: 'main-sequence',
    cls: 'B',
    type: 'B3V',
    tempK: 17000,
    radiusSolar: 4,
    massSolar: 6,
    activity: 0,
    rotationDays: 1.5,
  },
  A: {
    kind: 'main-sequence',
    cls: 'A',
    type: 'A2V',
    tempK: 9200,
    radiusSolar: 1.8,
    massSolar: 2.1,
    activity: 0.05,
    rotationDays: 1,
  },
  F: {
    kind: 'main-sequence',
    cls: 'F',
    type: 'F5V',
    tempK: 6600,
    radiusSolar: 1.3,
    massSolar: 1.3,
    activity: 0.35,
    rotationDays: 4,
  },
  G: {
    kind: 'main-sequence',
    cls: 'G',
    type: 'G2V',
    tempK: 5772,
    radiusSolar: 1,
    massSolar: 1,
    activity: 0.32,
    rotationDays: 25,
  },
  K: {
    kind: 'main-sequence',
    cls: 'K',
    type: 'K5V',
    tempK: 4400,
    radiusSolar: 0.72,
    massSolar: 0.7,
    activity: 0.5,
    rotationDays: 35,
  },
  M: {
    kind: 'main-sequence',
    cls: 'M',
    type: 'M4V',
    tempK: 3200,
    radiusSolar: 0.3,
    massSolar: 0.25,
    activity: 0.85,
    rotationDays: 3,
  },
  'K-giant': {
    kind: 'giant',
    cls: 'K',
    type: 'K2III',
    tempK: 4300,
    radiusSolar: 25,
    massSolar: 1.2,
    activity: 0.1,
    rotationDays: 300,
  },
  'M-supergiant': {
    kind: 'supergiant',
    cls: 'M',
    type: 'M2Ia',
    tempK: 3500,
    radiusSolar: 600,
    massSolar: 15,
    activity: 0,
    rotationDays: 2000,
  },
  'white-dwarf': {
    kind: 'white-dwarf',
    cls: 'D',
    type: 'DA3',
    tempK: 14000,
    radiusSolar: 0.0092,
    massSolar: 0.6,
    activity: 0,
    rotationDays: 0.5,
  },
  'neutron-star': {
    kind: 'neutron-star',
    cls: 'N',
    type: 'NS',
    tempK: 600000,
    radiusSolar: 12 / SOLAR_RADIUS_KM,
    massSolar: 1.4,
    activity: 0,
    rotationDays: 1.4e-5,
    extra: { pulsarPeriodSec: 1.2 },
  },
  'black-hole': {
    kind: 'black-hole',
    cls: 'X',
    type: 'BH',
    tempK: 0,
    radiusSolar: schwarzschildKm(12) / SOLAR_RADIUS_KM,
    massSolar: 12,
    activity: 0.2,
    rotationDays: 0.01,
    extra: { accretion: 0.7 },
  },
  smbh: {
    kind: 'black-hole',
    cls: 'X',
    type: 'SMBH',
    tempK: 0,
    radiusSolar: schwarzschildKm(4.1e6) / SOLAR_RADIUS_KM,
    massSolar: 4.1e6,
    activity: 0.3,
    rotationDays: 0.01,
    extra: { accretion: 0.85 },
  },
};

/** Reed (1998) V-band bolometric correction polynomial in log T - 4, zero-pointed to the Sun. */
function bolometricCorrection(tempK: number): number {
  const x = Math.log10(Math.min(Math.max(tempK, 2000), 60000)) - 4;
  return -8.499 * x ** 4 + 13.421 * x ** 3 - 8.131 * x ** 2 - 3.901 * x - 0.438;
}

export function makeStar(type: StarTypeName, seed = 20260929): StarDetails {
  const s = SPECS[type];
  const isHole = s.kind === 'black-hole';
  const luminosity = isHole
    ? type === 'smbh'
      ? 3e5
      : 30
    : s.radiusSolar ** 2 * (s.tempK / SOLAR_TEMP_K) ** 4;
  const tempForBc = isHole ? 8000 : s.tempK;
  const bcSun = SOLAR_ABS_MAG_BOL - SOLAR_ABS_MAG_V - bolometricCorrection(SOLAR_TEMP_K);
  const absMag =
    SOLAR_ABS_MAG_BOL - 2.5 * Math.log10(luminosity) - (bolometricCorrection(tempForBc) + bcSun);
  const colorRGB = s.tempK > 0 ? blackbodyRGB(s.tempK) : ([1, 0.6, 0.3] as const);
  return {
    id: `dev.${type}`,
    level: 0,
    cell: [0, 0, 0],
    index: 0,
    posLy: [0, 0, 0],
    seed,
    kind: s.kind,
    spectralClass: s.cls,
    spectralType: s.type,
    massSolar: s.massSolar,
    radiusSolar: s.radiusSolar,
    luminositySolar: luminosity,
    temperatureK: s.tempK,
    absMag,
    colorRGB,
    name: `Dev ${type}`,
    designation: `DEV ${type}`,
    radiusKm: s.radiusSolar * SOLAR_RADIUS_KM,
    ageGyr: 4.6,
    metallicityFeH: 0,
    rotationPeriodDays: s.rotationDays,
    activity: s.activity,
    ...s.extra,
  };
}
