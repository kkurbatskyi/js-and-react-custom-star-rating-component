/**
 * Depth slicing (docs/ARCHITECTURE.md §5): split a layer's depth range into contiguous slices, each
 * with a tight near/far, placing every boundary in a GAP between objects so no object straddles two
 * slices. Slices render far → near with the depth buffer cleared in between, which keeps a 24-bit
 * depth buffer precise from a moon 1 km below the camera to its giant planet 10⁶ km away — no
 * logarithmic depth needed.
 *
 * Depth resolution at distance z is ≈ z² / (near · 2²⁴), i.e. a relative resolution of
 * (far/near) / 2²⁴ at the far plane: MAX_RATIO = 2·10⁴ keeps it ≈ 10⁻³.
 *
 * Allocation-free: callers own an `Interval[]` pool and a `LayerRenderSpec[]` pool.
 */
import type { LayerRenderSpec } from '../../engine/contracts';

export const MAX_DEPTH_RATIO = 2e4;
/** Nothing is ever closer than this (km or ly — the layer's unit). */
export const MIN_NEAR = 1e-4;

export interface Interval {
  near: number;
  far: number;
}

/**
 * @param intervals radial [near, far] extents of the layer's objects (modified: sorted in place).
 * @param count number of valid intervals.
 * @param cover optional extent the slices must also cover (lines, point clouds): widens the
 *   nearest slice's near and the farthest slice's far, never adds boundaries.
 * @param out receives the slices FAR → NEAR (its objects are reused); returns the slice count.
 */
export function buildSlices(
  intervals: Interval[],
  count: number,
  out: LayerRenderSpec[],
  cover: Interval | null = null,
): number {
  if (count === 0 && !cover) return 0;
  const list = intervals;
  // Insertion sort by near (counts are small: a system's bodies).
  for (let i = 1; i < count; i++) {
    const it = list[i];
    let j = i - 1;
    while (j >= 0 && list[j].near > it.near) {
      list[j + 1] = list[j];
      j--;
    }
    list[j + 1] = it;
  }

  // Walk near → far, merging overlaps into clusters and clusters into slices.
  let n = 0;
  let sliceNear = count > 0 ? list[0].near : (cover as Interval).near;
  let sliceFar = count > 0 ? list[0].far : (cover as Interval).far;
  for (let i = 1; i < count; i++) {
    const it = list[i];
    if (it.near <= sliceFar) {
      sliceFar = Math.max(sliceFar, it.far); // overlapping: same cluster, must share a slice
    } else if (it.far / Math.max(sliceNear, MIN_NEAR) <= MAX_DEPTH_RATIO) {
      sliceFar = it.far; // separate, but the slice can still hold it precisely
    } else {
      // Close the slice inside the gap, balancing the two slices' far/near ratios: the optimum
      // √(near₀·far₁) clamped into the gap (with a 1 % margin on both sides when it allows).
      const balanced = Math.sqrt(Math.max(sliceNear, MIN_NEAR) * it.far);
      const lo = sliceFar * 1.01;
      const hi = it.near * 0.99;
      const boundary =
        lo <= hi ? Math.min(hi, Math.max(lo, balanced)) : Math.sqrt(sliceFar * it.near);
      n = emit(out, n, sliceNear, boundary);
      sliceNear = boundary;
      sliceFar = it.far;
    }
  }
  n = emit(out, n, sliceNear, sliceFar);

  // Margins, the cover extent, and the near-plane floor.
  const first = out[0]; // nearest (reversed below)
  const last = out[n - 1];
  first.near = Math.max(MIN_NEAR, Math.min(first.near * 0.98, cover ? cover.near : first.near));
  last.far = Math.max(last.far * 1.02, cover ? cover.far : 0);
  // Reverse into far → near order.
  for (let i = 0, j = n - 1; i < j; i++, j--) {
    const a = out[i];
    out[i] = out[j];
    out[j] = a;
  }
  return n;
}

function emit(out: LayerRenderSpec[], n: number, near: number, far: number): number {
  let s = out[n];
  if (!s) {
    s = { near: 0, far: 0 };
    out[n] = s;
  }
  s.near = near;
  s.far = far;
  s.scene = undefined;
  return n + 1;
}
