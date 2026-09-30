import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScreenDisc } from '../render/contracts';
import type { LabelSpec, Layer, PickHit } from './contracts';
import { collectLabels, insideAnyDisc, pickLayers } from './picking';

function layer(
  id: string,
  opts: { hit?: PickHit | null; discs?: ScreenDisc[]; labels?: LabelSpec[] },
): Layer {
  return {
    id,
    scene: new Scene(),
    update: () => [],
    pick: () => opts.hit ?? null,
    occluders: (out) => {
      for (const d of opts.discs ?? []) out.push(d);
    },
    labels: (out) => {
      for (const l of opts.labels ?? []) out.push(l);
    },
    dispose() {},
  };
}

const star = (id: string, distPx: number, x?: number, y?: number): PickHit => ({
  ref: { kind: 'star', id },
  distPx,
  x,
  y,
});
const label = (key: string, x: number, y: number): LabelSpec => ({
  key,
  text: key,
  x,
  y,
  priority: 1000,
});

describe('picking', () => {
  it('tests discs inclusively', () => {
    const discs = [{ x: 10, y: 10, radiusPx: 5 }];
    expect(insideAnyDisc(discs, 1, 15, 10)).toBe(true);
    expect(insideAnyDisc(discs, 1, 16, 10)).toBe(false);
    expect(insideAnyDisc(discs, 0, 10, 10)).toBe(false);
  });

  it('prefers the closest hit and breaks ties towards nearer layers', () => {
    const far = layer('far', { hit: star('far', 3) });
    const near = layer('near', { hit: star('near', 3) });
    expect(pickLayers([far, near], [true, true], 0, 0, 10)?.ref.id).toBe('near');
    const closer = layer('closer', { hit: star('closer', 1) });
    expect(pickLayers([closer, near], [true, true], 0, 0, 10)?.ref.id).toBe('closer');
  });

  it('discards farther hits behind nearer occluders', () => {
    const planet = layer('planet', {
      hit: null,
      discs: [{ x: 100, y: 100, radiusPx: 40 }],
    });
    const stars = layer('stars', { hit: star('hidden', 0.5, 110, 95) });
    expect(pickLayers([stars, planet], [true, true], 110, 95, 10)).toBeNull();
    const visible = layer('stars', { hit: star('visible', 0.5, 300, 95) });
    expect(pickLayers([visible, planet], [true, true], 300, 95, 10)?.ref.id).toBe('visible');
    // An inactive layer neither picks nor occludes.
    expect(pickLayers([stars, planet], [true, false], 110, 95, 10)?.ref.id).toBe('hidden');
  });

  it('culls labels of farther layers behind nearer discs', () => {
    const near = layer('near', {
      discs: [{ x: 0, y: 0, radiusPx: 20 }],
      labels: [label('moon', 5, 5)],
    });
    const far = layer('far', { labels: [label('behind', 3, 3), label('beside', 50, 0)] });
    const out: LabelSpec[] = [];
    const n = collectLabels([far, near], [true, true], out, []);
    expect(n).toBe(2);
    expect(out.map((l) => l.key).sort()).toEqual(['beside', 'moon']);
  });
});
