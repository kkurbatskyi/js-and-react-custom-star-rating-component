/**
 * InputController — DOM pointer / wheel / keyboard events on the canvas → semantic actions.
 *
 * Gesture recognition is delegated to the pure GestureRecognizer; key mapping to ./keys.ts. Only the
 * canvas gets wheel/pointer listeners (page scroll elsewhere is never hijacked); the canvas style has
 * `touch-action: none`, so the browser's own pan/zoom gestures don't fight ours.
 */
import { type Gesture, GestureRecognizer, type PointerKind } from './gestures';
import {
  type HeldAction,
  heldAction,
  isInteractiveTarget,
  type PressAction,
  pressAction,
  wheelZoomFactor,
} from './keys';

export interface InputActions {
  /** Orbit by angles (rad); positive yaw turns the camera left round the focus. */
  orbitBy(dYaw: number, dPitch: number): void;
  /** Pan by a screen drag (CSS px). */
  panBy(dxPx: number, dyPx: number): void;
  /** Multiply the camera distance (< 1 zooms in); x/y: cursor (CSS px) or null for the centre. */
  zoomBy(factor: number, x: number | null, y: number | null): void;
  tap(x: number, y: number, count: 1 | 2, pointer: PointerKind): void;
  /** Throttled mouse hover (CSS px); null when the pointer left the canvas. */
  hover(x: number | null, y: number | null): void;
  press(action: PressAction): void;
}

/** Radians of orbit per viewport height dragged (2π·0.8: a full-height drag ≈ 290°). */
const ORBIT_PER_HEIGHT = Math.PI * 2 * 0.8;
const KEY_ORBIT_RAD_PER_SEC = 1.3;
const KEY_ZOOM_LOG_PER_SEC = 1.8;
const HOVER_INTERVAL_MS = 60;

export class InputController {
  private readonly canvas: HTMLElement;
  private readonly actions: InputActions;
  private readonly recognizer = new GestureRecognizer();
  private readonly gestures: Gesture[] = [];
  private readonly held = new Set<HeldAction>();
  private lastHover = 0;
  private hoverPending = false;
  private hoverX = 0;
  private hoverY = 0;
  private enabled = true;

  constructor(canvas: HTMLElement, actions: InputActions) {
    this.canvas = canvas;
    this.actions = actions;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('lostpointercapture', this.onCancel);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Disable while e.g. a modal owns the screen (held keys are released). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.onBlur();
  }

  /** Per frame: continuous keyboard orbit/zoom and the trailing hover pick. */
  update(dtSec: number): void {
    if (this.held.size > 0 && dtSec > 0) {
      const h = this.held;
      const yaw = (h.has('orbit-left') ? 1 : 0) - (h.has('orbit-right') ? 1 : 0);
      const pitch = (h.has('orbit-up') ? 1 : 0) - (h.has('orbit-down') ? 1 : 0);
      const zoom = (h.has('zoom-out') ? 1 : 0) - (h.has('zoom-in') ? 1 : 0);
      if (yaw !== 0 || pitch !== 0) {
        this.actions.orbitBy(yaw * KEY_ORBIT_RAD_PER_SEC * dtSec, pitch * KEY_ORBIT_RAD_PER_SEC * dtSec);
      }
      if (zoom !== 0) this.actions.zoomBy(Math.exp(zoom * KEY_ZOOM_LOG_PER_SEC * dtSec), null, null);
    }
    const now = performance.now();
    if (this.hoverPending && now - this.lastHover >= HOVER_INTERVAL_MS) {
      this.hoverPending = false;
      this.lastHover = now;
      this.actions.hover(this.hoverX, this.hoverY);
    }
  }

  dispose(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('lostpointercapture', this.onCancel);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  // ───────────────────────────────────────────── pointer

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private input(e: PointerEvent) {
    const { x, y } = this.local(e);
    const kind: PointerKind = e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';
    return {
      id: e.pointerId,
      x,
      y,
      t: e.timeStamp,
      kind,
      button: e.button < 0 ? 0 : e.button,
      modifier: e.shiftKey || e.ctrlKey || e.metaKey,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // capture can fail for synthetic events; tracking still works while over the canvas
    }
    this.recognizer.down(this.input(e), this.gestures);
    this.flush();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.recognizer.activeCount === 0) {
      if (e.pointerType === 'mouse') {
        const { x, y } = this.local(e);
        this.hoverX = x;
        this.hoverY = y;
        this.hoverPending = true;
      }
      return;
    }
    this.recognizer.move(this.input(e), this.gestures);
    this.flush();
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.recognizer.up(this.input(e), this.gestures);
    this.flush();
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.recognizer.cancel(e.pointerId);
  };

  private readonly onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && this.recognizer.activeCount === 0) {
      this.hoverPending = false;
      this.actions.hover(null, null);
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const { x, y } = this.local(e);
    this.actions.zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), x, y);
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault(); // right-drag pans
  };

  private flush(): void {
    const h = this.canvas.clientHeight || window.innerHeight || 1;
    for (const g of this.gestures) {
      switch (g.kind) {
        case 'orbit':
          this.actions.orbitBy((-g.dx / h) * ORBIT_PER_HEIGHT, (g.dy / h) * ORBIT_PER_HEIGHT);
          break;
        case 'pan':
          this.actions.panBy(g.dx, g.dy);
          break;
        case 'pinch':
          this.actions.zoomBy(1 / g.scale, g.x, g.y);
          break;
        case 'tap':
          this.actions.tap(g.x, g.y, g.count, g.pointer);
          break;
        case 'start':
          break;
      }
    }
    this.gestures.length = 0;
  }

  // ───────────────────────────────────────────── keyboard

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || e.defaultPrevented || isInteractiveTarget(e.target, e.key)) return;
    const held = heldAction(e);
    if (held) {
      this.held.add(held);
      if (e.key.startsWith('Arrow')) e.preventDefault(); // no page scroll
      return;
    }
    const press = pressAction(e);
    if (!press || e.repeat) return;
    if (press === 'toggle-pause') e.preventDefault(); // no page scroll / button activation
    this.actions.press(press);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const held = heldAction(e);
    if (held) this.held.delete(held);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.recognizer.reset();
  };
}
