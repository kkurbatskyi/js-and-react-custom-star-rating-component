/**
 * Planet clouds — STUB (integration phase). Returns null for every body; the clouds specialist
 * replaces it with a real cloud layer (factory signature and `ICloudLayer` stay). Until then the
 * PlanetVisual stub folds `appearance.cloudCoverage` / `cloudColor` into its surface shader, so
 * cloudy worlds still read correctly.
 *
 * Composition contract: a returned layer's `object` is added to the PlanetVisual's root group
 * (which carries positionKm/orientation) and should use RENDER_ORDER.clouds.
 */
import type { BodyBase, StarSystem } from '../../../core/types';
import type { ICloudLayer, Quality } from '../../contracts';

export function createClouds(_body: BodyBase, _system: StarSystem, _quality: Quality): ICloudLayer | null {
  return null;
}
