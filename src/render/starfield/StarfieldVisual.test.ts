import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { StarBlock } from '../../core/types';
import type { StarfieldOptions, VisualFrame } from '../contracts';
import { StarfieldVisual } from './StarfieldVisual';

const W = 800;
const H = 600;

function makeBlock(
  key: string,
  originLy: [number, number, number],
  stars: { off: [number, number, number]; absMag: number; rgb?: [number, number, number] }[],
): StarBlock {
  const count = stars.length;
  const b: StarBlock = {
    key,
    level: 0,
    cell: [0, 0, 0],
    originLy,
    count,
    offsetsLy: new Float32Array(count * 3),
    absMag: new Float32Array(count),
    luminositySolar: new Float32Array(count),
    colorRGB: new Float32Array(count * 3),
    kind: new Uint8Array(count),
  };
  stars.forEach((s, i) => {
    b.offsetsLy.set(s.off, i * 3);
    b.absMag[i] = s.absMag;
    b.colorRGB.set(s.rgb ?? [1, 0.9, 0.8], i * 3);
  });
  return b;
}

function frameFor(camera: PerspectiveCamera): VisualFrame {
  camera.updateMatrixWorld();
  return {
    renderer: null as unknown as VisualFrame['renderer'],
    timeSec: 0,
    dtSec: 0,
    simDays: 0,
    camera,
    width: W,
    height: H,
    pixelRatio: 1,
    quality: 'high',
  };
}

function options(cameraLy: Vector3, extra: Partial<StarfieldOptions> = {}): StarfieldOptions {
  return {
    cameraLy,
    hiddenStarId: null,
    hiddenFade: 0,
    selectedId: null,
    hoveredId: null,
    exposure: 1,
    ...extra,
  };
}

/** Screen position (CSS px) of a camera-relative point, via three's own projection. */
function screenOf(camera: PerspectiveCamera, rel: Vector3): [number, number] {
  const p = rel.clone().project(camera);
  return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H];
}

describe('StarfieldVisual: catalogue table, picking and anchors (CPU side)', () => {
  const camera = new PerspectiveCamera(50, W / H, 1e-6, 1e6);
  const blockA = makeBlock(
    '0.0.0.-1',
    [0, 0, -10],
    [
      { off: [0, 0, 0], absMag: 0 }, // dead ahead, 10 ly: bright
      { off: [2, 0, 0], absMag: 3 }, // to the right: fainter
      { off: [-2, 1, 0], absMag: 20 }, // far too faint to draw
    ],
  );
  const blockB = makeBlock('0.1.0.-1', [50, 0, -10], [{ off: [0, 0, 0], absMag: 1 }]); // off to the side
  const origin = new Vector3(0, 0, 0);

  function fresh(): StarfieldVisual {
    const v = new StarfieldVisual('high');
    v.setBlocks([blockA, blockB], origin);
    v.update(frameFor(camera), options(new Vector3(0, 0, 0)));
    return v;
  }

  it('picks the nearest visible star; ids are block key + index', () => {
    const v = fresh();
    const [x, y] = screenOf(camera, new Vector3(0, 0, -10));
    const hit = v.pick(x + 1.5, y - 1, 12);
    expect(hit?.id).toBe('0.0.0.-1.0');
    expect(hit?.distPx).toBeLessThan(2.5);
    const [x1, y1] = screenOf(camera, new Vector3(2, 0, -10));
    expect(v.pick(x1, y1, 5)?.id).toBe('0.0.0.-1.1');
    v.dispose();
  });

  it('ignores stars fainter than the limiting magnitude and returns null away from stars', () => {
    const v = fresh();
    const [xf, yf] = screenOf(camera, new Vector3(-2, 1, -10));
    expect(v.pick(xf, yf, 6)).toBeNull();
    expect(v.pick(5, 5, 4)).toBeNull();
    v.dispose();
  });

  it('lists anchors brightest first and respects max', () => {
    const v = fresh();
    const a = v.anchors(5);
    expect(a.map((s) => s.id)).toEqual(['0.0.0.-1.0', '0.0.0.-1.1']);
    expect(a[0].priority).toBeGreaterThan(a[1].priority);
    expect(v.anchors(1)).toHaveLength(1);
    expect(v.anchors(0)).toEqual([]);
    v.dispose();
  });

  it('drops the hidden star from picks and anchors once its fade passes one half', () => {
    const v = new StarfieldVisual('high');
    v.setBlocks([blockA, blockB], origin);
    v.update(
      frameFor(camera),
      options(new Vector3(0, 0, 0), { hiddenStarId: '0.0.0.-1.0', hiddenFade: 0.9 }),
    );
    const [x, y] = screenOf(camera, new Vector3(0, 0, -10));
    expect(v.pick(x, y, 6)).toBeNull();
    expect(v.anchors(5).map((s) => s.id)).toEqual(['0.0.0.-1.1']);
    v.dispose();
  });

  it('keeps float64 precision when the rebase origin and the camera are far from the galactic centre', () => {
    // A home-like position ~26 kly from the centre: float32 alone would lose ~2e-3 ly here.
    const far = new Vector3(26000.123456, 12.25, -3000.987654);
    const b = makeBlock(
      '0.812.0.-94',
      [far.x, far.y, far.z - 10],
      [{ off: [0.0625, -0.03125, 0], absMag: 0 }],
    );
    const v = new StarfieldVisual('high');
    v.setBlocks([b], far);
    v.update(frameFor(camera), options(far));
    const expected = screenOf(camera, new Vector3(0.0625, -0.03125, -10));
    const hit = v.pick(expected[0], expected[1], 3);
    expect(hit?.id).toBe('0.812.0.-94.0');
    expect(hit?.distPx).toBeLessThan(0.05);
    // Moving the camera a little must move the star on screen by the exact parallax.
    v.update(frameFor(camera), options(new Vector3(far.x + 1, far.y, far.z)));
    const moved = screenOf(camera, new Vector3(0.0625 - 1, -0.03125, -10));
    expect(v.pick(moved[0], moved[1], 3)?.distPx).toBeLessThan(0.05);
    v.dispose();
  });

  it('reuses buffer capacity and reports every star exactly once after growing', () => {
    const v = new StarfieldVisual('high');
    const many = makeBlock(
      '0.0.0.-2',
      [0, 0, -20],
      Array.from({ length: 3000 }, (_, i) => ({
        off: [((i % 60) - 30) * 0.05, (Math.floor(i / 60) - 25) * 0.05, 0] as [
          number,
          number,
          number,
        ],
        absMag: -2,
      })),
    );
    v.setBlocks([many], origin);
    v.update(frameFor(camera), options(new Vector3(0, 0, 0)));
    const positions = v.object.geometry.getAttribute('iPos');
    expect(positions.count).toBeGreaterThanOrEqual(3000);
    expect(v.object.geometry.instanceCount).toBe(3000);
    v.setBlocks([blockA], origin); // shrinks: same buffers, smaller instance count
    expect(v.object.geometry.instanceCount).toBe(3);
    expect(v.object.geometry.getAttribute('iPos')).toBe(positions);
    v.dispose();
  });
});
