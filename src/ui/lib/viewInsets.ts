/**
 * How much of the 3D view the UI covers, in CSS px, so the engine can frame the focused object in the
 * visible remainder instead of behind a panel (`engineCommands().setViewInsets`). Only chrome that
 * stays put counts: the top bar, the desktop info plate (right) and the phone bottom sheet (bottom).
 * Dialogs are transient and the camera buttons / minimap are small, so they are ignored.
 *
 * Positions come from layout metrics (`offsetLeft` / `offsetTop`), not bounding boxes, so the slide-in
 * transforms on the panel never skew the measurement.
 */
import type { ViewInsets } from '../../state/bridge';

/** Layout-space boxes of the pieces that cover the view (null = not on screen). */
export interface CoverBoxes {
  width: number;
  height: number;
  /** Bottom edge of the top bar. */
  topbarBottom: number | null;
  /** Top-left corner of the info plate / sheet (both are anchored to the right / bottom edges). */
  panel: { left: number; top: number } | null;
}

/** Never let chrome swallow the view: the free rectangle keeps at least these fractions. */
const MAX_RIGHT = 0.6;
const MAX_BOTTOM = 0.6;
const MAX_TOP = 0.35;

const px = (v: number, max: number): number => Math.round(Math.min(Math.max(v, 0), max));

export function insetsFromBoxes(boxes: CoverBoxes, compact: boolean): ViewInsets {
  const { width, height, topbarBottom, panel } = boxes;
  return {
    top: topbarBottom === null ? 0 : px(topbarBottom, height * MAX_TOP),
    right: !compact && panel ? px(width - panel.left, width * MAX_RIGHT) : 0,
    bottom: compact && panel ? px(height - panel.top, height * MAX_BOTTOM) : 0,
    left: 0,
  };
}

/** Read the boxes from the overlay's DOM (`.sd-layout` is the offset parent of everything measured). */
export function readCoverBoxes(layout: HTMLElement): CoverBoxes {
  const topbar = layout.querySelector<HTMLElement>('.sd-topbar');
  const panel = layout.querySelector<HTMLElement>('aside.sd-info');
  return {
    width: layout.clientWidth,
    height: layout.clientHeight,
    topbarBottom: topbar ? topbar.offsetTop + topbar.offsetHeight : null,
    panel: panel ? { left: panel.offsetLeft, top: panel.offsetTop } : null,
  };
}
