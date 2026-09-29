/**
 * `GalaxyModel` (src/core/types.ts) — the structure of the galaxy as analytic fields:
 * exponential disk + trailing log-spiral arms + flattened Plummer bulge + optional bar + sparse
 * halo, with dust lanes on the concave side of the arms. Details and equations: ./README.md.
 *
 * All field functions are allocation-free (≈ 0.1 µs per call) and safe to destructure.
 */
import type { GalaxyModel, GalaxyParams, Rng } from '../../core/types';
import { createGalaxyParams, GALAXY_HOME_DENSITY } from './params';
import { getGalaxyStructure } from './structure';

/**
 * Build a model from explicit parameters (e.g. hand-tuned in a dev harness after
 * `finalizeGalaxyParams`). The density is calibrated so that `stellarDensity(homeLy)` equals
 * GALAXY_HOME_DENSITY. `params` is copied and frozen.
 */
export function createGalaxyModelFromParams(params: GalaxyParams): GalaxyModel {
  const frozen: GalaxyParams = Object.freeze({
    ...params,
    homeLy: Object.freeze([params.homeLy[0], params.homeLy[1], params.homeLy[2]] as const),
  });
  const s = getGalaxyStructure(frozen);
  const [hx, hy, hz] = frozen.homeLy;
  const raw = s.density(hx, hy, hz);
  const scale = raw > 0 && Number.isFinite(raw) ? GALAXY_HOME_DENSITY / raw : 1;
  const unscaled = s.density;
  return {
    params: frozen,
    stellarDensity: (x: number, y: number, z: number): number => scale * unscaled(x, y, z),
    dustDensity: s.dust,
    armFactor: s.armFactor,
    youngFraction: s.young,
    bulgeFraction: s.bulgeShare,
    samplePosition: (
      rng: Rng,
      out: [number, number, number] = [0, 0, 0],
    ): [number, number, number] => s.sample(rng, out),
  };
}

const MODEL_CACHE_SIZE = 4;
const modelCache = new Map<number, GalaxyModel>();

/** The galaxy for a seed (memoised: repeated calls return the same immutable model). */
export function createGalaxyModel(seed: number): GalaxyModel {
  const key = seed >>> 0;
  const hit = modelCache.get(key);
  if (hit) {
    modelCache.delete(key);
    modelCache.set(key, hit);
    return hit;
  }
  const model = createGalaxyModelFromParams(createGalaxyParams(key));
  modelCache.set(key, model);
  if (modelCache.size > MODEL_CACHE_SIZE) {
    const oldest = modelCache.keys().next().value;
    if (oldest !== undefined) modelCache.delete(oldest);
  }
  return model;
}
