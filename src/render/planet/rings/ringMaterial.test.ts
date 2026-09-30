import { describe, expect, it } from 'vitest';
import type { RingSystem } from '../../../core/types';
import {
  createRingGeometry,
  deriveRingMaterial,
  RING_MESH_MARGIN,
  ringSeedPhase,
  ringUniformVector,
} from './ringMaterial';

const rings: RingSystem = {
  innerRadiusKm: 79_400,
  outerRadiusKm: 144_000,
  composition: 'ice',
  opticalDepth: 1.3,
  seed: 522_752_826,
};

describe('ring material', () => {
  it('is bright for ice, dark for rock and strongly forward scattering for dust', () => {
    const lum = (c: readonly number[]): number => (c[0] ?? 0) + (c[1] ?? 0) + (c[2] ?? 0);
    const ice = deriveRingMaterial({ ...rings, composition: 'ice' });
    const rock = deriveRingMaterial({ ...rings, composition: 'rock' });
    const dust = deriveRingMaterial({ ...rings, composition: 'dust' });
    expect(lum(ice.color)).toBeGreaterThan(lum(rock.color) * 1.5);
    expect(dust.phaseForward).toBeGreaterThan(ice.phaseForward);
    expect(ice.multiScatter).toBeGreaterThan(rock.multiScatter);
  });

  it('shares the seed phase with the planet surface shaders', () => {
    expect(ringSeedPhase(rings)).toBeCloseTo((522_752_826 % 997) / 97, 12);
    expect(ringUniformVector(rings)).toEqual([79_400, 144_000, 1.3, (522_752_826 % 997) / 97]);
  });
});

describe('ring geometry', () => {
  it('is a flat annulus in the XZ plane that covers [inner, outer] with a margin', () => {
    const n = 64;
    const g = createRingGeometry(rings.innerRadiusKm, rings.outerRadiusKm, n);
    const pos = g.getAttribute('position');
    expect(pos.count).toBe(n * 2);
    expect(g.getIndex()?.count).toBe(n * 6);
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBe(0);
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min).toBeCloseTo(rings.innerRadiusKm * (1 - RING_MESH_MARGIN), 0);
    expect(max).toBeCloseTo(rings.outerRadiusKm * (1 + RING_MESH_MARGIN), 0);
    // The polygon's flat edges stay outside the true edges: no clipping of the ring itself.
    const sagitta = Math.cos(Math.PI / n);
    expect(rings.innerRadiusKm * (1 - RING_MESH_MARGIN) * sagitta).toBeLessThan(
      rings.innerRadiusKm,
    );
    expect(rings.outerRadiusKm * (1 + RING_MESH_MARGIN) * sagitta).toBeGreaterThan(
      rings.outerRadiusKm,
    );
    g.dispose();
  });
});
