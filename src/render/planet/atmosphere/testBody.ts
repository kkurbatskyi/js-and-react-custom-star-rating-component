/** Synthetic bodies for the sky module's unit tests (independent of the generator's output). */
import type { BodyBase, PlanetType } from '../../../core/types';

export function makeBody(overrides: Partial<BodyBase> = {}): BodyBase {
  return {
    id: 'test.b',
    name: 'Test',
    type: 'terran',
    seed: 1234,
    orbit: {
      semiMajorAxisKm: 1.5e8,
      eccentricity: 0,
      inclinationRad: 0,
      longitudeAscendingNodeRad: 0,
      argumentPeriapsisRad: 0,
      meanAnomalyEpochRad: 0,
      periodDays: 365,
    },
    radiusKm: 6371,
    massEarth: 1,
    densityGcc: 5.5,
    surfaceGravityG: 1,
    escapeVelocityKms: 11.2,
    rotationPeriodHours: 24,
    axialTiltRad: 0.4,
    axialAzimuthRad: 0,
    tidallyLocked: false,
    albedo: 0.3,
    equilibriumTempK: 255,
    surfaceTempK: 288,
    atmosphere: {
      surfacePressureAtm: 1,
      composition: [
        { gas: 'N₂', fraction: 0.78 },
        { gas: 'O₂', fraction: 0.21 },
        { gas: 'Ar', fraction: 0.01 },
      ],
      scaleHeightKm: 8.5,
      greenhouseK: 33,
    },
    oceanCoverage: 0.7,
    iceCoverage: 0.05,
    volcanism: 0.1,
    craterDensity: 0.1,
    life: 'vegetation',
    sudarskyClass: null,
    oblateness: 0,
    rings: null,
    habitability: 0.9,
    blurb: '',
    surveyRating: 4,
    tags: [],
    appearance: {
      surfaceColors: [
        [0.05, 0.1, 0.05],
        [0.3, 0.25, 0.15],
      ],
      oceanColor: [0.01, 0.04, 0.12],
      cloudCoverage: 0.5,
      cloudColor: [0.9, 0.9, 0.92],
      hazeColor: [0.32, 0.56, 1],
      nightLights: 0,
      lavaGlow: 0,
      swatch: [0.2, 0.3, 0.5],
    },
    ...overrides,
  };
}

/** A Mars-like desert world: thin CO2 atmosphere, butterscotch haze. */
export function marsLike(): BodyBase {
  return makeBody({
    type: 'desert' as PlanetType,
    radiusKm: 3390,
    surfaceGravityG: 0.38,
    life: 'none',
    atmosphere: {
      surfacePressureAtm: 0.09,
      composition: [
        { gas: 'CO₂', fraction: 0.94 },
        { gas: 'N₂', fraction: 0.035 },
        { gas: 'Ar', fraction: 0.025 },
      ],
      scaleHeightKm: 10,
      greenhouseK: 3,
    },
    appearance: {
      ...makeBody().appearance,
      cloudCoverage: 0.03,
      cloudColor: [0.75, 0.55, 0.4],
      hazeColor: [0.95, 0.62, 0.45],
    },
  });
}

/** A Jupiter-like giant: H2/He, cloud deck at 1 bar, faint blue-white haze. */
export function jovian(): BodyBase {
  return makeBody({
    type: 'gas-giant' as PlanetType,
    radiusKm: 64000,
    surfaceGravityG: 1.84,
    life: 'none',
    oblateness: 0.06,
    atmosphere: {
      surfacePressureAtm: 1,
      composition: [
        { gas: 'H₂', fraction: 0.86 },
        { gas: 'He', fraction: 0.13 },
        { gas: 'CH₄', fraction: 0.005 },
      ],
      scaleHeightKm: 31,
      greenhouseK: 0,
    },
    appearance: {
      ...makeBody().appearance,
      cloudCoverage: 0,
      hazeColor: [0.8, 0.82, 0.95],
    },
  });
}
