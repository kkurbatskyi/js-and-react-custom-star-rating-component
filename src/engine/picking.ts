/**
 * Picking and label culling across layers (docs/ARCHITECTURE.md §5): layers are queried near → far;
 * each nearer layer contributes screen-space occluder discs (planet and star disks) that hide the
 * picks and labels of every farther layer behind them. Best hit = smallest pixel distance; ties go
 * to the nearer layer.
 */
import type { ScreenDisc } from '../render/contracts';
import type { LabelSpec, Layer, PickHit } from './contracts';

export function insideAnyDisc(
  discs: readonly ScreenDisc[],
  count: number,
  x: number,
  y: number,
): boolean {
  for (let i = 0; i < count; i++) {
    const d = discs[i];
    const dx = x - d.x;
    const dy = y - d.y;
    if (dx * dx + dy * dy <= d.radiusPx * d.radiusPx) return true;
  }
  return false;
}

/** Scratch list of occluders (grown on demand, never shrunk). */
const _discs: ScreenDisc[] = [];

/** `layers` are ordered far → near, as rendered. `active[i]` says whether layer i drew this frame. */
export function pickLayers(
  layers: readonly Layer[],
  active: readonly boolean[],
  x: number,
  y: number,
  maxDistPx: number,
): PickHit | null {
  _discs.length = 0;
  let best: PickHit | null = null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!active[i]) continue;
    const count = _discs.length; // discs of strictly nearer layers
    const hit = layer.pick?.(x, y, maxDistPx) ?? null;
    if (hit && !insideAnyDisc(_discs, count, hit.x ?? x, hit.y ?? y)) {
      if (!best || hit.distPx < best.distPx) best = hit;
    }
    layer.occluders?.(_discs);
  }
  return best;
}

/**
 * Collect every active layer's labels into `out` (cleared first), dropping those hidden behind a
 * nearer layer's occluders. Returns the number of labels.
 */
export function collectLabels(
  layers: readonly Layer[],
  active: readonly boolean[],
  out: LabelSpec[],
  scratch: LabelSpec[],
): number {
  out.length = 0;
  _discs.length = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!active[i]) continue;
    const count = _discs.length;
    if (layer.labels) {
      scratch.length = 0;
      layer.labels(scratch);
      for (const spec of scratch) {
        if (!insideAnyDisc(_discs, count, spec.x, spec.y)) out.push(spec);
      }
    }
    layer.occluders?.(_discs);
  }
  scratch.length = 0;
  return out.length;
}
