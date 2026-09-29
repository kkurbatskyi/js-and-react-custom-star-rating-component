/**
 * Seeded galaxy parameters: realistic ranges for a grand-design / barred spiral like the Milky Way,
 * plus derived quantities (home location, star count).
 *
 * Determinism: every parameter group draws from its own `fork` of `createRng(seed)`, so adding a
 * parameter later (in a new fork) never changes existing galaxies.
 */
import { degToRad, TAU } from '../../core/math';
import { createRng } from '../../core/rng';
import type { GalaxyParams, Rng } from '../../core/types';
import {
  findHome,
  type GalaxyShapeParams,
  getGalaxyStructure,
  HOME_RADIUS_FRACTION,
  integrateDensity,
} from './structure';

/** Calibration target: stars per cubic light-year at `homeLy` (≈ the solar neighbourhood). */
export const GALAXY_HOME_DENSITY = 0.004;
/** The star-count integral covers a cylinder of this radius/half-height, × radius. */
const INTEGRATION_EXTENT = 1.25;

export type { GalaxyShapeParams };
export { HOME_RADIUS_FRACTION };

/** Catalogue-style designation: "NGC 4417", "IC 2574", "UGC 9760", "PGC 54559", "ESO 137-001". */
function catalogueName(rng: Rng): string {
  switch (rng.weighted([0.55, 0.2, 0.12, 0.08, 0.05])) {
    case 0:
      return `NGC ${rng.int(1, 7840)}`;
    case 1:
      return `IC ${rng.int(1, 5386)}`;
    case 2:
      return `UGC ${rng.int(1, 12_921)}`;
    case 3:
      return `PGC ${rng.int(1000, 99_999)}`;
    default:
      return `ESO ${rng.int(1, 600)}-${String(rng.int(1, 99)).padStart(3, '0')}`;
  }
}

/** Draw the shape parameters for a seed (cheap; no derived quantities). */
export function drawGalaxyShape(seed: number): GalaxyShapeParams {
  const root = createRng(seed).fork('galaxy');
  const r = root.fork('shape');
  // Fixed draw order — append new draws at the end or, better, use a new fork.
  const radiusLy = r.range(45_000, 60_000);
  const diskScaleLengthLy = r.range(10_000, 12_000);
  const diskScaleHeightLy = r.range(800, 1000);
  const bulgeRadiusLy = r.range(3500, 5500);
  const bulgeFlattening = r.range(0.55, 0.8);
  const hasBar = r.chance(0.55);
  const barLength = r.range(9000, 14_000);
  const barAngleRad = r.range(0, Math.PI);
  const armCount = ([2, 3, 4] as const)[r.weighted([0.4, 0.15, 0.45])] ?? 2;
  const armPitchRad = degToRad(r.range(11, 16));
  const armWidthLy = r.range(2500, 3500);
  const armStrength = r.range(2.5, 4);
  const freePhase = r.range(0, TAU);
  const dustScaleHeightLy = r.range(250, 350);
  return {
    seed: seed >>> 0,
    name: catalogueName(root.fork('name')),
    radiusLy,
    diskScaleLengthLy,
    diskScaleHeightLy,
    bulgeRadiusLy,
    bulgeFlattening,
    barLengthLy: hasBar ? barLength : 0,
    barAngleRad: hasBar ? barAngleRad : 0,
    armCount,
    armPitchRad,
    armWidthLy,
    armStrength,
    // In barred spirals the arms spring from the bar ends.
    armPhaseRad: hasBar ? barAngleRad : freePhase,
    dustScaleHeightLy,
  };
}

/**
 * Complete a shape into full GalaxyParams: find the curated home and integrate the calibrated
 * density for the star count (~50–100 ms; the structure is memoised and reused by the model).
 * Use this after tweaking shape parameters by hand (dev harness), then `createGalaxyModelFromParams`.
 */
export function finalizeGalaxyParams(shape: GalaxyShapeParams): GalaxyParams {
  const structure = getGalaxyStructure(shape);
  const homeLy = findHome(structure);
  const scale = GALAXY_HOME_DENSITY / structure.density(homeLy[0], homeLy[1], homeLy[2]);
  const estimatedStarCount =
    scale * integrateDensity(structure.density, INTEGRATION_EXTENT * shape.radiusLy);
  return { ...shape, homeLy, estimatedStarCount };
}

const PARAMS_CACHE_SIZE = 8;
const paramsCache = new Map<number, GalaxyParams>();

/**
 * Seeded galaxy parameters (see README for ranges). Memoised per seed; each call returns a fresh
 * copy, so callers may mutate their copy freely.
 */
export function createGalaxyParams(seed: number): GalaxyParams {
  const key = seed >>> 0;
  let params = paramsCache.get(key);
  if (params) {
    paramsCache.delete(key);
  } else {
    params = finalizeGalaxyParams(drawGalaxyShape(key));
  }
  paramsCache.set(key, params);
  if (paramsCache.size > PARAMS_CACHE_SIZE) {
    const oldest = paramsCache.keys().next().value;
    if (oldest !== undefined) paramsCache.delete(oldest);
  }
  return { ...params, homeLy: [params.homeLy[0], params.homeLy[1], params.homeLy[2]] };
}
