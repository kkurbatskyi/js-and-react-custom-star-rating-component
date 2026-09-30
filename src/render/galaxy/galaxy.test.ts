import { describe, expect, it } from 'vitest';
import { createGalaxyModel } from '../../gen/galaxy/model';
import { createGalaxyParams } from '../../gen/galaxy/params';
import {
  GALAXY_COMPONENTS,
  getGalaxyStructure,
  HOME_RADIUS_FRACTION,
} from '../../gen/galaxy/structure';
import {
  calibrate,
  compressLight,
  diskRadial,
  faceOnLightColumn,
  maxLaneDust,
  populationColorInto,
} from './calibration';
import { GalaxyVisual } from './GalaxyVisual';
import { tileableNoise3D } from './noiseVolume';
import {
  DEFAULT_PARTICLE_OPTIONS,
  generateGalaxyParticles,
  PARTICLE_KIND,
  type ParticleOptions,
} from './particles';
import { GALAXY_QUALITY } from './settings';

const SEED = 20260929;
const structure = getGalaxyStructure(createGalaxyParams(SEED));
const luminance = (c: ArrayLike<number>, o = 0): number =>
  0.2126 * (c[o] as number) + 0.7152 * (c[o + 1] as number) + 0.0722 * (c[o + 2] as number);

describe('calibration', () => {
  it('normalises face-on brightness and lane optical depth', () => {
    const cal = calibrate(structure, 0.1, 2.5, 500);
    expect(cal.emission * faceOnLightColumn(structure)).toBeCloseTo(0.1, 12);
    expect(cal.dustKappa * maxLaneDust(structure) * 2 * 500).toBeCloseTo(2.5, 12);
    let light = 0;
    for (const c of GALAXY_COMPONENTS) {
      light += structure.componentStars[c] * structure.gpu.lightPerStar[c];
    }
    expect(cal.totalLight).toBeCloseTo(light, 0);
    expect(cal.ridgeLight).toBeGreaterThan(0);
  });

  it('has a sane radial profile and highlight compression', () => {
    expect(diskRadial(structure, 0)).toBeCloseTo(1, 3);
    const home = HOME_RADIUS_FRACTION * structure.gpu.radiusLy;
    expect(diskRadial(structure, home)).toBeLessThan(diskRadial(structure, home / 2));
    expect(compressLight(0.5, 1, 0.4)).toBe(1);
    expect(compressLight(1, 1, 0.4)).toBe(1);
    expect(compressLight(1e-9 + 1, 1, 0.4)).toBeCloseTo(1, 6); // continuous at the knee
    expect(compressLight(10, 1, 0.4) * 10).toBeCloseTo(10 ** 0.4, 12); // knee·(j/knee)^γ
  });

  it('gives unit-luminance population colours, hot ones bluer', () => {
    const hot = [0, 0, 0];
    const cool = [0, 0, 0];
    populationColorInto(15_000, 1.5, hot);
    populationColorInto(4000, 1.5, cool);
    expect(luminance(hot)).toBeCloseTo(1, 6);
    expect(luminance(cool)).toBeCloseTo(1, 6);
    expect((hot[2] as number) / (hot[0] as number)).toBeGreaterThan(1);
    expect((cool[2] as number) / (cool[0] as number)).toBeLessThan(0.5);
  });
});

