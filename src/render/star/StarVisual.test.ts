import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { blackbodyRGB } from '../../core/color';
import type { StarDetails, StarKind } from '../../core/types';
import { SOLAR_RADIUS_KM } from '../../core/units';
import type { VisualFrame } from '../contracts';
import { lensRampEnd } from './lensing';
import { StarVisual } from './StarVisual';

function star(kind: StarKind, radiusKm: number, extra: Partial<StarDetails> = {}): StarDetails {
  const cls = kind === 'black-hole' ? 'X' : kind === 'neutron-star' ? 'N' : 'G';
  return {
    id: '0.0.0.0.0',
    level: 0,
    cell: [0, 0, 0],
    index: 0,
    posLy: [0, 0, 0],
    seed: 99,
    kind,
    spectralClass: cls,
    spectralType: 'X',
    massSolar: 1,
    radiusSolar: radiusKm / SOLAR_RADIUS_KM,
    luminositySolar: 1,
    temperatureK: kind === 'black-hole' ? 0 : 5772,
    absMag: 4.83,
    colorRGB: blackbodyRGB(5772),
    name: 'T',
    designation: 'T',
    radiusKm,
    ageGyr: 4,
    metallicityFeH: 0,
    rotationPeriodDays: 25,
    activity: 0.3,
    ...extra,
  };
}

function frameFor(camera: PerspectiveCamera): VisualFrame {
  camera.updateMatrixWorld();
  return {
    renderer: null as unknown as VisualFrame['renderer'],
    timeSec: 3,
    dtSec: 0.016,
    simDays: 9800,
    camera,
    width: 960,
    height: 540,
    pixelRatio: 1,
    quality: 'high',
  };
}

describe('StarVisual (no GPU: object graph, uniforms and lens state)', () => {
  const camera = new PerspectiveCamera(50, 960 / 540, 1, 1e13);

  it('builds photosphere, corona and sprite for an ordinary star and updates without NaNs', () => {
    const v = new StarVisual(star('main-sequence', SOLAR_RADIUS_KM), 'high');
    expect(v.object.children.map((c) => c.name)).toEqual(['photosphere', 'corona', 'sprite']);
    for (const d of [1.3 * SOLAR_RADIUS_KM, 4 * SOLAR_RADIUS_KM, 2e8, 6e9]) {
      v.update(frameFor(camera), { positionKm: new Vector3(0, 0, -d), intensity: 1 });
      expect(v.object.visible).toBe(true);
      expect(Number.isFinite(v.object.position.z)).toBe(true);
    }
    // Resolved star: sphere and corona on, sprite off; far away: the reverse (sphere sub-pixel).
    v.update(frameFor(camera), {
      positionKm: new Vector3(0, 0, -3 * SOLAR_RADIUS_KM),
      intensity: 1,
    });
    const [disc, corona, sprite] = v.object.children;
    expect(disc.visible).toBe(true);
    expect(corona.visible).toBe(true);
    expect(sprite.visible).toBe(false);
    v.update(frameFor(camera), { positionKm: new Vector3(0, 0, -6e9), intensity: 1 });
    expect(corona.visible).toBe(false);
    expect(sprite.visible).toBe(true);
    // Fully faded out (hand-off): nothing drawn.
    v.update(frameFor(camera), { positionKm: new Vector3(0, 0, -6e9), intensity: 0 });
    expect(v.object.visible).toBe(false);
    v.dispose();
  });

  it('a black hole replaces the sphere and publishes its lensing state', () => {
    const rs = 1.2e7;
    const v = new StarVisual(star('black-hole', rs, { accretion: 0.8 }), 'high');
    const hole = v.object.children.find((c) => c.name === 'black-hole');
    expect(hole).toBeDefined();
    // Far: on screen, small, lens active with Einstein radius sqrt(2 / D) * ppr.
    const D = 400;
    v.update(frameFor(camera), { positionKm: new Vector3(0, 0, -D * rs), intensity: 1 });
    expect(v.lens.active).toBe(true);
    expect(v.lens.uvX).toBeCloseTo(0.5, 3);
    expect(v.lens.uvY).toBeCloseTo(0.5, 3);
    const ppr = 540 / (2 * Math.tan((50 * Math.PI) / 360));
    expect(v.lens.einsteinRadiusPx).toBeCloseTo(ppr * Math.sqrt(2 / D), 3);
    expect(v.lens.innerRadiusPx).toBeGreaterThan(0);
    expect(v.lens.viewportHeightPx).toBe(540);
    // Very close: the disk fills the view, the hole draws everything itself and the lens stands down.
    v.update(frameFor(camera), { positionKm: new Vector3(0, 0, -8 * rs), intensity: 1 });
    expect(v.lens.active).toBe(false);
    // Behind the camera: inactive.
    v.update(frameFor(camera), { positionKm: new Vector3(0, 0, 400 * rs), intensity: 1 });
    expect(v.lens.active).toBe(false);
    v.dispose();
  });

  it('a neutron star adds beams and a nebula and keeps its sphere; ordinary stars never lens', () => {
    const ns = new StarVisual(star('neutron-star', 12, { pulsarPeriodSec: 0.4 }), 'medium');
    expect(ns.object.children.map((c) => c.name)).toEqual(
      expect.arrayContaining(['photosphere', 'sprite', 'pulsar-beams', 'wind-nebula']),
    );
    ns.update(frameFor(camera), { positionKm: new Vector3(0, 0, -5e7), intensity: 1 });
    expect(ns.lens.active).toBe(false);
    ns.dispose();
    const g = new StarVisual(star('main-sequence', SOLAR_RADIUS_KM), 'low');
    g.update(frameFor(camera), { positionKm: new Vector3(0, 0, -1e9), intensity: 1 });
    expect(g.lens.active).toBe(false);
    g.dispose();
  });
});

describe('lensRampEnd', () => {
  it('keeps the lens remap monotonic (no folded images) for any Einstein radius / inner radius', () => {
    for (const te of [0.01, 0.05, 0.2, 0.6]) {
      for (const inner of [0.005, 0.02, 0.1, 0.3]) {
        const end = lensRampEnd(te, inner);
        expect(end).toBeGreaterThan(inner);
        let prev = Number.NEGATIVE_INFINITY;
        for (let r = inner; r < end * 4; r += (end - inner) / 400) {
          const t = Math.min(1, (r - inner) / (end - inner));
          const w = t * t * (3 - 2 * t);
          const beta = r - (w * te * te) / r; // the effect's remap
          expect(beta).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = beta;
        }
      }
    }
  });
});
