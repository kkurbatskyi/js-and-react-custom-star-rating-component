import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import type { GalaxyModel } from '../../core/types';
import { createGalaxyModel, createGalaxyModelFromParams } from './model';
import { createGalaxyParams, GALAXY_HOME_DENSITY } from './params';
import { type GalaxyComponent, getGalaxyStructure, integrateDensity, SAMPLE_EXTENT } from './structure';

const SEEDS = [1, 2, 3, 42] as const;
const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2));

/** Values of `f` sampled around the midplane circle through home. */
function ring(m: GalaxyModel, f: (x: number, y: number, z: number) => number, n = 2048): number[] {
  const [hx, , hz] = m.params.homeLy;
  const r = Math.hypot(hx, hz);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    out.push(f(r * Math.cos(t), 0, r * Math.sin(t)));
  }
  return out;
}

describe('createGalaxyModel', () => {
  it('is memoised, deterministic and immutable', () => {
    const m = createGalaxyModel(1);
    expect(createGalaxyModel(1)).toBe(m);
    expect(Object.isFrozen(m.params)).toBe(true);
    expect(Object.isFrozen(m.params.homeLy)).toBe(true);
    const fresh = createGalaxyModelFromParams(createGalaxyParams(1));
    expect(fresh.stellarDensity(1234, 56, -7890)).toBe(m.stellarDensity(1234, 56, -7890));
    const { stellarDensity } = m; // safe to destructure
    expect(stellarDensity(0, 0, 0)).toBeGreaterThan(0);
  });

  it('calibrates the density at home to 0.004 stars/ly³', () => {
    for (const seed of SEEDS) {
      const m = createGalaxyModel(seed);
      const [x, y, z] = m.params.homeLy;
      expect(m.stellarDensity(x, y, z)).toBeCloseTo(GALAXY_HOME_DENSITY, 9);
    }
  });

  it('solar-neighbourhood interarm density is ~0.002 and arms are ≳3× denser', () => {
    for (const seed of SEEDS) {
      const m = createGalaxyModel(seed);
      const d = ring(m, m.stellarDensity);
      const min = Math.min(...d);
      const max = Math.max(...d);
      expect(min).toBeGreaterThan(0.0012);
      expect(min).toBeLessThan(0.004);
      expect(max / min).toBeGreaterThan(2.5);
    }
  });

  it('returns finite, bounded values everywhere', () => {
    const m = createGalaxyModel(42);
    const r = createRng(1);
    const probes: [number, number, number][] = [
      [0, 0, 0],
      [1e-9, 0, 0],
      [0, 5e4, 0],
      [1e8, -1e8, 1e8],
      [-7e4, 300, 7e4],
    ];
    for (let i = 0; i < 5000; i++) probes.push([r.range(-9e4, 9e4), r.normal(0, 3000), r.range(-9e4, 9e4)]);
    for (const [x, y, z] of probes) {
      const rho = m.stellarDensity(x, y, z);
      expect(Number.isFinite(rho)).toBe(true);
      expect(rho).toBeGreaterThanOrEqual(0);
      for (const f of [m.armFactor, m.youngFraction, m.bulgeFraction]) {
        const v = f(x, y, z);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      const dust = m.dustDensity(x, y, z);
      expect(dust).toBeGreaterThanOrEqual(0);
      expect(dust).toBeLessThanOrEqual(1.2);
    }
  });

  it('has a thin disk: sech²-like vertical fall-off', () => {
    const m = createGalaxyModel(2);
    const [x, , z] = m.params.homeLy;
    const hz = m.params.diskScaleHeightLy;
    const mid = m.stellarDensity(x, 0, z);
    expect(m.stellarDensity(x, hz, z) / mid).toBeGreaterThan(0.15);
    expect(m.stellarDensity(x, hz, z) / mid).toBeLessThan(0.6);
    expect(m.stellarDensity(x, -hz, z)).toBeCloseTo(m.stellarDensity(x, hz, z), 12);
    expect(m.stellarDensity(x, 4 * hz, z) / mid).toBeLessThan(0.05);
  });

  it('the bulge dominates the core; home is pure disk', () => {
    for (const seed of SEEDS) {
      const m = createGalaxyModel(seed);
      const [x, y, z] = m.params.homeLy;
      expect(m.bulgeFraction(0, 0, 0)).toBeGreaterThan(0.6);
      expect(m.bulgeFraction(x, y, z)).toBeLessThan(0.01);
      expect(m.armFactor(0, 0, 0)).toBe(0);
    }
  });

  it('young stars trace the arms and hug the midplane', () => {
    const m = createGalaxyModel(3);
    const young = ring(m, m.youngFraction);
    expect(Math.max(...young)).toBeGreaterThan(0.6);
    expect(Math.min(...young)).toBeLessThan(0.15);
    const arm = ring(m, m.armFactor);
    const i = arm.indexOf(Math.max(...arm));
    const [hx, , hz] = m.params.homeLy;
    const r = Math.hypot(hx, hz);
    const t = (i / arm.length) * 2 * Math.PI;
    const [x, z] = [r * Math.cos(t), r * Math.sin(t)];
    expect(m.youngFraction(x, 2000, z)).toBeLessThan(m.youngFraction(x, 0, z) / 2);
  });

  it('dust lanes sit on the concave (inner) side of the arms, in a thin layer', () => {
    for (const seed of SEEDS) {
      const m = createGalaxyModel(seed);
      const s = getGalaxyStructure(m.params);
      const sigma = m.params.armWidthLy * FWHM_TO_SIGMA;
      const [hx, , hz] = m.params.homeLy;
      const r = Math.hypot(hx, hz);
      let inner = 0;
      let nInner = 0;
      let outer = 0;
      let nOuter = 0;
      for (let i = 0; i < 8192; i++) {
        const t = (i / 8192) * 2 * Math.PI;
        const x = r * Math.cos(t);
        const z = r * Math.sin(t);
        const d = s.armOffset(x, z) / sigma;
        if (d > 0.2 && d < 1.2) {
          inner += m.dustDensity(x, 0, z);
          nInner++;
        } else if (d < -0.2 && d > -1.2) {
          outer += m.dustDensity(x, 0, z);
          nOuter++;
        }
      }
      expect(inner / nInner).toBeGreaterThan(1.5 * (outer / nOuter));
      const dustH = m.params.dustScaleHeightLy;
      const dusty = ring(m, m.dustDensity).reduce((a, b) => Math.max(a, b), 0);
      expect(dusty).toBeGreaterThan(0.1);
      expect(m.dustDensity(hx, 4 * dustH, hz)).toBeLessThan(0.01 * dusty);
    }
  });

  it('arms are log spirals: the perpendicular offset grows as R·sin(pitch) along a circle', () => {
    const m = createGalaxyModel(42);
    const s = getGalaxyStructure(m.params);
    const sinP = Math.sin(m.params.armPitchRad);
    const h = 1e-5;
    let checked = 0;
    for (const r of [15_000, 25_000, 35_000]) {
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * 2 * Math.PI;
        const d0 = s.armOffset(r * Math.cos(t), r * Math.sin(t));
        const d1 = s.armOffset(r * Math.cos(t + h), r * Math.sin(t + h));
        if (Math.abs(d1 - d0) > 1000) continue; // skip the half-spacing wrap
        expect((d1 - d0) / h / (r * sinP)).toBeCloseTo(1, 4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('has as many arms as it says (arm crossings along the home circle)', () => {
    for (const seed of SEEDS) {
      const m = createGalaxyModel(seed);
      const s = getGalaxyStructure(m.params);
      // Observable: bumps in armFactor, with hysteresis so flocculence dips inside an arm don't count.
      const a = ring(m, m.armFactor, 4096);
      const start = a.findIndex((v) => v < 0.05);
      let inArm = false;
      let bumps = 0;
      for (let k = 0; k < a.length; k++) {
        const v = a[(start + k) % a.length] as number;
        if (!inArm && v > 0.3) {
          inArm = true;
          bumps++;
        } else if (inArm && v < 0.05) inArm = false;
      }
      expect(bumps).toBe(m.params.armCount);
      // Geometry: the signed ridge offset rises through zero once per arm.
      const [hx, , hz] = m.params.homeLy;
      const r = Math.hypot(hx, hz);
      let zeros = 0;
      let prev = s.armOffset(r, 0);
      for (let i = 1; i <= 4096; i++) {
        const t = (i / 4096) * 2 * Math.PI;
        const d = s.armOffset(r * Math.cos(t), r * Math.sin(t));
        if (prev < 0 && d >= 0) zeros++;
        prev = d;
      }
      expect(zeros).toBe(m.params.armCount);
    }
  });

  it('integrates to its component totals (normalisation cross-check)', () => {
    for (const seed of [1, 42]) {
      const s = getGalaxyStructure(createGalaxyParams(seed));
      const analytic = Object.values(s.componentStars).reduce((a, b) => a + b, 0);
      const numeric = integrateDensity(s.density, 1.25 * s.shape.radiusLy);
      expect(numeric / analytic).toBeGreaterThan(0.97);
      expect(numeric / analytic).toBeLessThan(1.03);
    }
  });
});

describe('samplePosition', () => {
  it('writes into `out` (or allocates) and is deterministic', () => {
    const m = createGalaxyModel(1);
    const out: [number, number, number] = [0, 0, 0];
    expect(m.samplePosition(createRng(5), out)).toBe(out);
    expect(m.samplePosition(createRng(5))).toEqual(out);
  });

  it('keeps ≥ 95 % of the light inside 1.2 × radius', () => {
    for (const seed of SEEDS) {
      const m = createGalaxyModel(seed);
      const rng = createRng(seed);
      const p: [number, number, number] = [0, 0, 0];
      let inside = 0;
      const n = 50_000;
      for (let i = 0; i < n; i++) {
        m.samplePosition(rng, p);
        if (Math.hypot(p[0], p[1], p[2]) <= SAMPLE_EXTENT * m.params.radiusLy) inside++;
      }
      expect(inside / n).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('arm samples really sit on arms; disk samples mostly do not', () => {
    const m = createGalaxyModel(42);
    const s = getGalaxyStructure(m.params);
    const rng = createRng(7);
    const p: [number, number, number] = [0, 0, 0];
    const meanArm = (component: GalaxyComponent) => {
      let sum = 0;
      for (let i = 0; i < 20_000; i++) {
        s.sampleComponent(rng, component, p);
        sum += m.armFactor(p[0], p[1], p[2]);
      }
      return sum / 20_000;
    };
    expect(meanArm('arm')).toBeGreaterThan(0.45);
    expect(meanArm('disk')).toBeLessThan(0.3);
  });

  it('components follow their profiles', () => {
    const m = createGalaxyModel(42);
    const s = getGalaxyStructure(m.params);
    const rng = createRng(8);
    const p: [number, number, number] = [0, 0, 0];
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1] as number;
    const diskY: number[] = [];
    const bulgeR: number[] = [];
    for (let i = 0; i < 20_001; i++) {
      s.sampleComponent(rng, 'disk', p);
      diskY.push(Math.abs(p[1]));
      s.sampleComponent(rng, 'bulge', p);
      bulgeR.push(Math.hypot(p[0], p[2], p[1] / m.params.bulgeFlattening));
    }
    // sech²(y/h): median |y| = h·atanh(½) ≈ 0.549 h (a little more with the thick disk).
    const hz = m.params.diskScaleHeightLy;
    expect(median(diskY) / hz).toBeGreaterThan(0.5);
    expect(median(diskY) / hz).toBeLessThan(0.75);
    // Plummer half-mass radius 1.305 a, a = bulgeRadius / 2 (slightly less after truncation).
    const a = m.params.bulgeRadiusLy / 2;
    expect(median(bulgeR) / a).toBeGreaterThan(1.15);
    expect(median(bulgeR) / a).toBeLessThan(1.35);
    const w = s.componentWeights;
    expect(w.disk + w.arm + w.bulge + w.bar + w.halo).toBeCloseTo(1, 12);
    expect(w.arm).toBeGreaterThan(0.3);
  });

  it('is constructive and fast (no unbounded rejection loops)', () => {
    const m = createGalaxyModel(2);
    const rng = createRng(9);
    const p: [number, number, number] = [0, 0, 0];
    const t0 = performance.now();
    for (let i = 0; i < 200_000; i++) m.samplePosition(rng, p);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('performance', () => {
  it('field functions: 1e6 calls well under a second (target < 300 ms each)', () => {
    const m = createGalaxyModel(42);
    const rng = createRng(10);
    const n = 1_000_000;
    const pts = new Float64Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
      pts[i] = rng.range(-6e4, 6e4);
      pts[i + 1] = rng.normal(0, 1500);
      pts[i + 2] = rng.range(-6e4, 6e4);
    }
    const time = (f: (x: number, y: number, z: number) => number) => {
      let acc = 0;
      for (let i = 0; i < 30_000; i += 3) acc += f(pts[i] as number, pts[i + 1] as number, pts[i + 2] as number);
      const t0 = performance.now();
      for (let i = 0; i < n * 3; i += 3) acc += f(pts[i] as number, pts[i + 1] as number, pts[i + 2] as number);
      expect(Number.isFinite(acc)).toBe(true);
      return performance.now() - t0;
    };
    // 2× headroom over the 300 ms budget: test workers share the CPU.
    expect(time(m.stellarDensity)).toBeLessThan(600);
    expect(time(m.armFactor)).toBeLessThan(600);
    expect(time(m.dustDensity)).toBeLessThan(600);
  });
});
