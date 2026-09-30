/**
 * Keyboard map and wheel normalisation — pure, unit-tested.
 *
 *   arrows / WASD  orbit (held)          + / −   zoom (held)
 *   Esc            up a level            F       fly to the selection
 *   Space          pause / resume        H       photo mode
 *   [ / ]          slower / faster time
 * The UI owns ⌘K and / (search). Keys are ignored while the user types in a field.
 */

export type HeldAction =
  | 'orbit-left'
  | 'orbit-right'
  | 'orbit-up'
  | 'orbit-down'
  | 'zoom-in'
  | 'zoom-out';
export type PressAction =
  | 'up-level'
  | 'fly-selection'
  | 'toggle-pause'
  | 'photo-mode'
  | 'slower'
  | 'faster';

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const HELD: Readonly<Record<string, HeldAction>> = {
  ArrowLeft: 'orbit-left',
  ArrowRight: 'orbit-right',
  ArrowUp: 'orbit-up',
  ArrowDown: 'orbit-down',
  a: 'orbit-left',
  d: 'orbit-right',
  w: 'orbit-up',
  s: 'orbit-down',
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  _: 'zoom-out',
};

const PRESS: Readonly<Record<string, PressAction>> = {
  Escape: 'up-level',
  f: 'fly-selection',
  ' ': 'toggle-pause',
  h: 'photo-mode',
  '[': 'slower',
  ']': 'faster',
};

function normalise(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** A continuous (held) action for this key, or null. Modifier chords are never ours. */
export function heldAction(e: KeyLike): HeldAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return HELD[normalise(e.key)] ?? null;
}

/** A discrete action for this key press, or null. */
export function pressAction(e: KeyLike): PressAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return PRESS[normalise(e.key)] ?? null;
}

/** Minimal element shape (so the predicate is testable without a DOM). */
export interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** Keys like Space/Enter activate these; never steal them. */
const ACTIVATING_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

/** True when a key event should be left to the focused element (typing, or activating a control). */
export function isInteractiveTarget(target: unknown, key: string): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as ElementLike;
  const tag = (el.tagName ?? '').toUpperCase();
  if (TYPING_TAGS.has(tag) || el.isContentEditable) return true;
  const role = el.getAttribute?.('role') ?? '';
  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
  const activates = key === ' ' || key === 'Enter';
  return activates && (ACTIVATING_TAGS.has(tag) || role === 'button' || role === 'slider');
}

/**
 * Wheel delta → zoom factor (> 1 zooms out). Lines/pages are converted to pixels; trackpad pinch
 * arrives as ctrl+wheel with small deltas and gets a higher gain. Clamped so one notch of a coarse
 * mouse wheel is ~1.35×, and a flick can never teleport.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY;
  const gain = ctrlKey ? 0.012 : 0.003;
  const x = Math.max(-150, Math.min(150, px)) * gain;
  return Math.exp(x);
}