describe('generateGalaxyParticles', () => {
  const linear: ParticleOptions = { ...DEFAULT_PARTICLE_OPTIONS };
  const data = generateGalaxyParticles(structure, 20_000, linear);

  it('is deterministic and finite', () => {
    const again = generateGalaxyParticles(structure, 20_000, linear);
    expect(again.positions).toEqual(data.positions);
    expect(again.radiance).toEqual(data.radiance);
    for (const a of [data.positions, data.radiance, data.sigma]) {
      for (const v of a) expect(Number.isFinite(v)).toBe(true);
    }
    for (const v of data.radiance) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('splits the budget between kinds and conserves each kind’s light', () => {
    const counts = [0, 0, 0];
    const flux = [0, 0, 0];
    for (let i = 0; i < data.count; i++) {
      const k = data.kind[i] as number;
      counts[k] = (counts[k] as number) + 1;
      const s = data.sigma[i] as number;
      flux[k] = (flux[k] as number) + luminance(data.radiance, i * 3) * 2 * Math.PI * s * s;
    }
    expect(counts[PARTICLE_KIND.cluster]).toBe(Math.floor(20_000 * linear.clusterFraction));
    expect(counts[PARTICLE_KIND.hii]).toBe(Math.floor(20_000 * linear.hiiFraction));
    const g = structure.gpu;
    let budget = 0;
    for (const c of GALAXY_COMPONENTS) {
      budget += structure.componentStars[c] * g.lightPerStar[c] * linear.share[c];
    }
    const armLight = structure.componentStars.arm * g.lightPerStar.arm;
    expect((flux[0] as number) / budget).toBeCloseTo(1, 4);
    expect((flux[1] as number) / (linear.clusterLight * armLight)).toBeCloseTo(1, 4);
    expect((flux[2] as number) / (linear.hiiLight * armLight)).toBeCloseTo(1, 4);
  });

  it('beads HII knots along the arms', () => {
    let fieldArm = 0;
    let hiiArm = 0;
    let nField = 0;
    let nHii = 0;
    for (let i = 0; i < data.count; i++) {
      const a = structure.armFactor(
        data.positions[i * 3] as number,
        0,
        data.positions[i * 3 + 2] as number,
      );
      if (data.kind[i] === PARTICLE_KIND.hii) {
        hiiArm += a;
        nHii++;
      } else if (data.kind[i] === PARTICLE_KIND.field) {
        fieldArm += a;
        nField++;
      }
    }
    expect(hiiArm / nHii).toBeGreaterThan(0.5);
    expect(hiiArm / nHii).toBeGreaterThan(fieldArm / nField + 0.1); // field light is arm-heavy too
  });

  it('compresses highlights only above the knee', () => {
    const knee = 5 * structure.light(0, 0, 0); // above everything: no change
    const same = generateGalaxyParticles(structure, 5000, {
      ...linear,
      kneeLight: knee,
      kneeGamma: 0.4,
    });
    const base = generateGalaxyParticles(structure, 5000, linear);
    expect(same.radiance).toEqual(base.radiance);
    const squeezed = generateGalaxyParticles(structure, 5000, {
      ...linear,
      kneeLight: 0.01 * structure.light(0, 0, 0),
      kneeGamma: 0.4,
    });
    let a = 0;
    let b = 0;
    for (let i = 0; i < base.count; i++) {
      a += luminance(base.radiance, i * 3);
      b += luminance(squeezed.radiance, i * 3);
    }
    expect(b).toBeLessThan(a);
  });
});

describe('tileableNoise3D', () => {
  it('fills 0..255 and wraps seamlessly', () => {
    const n = 32;
    const v = tileableNoise3D(n, 7);
    expect(v.length).toBe(n ** 3);
    expect(Math.min(...v)).toBe(0);
    expect(Math.max(...v)).toBe(255);
    // Differences across the wrap seam are no larger than interior neighbour differences.
    let seam = 0;
    let interior = 0;
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        const row = (z * n + y) * n;
        seam = Math.max(seam, Math.abs((v[row + n - 1] as number) - (v[row] as number)));
        interior = Math.max(interior, Math.abs((v[row + 1] as number) - (v[row] as number)));
      }
    }
    expect(seam).toBeLessThanOrEqual(interior + 1);
  });
});

describe('quality profiles', () => {
  it('follow ARCHITECTURE §8 particle budgets and grow with quality', () => {
    expect(GALAXY_QUALITY.low.particles).toBe(80_000);
    expect(GALAXY_QUALITY.medium.particles).toBe(150_000);
    expect(GALAXY_QUALITY.high.particles).toBe(300_000);
    expect(GALAXY_QUALITY.ultra.particles).toBe(500_000);
    const order = [GALAXY_QUALITY.low, GALAXY_QUALITY.medium, GALAXY_QUALITY.high];
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [order[i - 1], order[i]];
      expect(b?.volumeSteps).toBeGreaterThan(a?.volumeSteps ?? 0);
      expect(b?.volumeScale).toBeGreaterThanOrEqual(a?.volumeScale ?? 0);
    }
  });
});

describe('GalaxyVisual', () => {
  const model = createGalaxyModel(SEED);
  const visual = new GalaxyVisual(model, 'low');

  it('suggests exposures: brighter inside the disk, darker just above it, 1 far away', () => {
    const [hx, , hz] = model.params.homeLy;
    const inside = visual.exposureHint({ x: hx, y: 0, z: hz });
    const above = visual.exposureHint({ x: hx, y: 5000, z: hz });
    const far = visual.exposureHint({ x: 90_000, y: 63_000, z: 0 });
    expect(inside).toBeCloseTo(visual.look.insideExposure, 6);
    expect(above).toBeCloseTo(visual.look.aboveExposure, 6);
    expect(far).toBeCloseTo(1, 6);
  });

  it('builds its scene graph and disposes cleanly', () => {
    expect(visual.object.children.length).toBe(2);
    expect(() => visual.dispose()).not.toThrow();
  });
});
