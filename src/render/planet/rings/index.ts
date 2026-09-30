/**
 * Planetary rings: a flat annulus in the body's equatorial plane (body-fixed XZ; Y = spin axis) with
 * procedural radial structure, slab photometry, optical-depth transparency and the planet's shadow.
 * Drawn as two view-dependent halves sharing one geometry (RENDER_ORDER.ringsFar / ringsNear), so the far
 * half sits behind the atmosphere and clouds and the near half in front of them.
 *
 * Composition contract: the returned `object` is added to the PlanetVisual's root group, which already
 * carries positionKm/orientation — do not transform it yourself.
 *
 * Ring SHADOW on the planet: the surface shaders include `ringShadowGlsl` (a drop-in replacement for their
 * `ringProfile` + `ringShadow`) and feed it `ringUniformVector(body.rings)`. See README.md.
 */
import type { BodyBase, StarSystem } from '../../../core/types';
import type { IRingVisual, Quality } from '../../contracts';
import { RingVisual } from './RingVisual';

export { RingVisual } from './RingVisual';
export { ringUniformVector } from './ringMaterial';
export { ringProfileGlsl, ringShadowGlsl } from './ringProfile.glsl';

/** Rings in the body's equatorial plane, or null when it has none (moons never do). */
export function createRings(
  body: BodyBase,
  _system: StarSystem,
  quality: Quality,
): IRingVisual | null {
  return body.rings ? new RingVisual(body, body.rings, quality) : null;
}
