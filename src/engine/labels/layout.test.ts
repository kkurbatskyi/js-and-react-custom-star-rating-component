import { describe, expect, it } from 'vitest';
import { type LabelBox, layoutLabels } from './layout';

const box = (x: number, y: number, priority: number, preferred = -1): LabelBox => ({
  x,
  y,
  w: 60,
  h: 14,
  priority,
  gap: 8,
  preferred,
  visible: false,
  side: -1,
  left: 0,
  top: 0,
});

describe('layoutLabels', () => {
  it('places an isolated label to the right of its anchor', () => {
    const b = box(100, 100, 1);
    expect(layoutLabels([b], 1, 800, 600)).toBe(1);
    expect(b.visible).toBe(true);
    expect(b.left).toBe(108);
    expect(b.top).toBe(93);
  });

  it('resolves a collision by side, then by hiding the lower priority', () => {
    const hi = box(100, 100, 10);
    const lo = box(102, 100, 5);
    const boxes = [lo, hi];
    expect(layoutLabels(boxes, 2, 800, 600)).toBe(2);
    expect(boxes[0]).toBe(hi); // sorted by priority
    expect(hi.side).toBe(0);
    expect(lo.visible).toBe(true);
    expect(lo.side).not.toBe(0);

    // A crowd on one spot: only as many as there are free sides survive.
    const crowd = [1, 2, 3, 4, 5, 6].map((p) => box(300, 300, p));
    const n = layoutLabels(crowd, crowd.length, 800, 600);
    expect(n).toBeLessThan(6);
    expect(crowd[0].priority).toBe(6);
    expect(crowd[0].visible).toBe(true);
  });

  it('keeps labels inside the viewport', () => {
    const edge = box(795, 100, 1);
    layoutLabels([edge], 1, 800, 600);
    expect(edge.visible).toBe(true);
    expect(edge.left + edge.w).toBeLessThanOrEqual(798);
  });

  it('prefers last frame’s side for stability', () => {
    const b = box(400, 300, 1, 2);
    layoutLabels([b], 1, 800, 600);
    expect(b.side).toBe(2);
  });
});
