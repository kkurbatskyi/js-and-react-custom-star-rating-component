import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, pixelRatioCap, resolveQuality } from './quality';

const VSYNC = 1000 / 60;

/** A GPU whose frame cost grows with pixel count (∝ scale²), presented on a 60 Hz display. */
function simulate(costAtFull: number, seconds: number, ar = new AdaptiveResolution()) {
  const changes: { t: number; scale: number }[] = [];
  let t = 0;
  while (t < seconds * 1000) {
    const gpu = 2 + costAtFull * ar.scale * ar.scale;
    const dt = Math.ceil(gpu / VSYNC - 1e-9) * VSYNC;
    t += dt;
    if (ar.sample(dt)) changes.push({ t, scale: ar.scale });
  }
  return { ar, changes };
}

describe('quality', () => {
  it('caps the pixel ratio per tier', () => {
    expect(pixelRatioCap('low', 3)).toBe(0.75);
    expect(pixelRatioCap('high', 2)).toBe(1.5);
    expect(pixelRatioCap('ultra', 1)).toBe(1);
    expect(pixelRatioCap('medium', Number.NaN)).toBe(1);
  });

  it('resolves auto by device', () => {
    expect(resolveQuality('auto', { coarsePointer: true })).toBe('low');
    expect(resolveQuality('auto', { coarsePointer: false })).toBe('medium');
    expect(resolveQuality('ultra', { coarsePointer: true })).toBe('ultra');
  });
});

describe('AdaptiveResolution', () => {
  it('keeps full scale on a fast GPU', () => {
    const { ar, changes } = simulate(8, 30);
    expect(ar.scale).toBe(1);
    expect(changes).toEqual([]);
  });

  it('steps down on a slow GPU and settles without oscillating', () => {
    const { ar, changes } = simulate(30, 60);
    expect(ar.scale).toBeLessThan(0.8);
    expect(ar.scale).toBeGreaterThanOrEqual(0.5);
    // Converged: after the first 15 s only the occasional (≥ 30 s apart) failed probe remains.
    const late = changes.filter((c) => c.t > 15_000);
    expect(late.length).toBeLessThanOrEqual(4);
    for (let i = 2; i < late.length; i++) expect(late[i].t - late[i - 2].t).toBeGreaterThan(25_000);
    // Final state renders at the refresh rate.
    expect(2 + 30 * ar.scale * ar.scale).toBeLessThanOrEqual(VSYNC);
  });

  it('never goes below the minimum', () => {
    const { ar } = simulate(200, 30);
    expect(ar.scale).toBe(0.5);
  });

  it('ignores hitches', () => {
    const ar = new AdaptiveResolution();
    for (let i = 0; i < 100; i++) expect(ar.sample(i % 10 === 0 ? 900 : VSYNC)).toBe(false);
    expect(ar.scale).toBe(1);
  });

  it('recovers when the load drops', () => {
    const ar = new AdaptiveResolution();
    simulate(30, 20, ar);
    const low = ar.scale;
    simulate(4, 60, ar);
    expect(ar.scale).toBeGreaterThan(low);
  });
});
