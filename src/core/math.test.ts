import { describe, expect, it } from 'vitest';
import {
  clamp,
  degToRad,
  fract,
  gammaSample,
  invLerp,
  lerp,
  logGamma,
  logLerp,
  mod,
  poissonSample,
  radToDeg,
  remap,
  remapClamped,
  sampleExponential,
  sampleLogistic,
  sampleLogNormal,
  samplePowerLaw,
  sampleUnitVector,
  saturate,
  smootherstep,
  smoothstep,
  TAU,
  uniformOpen,
  wrapAngle,
  wrapAnglePositive,
} from './math';
import { createRng } from './rng';

function moments(n: number, draw: () => number): { mean: number; variance: number } {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = draw();
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  return { mean, variance: sumSq / n - mean * mean };
}

describe('scalar helpers', () => {
  it('clamp / saturate / lerp / invLerp / remap', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(saturate(1.5)).toBe(1);
    expect(saturate(-0.5)).toBe(0);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(invLerp(10, 20, 12.5)).toBe(0.25);
    expect(invLerp(3, 3, 7)).toBe(0);
    expect(remap(5, 0, 10, 100, 200)).toBe(150);
    expect(remap(20, 0, 10, 100, 200)).toBe(300);
    expect(remapClamped(20, 0, 10, 100, 200)).toBe(200);
  });

  it('smoothstep / smootherstep follow GLSL semantics', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(1, 0, 0.25)).toBeCloseTo(1 - smoothstep(0, 1, 0.25), 12); // falling edge
    expect(smoothstep(2, 2, 1)).toBe(0);
    expect(smoothstep(2, 2, 3)).toBe(1);
    expect(smootherstep(0, 1, 0.5)).toBe(0.5);
    expect(smootherstep(0, 1, 0.1)).toBeLessThan(smoothstep(0, 1, 0.1));
  });

  it('logLerp interpolates geometrically', () => {
    expect(logLerp(1, 100, 0.5)).toBeCloseTo(10, 12);
    expect(logLerp(1e3, 1e9, 0)).toBe(1e3);
    expect(logLerp(1e3, 1e9, 1)).toBeCloseTo(1e9, 3);
  });

  it('fract / mod are always non-negative', () => {
    expect(fract(2.25)).toBeCloseTo(0.25, 12);
    expect(fract(-0.25)).toBeCloseTo(0.75, 12);
    expect(mod(-1, 5)).toBe(4);
    expect(mod(7, 5)).toBe(2);
  });

  it('angles', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 15);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 12);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 15);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 15); // (−π, π]
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(TAU + 0.5)).toBeCloseTo(0.5, 12);
    expect(wrapAngle(-TAU - 0.5)).toBeCloseTo(-0.5, 12);
    for (let a = -50; a < 50; a += 0.37) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
      const p = wrapAnglePositive(a);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(TAU);
    }
  });

  it('logGamma matches known values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 12);
    expect(logGamma(2)).toBeCloseTo(0, 12);
    expect(logGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 12);
    expect(logGamma(10)).toBeCloseTo(Math.log(362880), 10);
    expect(logGamma(0.25)).toBeCloseTo(Math.log(3.625609908221908), 10);
    // Stirling check at large argument: ln Γ(1001) = ln 1000!
    let lnFact = 0;
    for (let k = 2; k <= 1000; k++) lnFact += Math.log(k);
    expect(logGamma(1001)).toBeCloseTo(lnFact, 7);
  });
});

