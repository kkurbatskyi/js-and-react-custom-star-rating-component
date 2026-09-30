/**
 * Planet atmosphere: a physically based single-scattering shell (Rayleigh + Mie + ozone/methane
 * absorption), raymarched analytically against the planet's own sphere. See README.md.
 *
 * Composition contract (shared by all planet sub-components): the returned `object` is added to the
 * PlanetVisual's root group, which already carries `positionKm` and `orientation`. Work in body-fixed
 * km (Y = spin axis) and do NOT apply positionKm/orientation to `object` yourself.
 */
import type { BodyBase, StarSystem } from '../../../core/types';
import type { IAtmosphereShell, Quality } from '../../contracts';
import { AtmosphereShell } from './AtmosphereShell';
import { deriveAtmosphere } from './params';

export { AtmosphereShell } from './AtmosphereShell';
export type { AtmosphereKind, AtmosphereParams } from './params';
export { deriveAtmosphere, MIN_PRESSURE_ATM } from './params';

/** A scattering shell for bodies with a meaningful atmosphere, else null. */
export function createAtmosphere(
  body: BodyBase,
  _system: StarSystem,
  quality: Quality,
): IAtmosphereShell | null {
  const params = deriveAtmosphere(body);
  return params ? new AtmosphereShell(body, params, quality) : null;
}
