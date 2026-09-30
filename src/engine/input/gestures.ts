/**
 * Pointer gesture recognition — pure (events in, gestures out), so it is unit-tested without a DOM.
 *
 *   1 pointer   drag → orbit (secondary/middle button or modifier: pan) · tap → select
 *   2 pointers  pinch → zoom about the centroid, centroid motion → pan
 *   tap + tap within DOUBLE_TAP_MS and DOUBLE_TAP_PX → double tap (fly to)
 *
 * Mouse, touch and pen go through the same code; only the tap slop differs.
 */

export type PointerKind = 'mouse' | 'touch' | 'pen';

export interface PointerInput {
  id: number;
  x: number;
  y: number;
  /** ms timestamp. */
  t: number;
  kind: PointerKind;
  /** 0 primary, 1 middle, 2 secondary. */
  button: number;
  /** Shift/Ctrl/Meta held: a primary drag pans instead of orbiting. */
  modifier: boolean;
}

export type Gesture =
  | { kind: 'orbit'; dx: number; dy: number }
  | { kind: 'pan'; dx: number; dy: number }
  /** scale > 1: fingers moved apart (zoom in). x/y: centroid. */
  | { kind: 'pinch'; scale: number; x: number; y: number }
  | { kind: 'tap'; x: number; y: number; count: 1 | 2; pointer: PointerKind }
  /** A drag or pinch began (flights are interrupted, idle timers reset). */
  | { kind: 'start' };

export const TAP_SLOP_PX: Readonly<Record<PointerKind, number>> = { mouse: 5, pen: 8, touch: 10 };
export const TAP_MAX_MS = 450;
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_PX = 28;

interface Tracked {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
  kind: PointerKind;
  button: number;
  modifier: boolean;
}

export class GestureRecognizer {
  private readonly pointers = new Map<number, Tracked>();
  /** The current single-pointer interaction may still become a tap. */
  private tapCandidate = false;
  private dragging = false;
  private pinchDist = 0;
  private pinchX = 0;
  private pinchY = 0;
  private lastTapT = Number.NEGATIVE_INFINITY;
  private lastTapX = 0;
  private lastTapY = 0;

  get activeCount(): number {
    return this.pointers.size;
  }

  down(p: PointerInput, out: Gesture[]): void {
    this.pointers.set(p.id, {
      x: p.x,
      y: p.y,
      startX: p.x,
      startY: p.y,
      startT: p.t,
      kind: p.kind,
      button: p.button,
      modifier: p.modifier,
    });
    if (this.pointers.size === 1) {
      this.tapCandidate = true;
      this.dragging = false;
    } else {
      this.tapCandidate = false;
      if (this.pointers.size === 2) {
        this.beginPinch();
        out.push({ kind: 'start' });
      }
    }
  }

  move(p: PointerInput, out: Gesture[]): void {
    const tr = this.pointers.get(p.id);
    if (!tr) return;
    const dx = p.x - tr.x;
    const dy = p.y - tr.y;
    tr.x = p.x;
    tr.y = p.y;
    if (this.pointers.size === 1) {
      if (!this.dragging) {
        const moved = Math.hypot(p.x - tr.startX, p.y - tr.startY);
        if (moved <= TAP_SLOP_PX[tr.kind]) return;
        this.dragging = true;
        this.tapCandidate = false;
        out.push({ kind: 'start' });
        // Count the whole distance since the press, so the slop is not "lost".
        const sx = p.x - tr.startX;
        const sy = p.y - tr.startY;
        out.push(this.dragGesture(tr, sx, sy));
        return;
      }
      if (dx !== 0 || dy !== 0) out.push(this.dragGesture(tr, dx, dy));
      return;
    }
    if (this.pointers.size === 2) {
      const [a, b] = this.two();
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const scale = dist / this.pinchDist;
      if (scale !== 1) out.push({ kind: 'pinch', scale, x: cx, y: cy });
      if (cx !== this.pinchX || cy !== this.pinchY) {
        out.push({ kind: 'pan', dx: cx - this.pinchX, dy: cy - this.pinchY });
      }
      this.pinchDist = dist;
      this.pinchX = cx;
      this.pinchY = cy;
    }
  }

  up(p: PointerInput, out: Gesture[]): void {
    const tr = this.pointers.get(p.id);
    if (!tr) return;
    this.pointers.delete(p.id);
    if (this.pointers.size === 0) {
      if (this.tapCandidate && p.t - tr.startT <= TAP_MAX_MS && tr.button === 0) {
        const isDouble =
          p.t - this.lastTapT <= DOUBLE_TAP_MS &&
          Math.hypot(p.x - this.lastTapX, p.y - this.lastTapY) <= DOUBLE_TAP_PX;
        out.push({ kind: 'tap', x: p.x, y: p.y, count: isDouble ? 2 : 1, pointer: tr.kind });
        // A double tap consumes the pair; a third tap starts a new sequence.
        this.lastTapT = isDouble ? Number.NEGATIVE_INFINITY : p.t;
        this.lastTapX = p.x;
        this.lastTapY = p.y;
      }
      this.tapCandidate = false;
      this.dragging = false;
      return;
    }
    // 2 → 1 pointers: continue as a drag from where the remaining finger is (no jump, no tap).
    this.tapCandidate = false;
    this.dragging = true;
    if (this.pointers.size === 2) this.beginPinch();
  }

  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size === 0) {
      this.tapCandidate = false;
      this.dragging = false;
    }
  }

  reset(): void {
    this.pointers.clear();
    this.tapCandidate = false;
    this.dragging = false;
  }

  private dragGesture(tr: Tracked, dx: number, dy: number): Gesture {
    const pan = tr.button === 2 || tr.button === 1 || tr.modifier;
    return pan ? { kind: 'pan', dx, dy } : { kind: 'orbit', dx, dy };
  }

  private two(): [Tracked, Tracked] {
    const it = this.pointers.values();
    return [it.next().value as Tracked, it.next().value as Tracked];
  }

  private beginPinch(): void {
    const [a, b] = this.two();
    this.pinchDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.pinchX = (a.x + b.x) / 2;
    this.pinchY = (a.y + b.y) / 2;
  }
}