describe('random variates', () => {
  it('uniformOpen never returns 0 or 1', () => {
    const r = createRng(1);
    for (let i = 0; i < 10_000; i++) {
      const u = uniformOpen(r);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('gammaSample has mean kθ and variance kθ²', () => {
    const r = createRng(2);
    for (const [k, theta] of [
      [0.5, 2],
      [2, 1000],
      [9, 0.5],
    ] as const) {
      const { mean, variance } = moments(60_000, () => gammaSample(r, k, theta));
      expect(mean / (k * theta)).toBeCloseTo(1, 1);
      expect(variance / (k * theta * theta)).toBeCloseTo(1, 1);
    }
    expect(gammaSample(r, 0)).toBe(0);
    expect(gammaSample(r, -1)).toBe(0);
  });

  it('poissonSample has mean and variance λ across both algorithms', () => {
    const r = createRng(3);
    for (const lambda of [0.3, 3, 9.9, 10, 42, 1000, 1e5]) {
      const n = 40_000;
      const { mean, variance } = moments(n, () => {
        const k = poissonSample(r, lambda);
        if (!Number.isInteger(k) || k < 0) throw new Error(`bad Poisson draw ${k}`);
        return k;
      });
      const se = Math.sqrt(lambda / n);
      expect(Math.abs(mean - lambda)).toBeLessThan(5 * se);
      expect(variance / lambda).toBeGreaterThan(0.93);
      expect(variance / lambda).toBeLessThan(1.07);
    }
    expect(poissonSample(r, 0)).toBe(0);
    expect(poissonSample(r, Number.NaN)).toBe(0);
  });

  it('poissonSample matches the exact pmf for small λ', () => {
    const r = createRng(4);
    const lambda = 2.5;
    const n = 100_000;
    const counts = new Array<number>(20).fill(0);
    for (let i = 0; i < n; i++) {
      const k = Math.min(19, poissonSample(r, lambda));
      counts[k] = (counts[k] ?? 0) + 1;
    }
    let p = Math.exp(-lambda);
    for (let k = 0; k < 8; k++) {
      expect((counts[k] ?? 0) / n).toBeCloseTo(p, 2);
      p *= lambda / (k + 1);
    }
  });

  it('poissonSample is fast for large λ (sector star counts)', () => {
    const r = createRng(5);
    let acc = 0;
    const t0 = performance.now();
    for (let i = 0; i < 1e6; i++) acc += poissonSample(r, 500);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(acc / 1e6).toBeCloseTo(500, 0);
  });

  it('exponential, logistic, log-normal', () => {
    const r = createRng(6);
    expect(moments(50_000, () => sampleExponential(r, 3)).mean).toBeCloseTo(3, 1);
    const logistic = moments(50_000, () => sampleLogistic(r, 1, 2));
    expect(logistic.mean).toBeCloseTo(1, 1);
    expect(logistic.variance / ((4 * Math.PI ** 2) / 3)).toBeCloseTo(1, 1);
    const ln = moments(50_000, () => Math.log(sampleLogNormal(r, 0.5, 0.25)));
    expect(ln.mean).toBeCloseTo(0.5, 2);
  });

  it('samplePowerLaw respects bounds and the analytic median', () => {
    const r = createRng(7);
    const xs: number[] = [];
    for (let i = 0; i < 20_001; i++) {
      const x = samplePowerLaw(r, 2.35, 0.5, 100);
      expect(x).toBeGreaterThanOrEqual(0.5);
      expect(x).toBeLessThanOrEqual(100);
      xs.push(x);
    }
    xs.sort((a, b) => a - b);
    const k = 1 - 2.35;
    const median = (0.5 * (0.5 ** k + 100 ** k)) ** (1 / k);
    expect((xs[10_000] as number) / median).toBeCloseTo(1, 1);
    // α = 1: log-uniform.
    const y = samplePowerLaw(r, 1, 1, 1e6);
    expect(y).toBeGreaterThanOrEqual(1);
    expect(y).toBeLessThanOrEqual(1e6);
  });

  it('sampleUnitVector is unit length and isotropic', () => {
    const r = createRng(8);
    const out: [number, number, number] = [0, 0, 0];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < 20_000; i++) {
      expect(sampleUnitVector(r, out)).toBe(out);
      expect(Math.hypot(...out)).toBeCloseTo(1, 12);
      sx += out[0];
      sy += out[1];
      sz += out[2];
    }
    expect(Math.abs(sx / 20_000)).toBeLessThan(0.02);
    expect(Math.abs(sy / 20_000)).toBeLessThan(0.02);
    expect(Math.abs(sz / 20_000)).toBeLessThan(0.02);
  });
});
