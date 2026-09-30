/**
 * 'full' PlanetVisuals (high-resolution GPU bakes) for the focus and the flight destination, kept for
 * the last ~3 bodies (LRU) so hopping between a planet and its moon never re-bakes.
 */
import type { BodyBase, StarSystem } from '../../core/types';
import type { IPlanetVisual, Quality } from '../../render/contracts';
import { PlanetVisual } from '../../render/planet/PlanetVisual';

export class FullVisualCache {
  private readonly entries = new Map<string, IPlanetVisual>();
  private quality: Quality;
  private readonly capacity: number;

  constructor(quality: Quality, capacity = 3) {
    this.quality = quality;
    this.capacity = capacity;
  }

  /** The full visual for a body (created on first use; most-recently-used). */
  get(body: BodyBase, system: StarSystem): IPlanetVisual {
    let v = this.entries.get(body.id);
    if (v) {
      this.entries.delete(body.id);
      this.entries.set(body.id, v);
      return v;
    }
    v = new PlanetVisual(body, { system }, this.quality, 'full');
    this.entries.set(body.id, v);
    while (this.entries.size > this.capacity) {
      const [id, oldest] = this.entries.entries().next().value as [string, IPlanetVisual];
      this.entries.delete(id);
      oldest.object.removeFromParent();
      oldest.dispose();
    }
    return v;
  }

  peek(id: string): IPlanetVisual | null {
    return this.entries.get(id) ?? null;
  }

  /** Bake sizes depend on quality: drop everything and re-bake lazily. */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.clear();
  }

  clear(): void {
    for (const v of this.entries.values()) {
      v.object.removeFromParent();
      v.dispose();
    }
    this.entries.clear();
  }
}
