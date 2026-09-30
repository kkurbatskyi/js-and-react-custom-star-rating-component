import { describe, expect, it } from 'vitest';
import { type Gesture, GestureRecognizer, type PointerInput } from './gestures';
import { heldAction, isInteractiveTarget, pressAction, wheelZoomFactor } from './keys';

const p = (
  id: number,
  x: number,
  y: number,
  t: number,
  extra: Partial<PointerInput> = {},
): PointerInput => ({
  id,
  x,
  y,
  t,
  kind: 'mouse',
  button: 0,
  modifier: false,
  ...extra,
});

describe('GestureRecognizer', () => {
  it('recognises a tap and a double tap', () => {
    const g = new GestureRecognizer();
    const out: Gesture[] = [];
    g.down(p(1, 100, 100, 0), out);
    g.up(p(1, 101, 100, 80), out);
    g.down(p(1, 102, 101, 200), out);
    g.up(p(1, 102, 101, 260), out);
    expect(out).toEqual([
      { kind: 'tap', x: 101, y: 100, count: 1, pointer: 'mouse' },
      { kind: 'tap', x: 102, y: 101, count: 2, pointer: 'mouse' },
    ]);
  });

  it('turns a drag past the slop into orbit deltas without losing the slop', () => {
    const g = new GestureRecognizer();
    const out: Gesture[] = [];
    g.down(p(1, 0, 0, 0), out);
    g.move(p(1, 3, 0, 10), out);
    expect(out).toEqual([]);
    g.move(p(1, 12, 4, 20), out);
    g.move(p(1, 20, 4, 30), out);
    g.up(p(1, 20, 4, 40), out);
    expect(out).toEqual([
      { kind: 'start' },
      { kind: 'orbit', dx: 12, dy: 4 },
      { kind: 'orbit', dx: 8, dy: 0 },
    ]);
  });

  it('pans with the secondary button or a modifier', () => {
    const g = new GestureRecognizer();
    const out: Gesture[] = [];
    g.down(p(1, 0, 0, 0, { button: 2 }), out);
    g.move(p(1, 20, 0, 10, { button: 2 }), out);
    expect(out[1]).toEqual({ kind: 'pan', dx: 20, dy: 0 });
  });

  it('pinches and pans with two fingers, then continues as a drag without a tap', () => {
    const g = new GestureRecognizer();
    const out: Gesture[] = [];
    const touch = { kind: 'touch' as const };
    g.down(p(1, 100, 100, 0, touch), out);
    g.down(p(2, 200, 100, 5, touch), out);
    g.move(p(2, 300, 100, 20, touch), out);
    expect(out).toContainEqual({ kind: 'pinch', scale: 2, x: 200, y: 100 });
    expect(out).toContainEqual({ kind: 'pan', dx: 50, dy: 0 });
    out.length = 0;
    g.up(p(2, 300, 100, 30, touch), out);
    g.move(p(1, 110, 100, 40, touch), out);
    g.up(p(1, 110, 100, 50, touch), out);
    expect(out).toEqual([{ kind: 'orbit', dx: 10, dy: 0 }]);
  });
});

describe('keys', () => {
  it('maps held and pressed keys, ignoring chords', () => {
    expect(heldAction({ key: 'ArrowLeft' })).toBe('orbit-left');
    expect(heldAction({ key: 'W' })).toBe('orbit-up');
    expect(heldAction({ key: '=' })).toBe('zoom-in');
    expect(pressAction({ key: 'Escape' })).toBe('up-level');
    expect(pressAction({ key: ' ' })).toBe('toggle-pause');
    expect(pressAction({ key: 'k', metaKey: true })).toBeNull();
    expect(pressAction({ key: '/' })).toBeNull();
    expect(heldAction({ key: 'a', ctrlKey: true })).toBeNull();
  });

  it('leaves typing and control activation alone', () => {
    const el = (tagName: string, role: string | null = null) => ({
      tagName,
      getAttribute: () => role,
    });
    expect(isInteractiveTarget(el('INPUT'), 'a')).toBe(true);
    expect(isInteractiveTarget(el('TEXTAREA'), 'Escape')).toBe(true);
    expect(isInteractiveTarget({ tagName: 'DIV', isContentEditable: true }, 'f')).toBe(true);
    expect(isInteractiveTarget(el('BUTTON'), ' ')).toBe(true);
    expect(isInteractiveTarget(el('BUTTON'), 'f')).toBe(false);
    expect(isInteractiveTarget(el('DIV', 'button'), 'Enter')).toBe(true);
    expect(isInteractiveTarget(el('CANVAS'), ' ')).toBe(false);
    expect(isInteractiveTarget(null, ' ')).toBe(false);
  });

  it('normalises wheel deltas', () => {
    expect(wheelZoomFactor(0, 0, false)).toBe(1);
    expect(wheelZoomFactor(100, 0, false)).toBeGreaterThan(1.3);
    expect(wheelZoomFactor(-100, 0, false)).toBeLessThan(0.75);
    expect(wheelZoomFactor(3, 1, false)).toBeCloseTo(wheelZoomFactor(48, 0, false), 12);
    expect(wheelZoomFactor(1e6, 0, false)).toBe(wheelZoomFactor(150, 0, false));
    expect(wheelZoomFactor(10, 0, true)).toBeGreaterThan(wheelZoomFactor(10, 0, false));
  });
});
