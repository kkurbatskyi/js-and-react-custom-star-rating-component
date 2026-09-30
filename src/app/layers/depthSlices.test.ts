import { describe, expect, it } from 'vitest';
import type { LayerRenderSpec } from '../../engine/contracts';
import { buildSlices, type Interval, MAX_DEPTH_RATIO } from './depthSlices';

const iv = (near: number, far: number): Interval => ({ near, far });

describe('buildSlices', () => {
  it('keeps overlapping objects in one slice', () => {
    const out: LayerRenderSpec[] = [];
    const n = buildSlices([iv(10, 20), iv(15, 40), iv(35, 50)], 3, out);
    expect(n).toBe(1);
    expect(out[0].near).toBeLessThanOrEqual(10);
    expect(out[0].far).toBeGreaterThanOrEqual(50);
  });

  it('splits a moon at 1 km altitude from its giant 10⁶ km away, far → near, contiguous', () => {
    const out: LayerRenderSpec[] = [];
    // Moon: camera 1 km above a 1790 km moon; giant: 70 000 km radius at 1.2e6 km.
    const n = buildSlices([iv(1.2e6 - 7e4, 1.2e6 + 7e4), iv(1, 2 * 1790 + 1)], 2, out);
    expect(n).toBe(2);
    const [far, near] = out;
    expect(near.near).toBeLessThanOrEqual(1);
    expect(near.far).toBe(far.near); // contiguous
    expect(near.far).toBeGreaterThan(3581);
    expect(far.near).toBeLessThan(1.13e6);
    expect(far.far).toBeGreaterThanOrEqual(1.27e6);
    for (const s of out.slice(0, n)) expect(s.far / s.near).toBeLessThan(MAX_DEPTH_RATIO * 2);
  });

  it('extends the outer slices to a cover extent and never goes below the floor', () => {
    const out: LayerRenderSpec[] = [];
    const n = buildSlices([iv(0, 5)], 1, out, iv(0, 1e4));
    expect(n).toBe(1);
    expect(out[0].near).toBeGreaterThan(0);
    expect(out[0].far).toBeGreaterThanOrEqual(1e4);
  });

  it('handles no objects', () => {
    expect(buildSlices([], 0, [])).toBe(0);
    const out: LayerRenderSpec[] = [];
    expect(buildSlices([], 0, out, iv(10, 100))).toBe(1);
    expect(out[0].near).toBeLessThanOrEqual(10);
  });
});
