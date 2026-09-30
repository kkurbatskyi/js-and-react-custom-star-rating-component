/**
 * Planet clouds: an animated procedural cloud shell (cumulus fields with cyclones, an ITCZ and storm
 * tracks; full overcast for hothouse worlds; thin wisps on thin-air deserts), lit by the sun with soft
 * self-shadowing, silver linings and reddening towards the terminator. See README.md.
 *
 * Composition contract: a returned layer's `object` is added to the PlanetVisual's root group (which
 * carries positionKm/orientation) and uses RENDER_ORDER.clouds.
 */
import type { BodyBase, StarSystem } from '../../../core/types';
import type { ICloudLayer, Quality } from '../../contracts';
import { CloudLayer } from './CloudLayer';
import { deriveClouds } from './params';

export { CloudLayer } from './CloudLayer';
export { cloudFieldGlsl } from './cloudField.glsl';
export { cloudShadowGlsl } from './cloudShadow.glsl';
export type { CloudParams, CloudStyle } from './params';
export { deriveClouds } from './params';

/** A cloud layer for bodies with air and cloud cover, else null (giants paint their own bands). */
export function createClouds(
  body: BodyBase,
  _system: StarSystem,
  quality: Quality,
): ICloudLayer | null {
  const params = deriveClouds(body);
  return params ? new CloudLayer(body, params, quality) : null;
}
