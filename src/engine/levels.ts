/**
 * The ONE place that decides the view level and the active system (docs/ARCHITECTURE.md §4, §7).
 *
 *  - `planet` — the focus is a planet/moon and the camera is inside its "planet zone".
 *  - `system` — the camera is inside the active system's `radiusKm`.
 *  - `galaxy` — otherwise.
 *
 * The active system is only ever the focus star or a flight endpoint star (the caller passes those
 * as candidates) — never a per-frame nearest-star search. Both decisions use enter/exit hysteresis
 * so hovering at a boundary never flickers layers on and off.
 */
import type { FocusTarget, StarId, ViewLevel } from '../core/types';

/** Leave the planet zone only beyond this multiple of its radius. */
export const PLANET_EXIT_FACTOR = 1.25;
/** Leave a system only beyond this multiple of its radius. */
export const SYSTEM_EXIT_FACTOR = 1.1;

export function levelFor(
  focusKind: FocusTarget['kind'],
  inPlanetZone: boolean,
  inSystem: boolean,
): ViewLevel {
  if ((focusKind === 'planet' || focusKind === 'moon') && inPlanetZone) return 'planet';
  return inSystem ? 'system' : 'galaxy';
}

/** A star whose system the camera may be inside (reused objects: no per-frame allocation). */
export interface SystemCandidate {
  id: StarId | null;
  /** Camera distance to the star, km. */
  distanceKm: number;
  radiusKm: number;
}

export class LevelTracker {
  level: ViewLevel = 'galaxy';
  systemId: StarId | null = null;
  private inPlanetZone = false;

  /**
   * @param candidates the first `count` entries are considered (null ids are skipped).
   * @param planetZoneKm radius of the focus body's planet zone (ignored for star/galaxy focus).
   */
  update(
    focusKind: FocusTarget['kind'],
    focusDistanceKm: number,
    planetZoneKm: number,
    candidates: readonly SystemCandidate[],
    count: number,
  ): ViewLevel {
    const isBody = focusKind === 'planet' || focusKind === 'moon';
    const zone = this.inPlanetZone ? planetZoneKm * PLANET_EXIT_FACTOR : planetZoneKm;
    this.inPlanetZone = isBody && focusDistanceKm < zone;

    let next: StarId | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const c = candidates[i];
      if (c.id === null) continue;
      const limit = c.id === this.systemId ? c.radiusKm * SYSTEM_EXIT_FACTOR : c.radiusKm;
      const depth = c.distanceKm / c.radiusKm; // prefer the system we are deepest inside
      if (c.distanceKm < limit && depth < best) {
        next = c.id;
        best = depth;
      }
    }
    this.systemId = next;
    this.level = levelFor(focusKind, this.inPlanetZone, next !== null);
    return this.level;
  }

  reset(): void {
    this.level = 'galaxy';
    this.systemId = null;
    this.inPlanetZone = false;
  }
}
