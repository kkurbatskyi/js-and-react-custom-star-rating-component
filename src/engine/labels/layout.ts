/**
 * Greedy label placement: labels are placed in priority order; each tries its previous side first
 * (stability — labels don't hop around while the camera moves), then right, left, above, below of
 * its anchor, and is hidden when every side collides with an already placed label or marker.
 * O(n²) in the number of candidates, which the overlay caps at a few dozen.
 */

export const Side = { Right: 0, Left: 1, Above: 2, Below: 3 } as const;

export interface LabelBox {
  /** Anchor (CSS px). */
  x: number;
  y: number;
  /** Text block size (CSS px). */
  w: number;
  h: number;
  priority: number;
  /** Gap between the anchor and the text (marker radius + padding). */
  gap: number;
  /** Side used last frame, or −1. */
  preferred: number;
  // ── outputs
  visible: boolean;
  side: number;
  /** Top-left of the text block. */
  left: number;
  top: number;
}

const SIDES = [Side.Right, Side.Left, Side.Above, Side.Below] as const;
/** Space kept clear around every placed block (CSS px). */
const PAD = 3;

function place(b: LabelBox, side: number): void {
  switch (side) {
    case Side.Right:
      b.left = b.x + b.gap;
      b.top = b.y - b.h / 2;
      break;
    case Side.Left:
      b.left = b.x - b.gap - b.w;
      b.top = b.y - b.h / 2;
      break;
    case Side.Above:
      b.left = b.x - b.w / 2;
      b.top = b.y - b.gap - b.h;
      break;
    default:
      b.left = b.x - b.w / 2;
      b.top = b.y + b.gap;
  }
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    a.left < b.left + b.w + PAD &&
    b.left < a.left + a.w + PAD &&
    a.top < b.top + b.h + PAD &&
    b.top < a.top + a.h + PAD
  );
}

/** The block of `a` against the anchor marker of `b` (a small square around b's anchor). */
function hitsAnchor(a: LabelBox, b: LabelBox): boolean {
  const r = Math.max(3, b.gap - 4);
  return a.left < b.x + r && b.x - r < a.left + a.w && a.top < b.y + r && b.y - r < a.top + a.h;
}

function inside(b: LabelBox, width: number, height: number): boolean {
  return b.left >= 2 && b.top >= 2 && b.left + b.w <= width - 2 && b.top + b.h <= height - 2;
}

/**
 * Place `boxes[0..count)` (reordered in place by descending priority). Returns the number visible.
 */
export function layoutLabels(boxes: LabelBox[], count: number, width: number, height: number): number {
  // Insertion sort by priority, descending (stable, small n).
  for (let i = 1; i < count; i++) {
    const it = boxes[i];
    let j = i - 1;
    while (j >= 0 && boxes[j].priority < it.priority) {
      boxes[j + 1] = boxes[j];
      j--;
    }
    boxes[j + 1] = it;
  }
  let visible = 0;
  for (let i = 0; i < count; i++) {
    const b = boxes[i];
    b.visible = false;
    for (let k = -1; k < SIDES.length; k++) {
      const side = k < 0 ? b.preferred : SIDES[k];
      if (side < 0 || (k >= 0 && side === b.preferred)) continue;
      place(b, side);
      if (!inside(b, width, height)) continue;
      let free = true;
      for (let j = 0; j < i && free; j++) {
        const o = boxes[j];
        if (!o.visible) continue;
        free = !overlaps(b, o) && !hitsAnchor(b, o);
      }
      if (free) {
        b.visible = true;
        b.side = side;
        visible++;
        break;
      }
    }
  }
  return visible;
}
