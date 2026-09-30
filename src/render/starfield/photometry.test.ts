import { describe, expect, it } from 'vitest';
import { KM_PER_AU, KM_PER_PC, SOLAR_ABS_MAG_V } from '../../core/units';
import {
  apparentMagnitude,
  createPointSource,
  fluxFromMagnitude,
  MIN_FLUX,
  pointSource,
  resolutionScale,
  SPRITE,
  spriteGlsl,
  visualLuminositySolar,
} from './photometry';

const PPR = 1158;

describe('photometry: magnitudes', () => {
  it('reproduces the Sun: m = -26.74 at 1 AU, M = 4.83 at 10 pc', () => {
    expect(apparentMagnitude(1, KM_PER_AU)).toBeCloseTo(-26.74, 1);
    expect(apparentMagnitude(1, 10 * KM_PER_PC)).toBeCloseTo(SOLAR_ABS_MAG_V, 6);
  });

  it('round-trips absolute magnitude and V luminosity', () => {
    expect(visualLuminositySolar(SOLAR_ABS_MAG_V)).toBeCloseTo(1, 9);
    expect(visualLuminositySolar(SOLAR_ABS_MAG_V - 5)).toBeCloseTo(100, 6);
  });

  it('flux follows Pogson: 5 magnitudes = 100x', () => {
    expect(fluxFromMagnitude(0)).toBe(1);
    expect(fluxFromMagnitude(-5) / fluxFromMagnitude(0)).toBeCloseTo(100, 9);
  });
});

describe('photometry: pointSource', () => {
  const at = (d: number, out = createPointSource()) => pointSource(1, d, PPR, 1, out);

  it('pins the display mapping: a magnitude-0 star peaks at peak0, the limit star is dim', () => {
    // L_V = 1 at the distance where m = 0.
    const d0 = 10 * KM_PER_PC * 10 ** ((0 - SOLAR_ABS_MAG_V) / 5);
    expect(at(d0).peakHdr).toBeCloseTo(SPRITE.peak0, 3);
    const dLimit = 10 * KM_PER_PC * 10 ** ((SPRITE.limitingMag - SOLAR_ABS_MAG_V) / 5);
    const limit = at(dLimit);
    expect(limit.peakHdr).toBeGreaterThan(0.02);
    expect(limit.peakHdr).toBeLessThan(0.035);
    expect(limit.spikePx).toBe(0);
    // Faint stars never shrink below the sub-pixel-stable core.
    expect(limit.sigmaPx).toBeGreaterThanOrEqual(SPRITE.sigmaMin * 0.8);
  });

  it('is monotonic in distance: farther is dimmer and smaller', () => {
    const a = createPointSource();
    const b = createPointSource();
    let prev: ReturnType<typeof at> | null = null;
    for (let logD = 5; logD <= 15; logD += 0.05) {
      const cur = at(10 ** logD, prev === a ? b : a);
      if (prev) {
        expect(cur.peakHdr).toBeLessThanOrEqual(prev.peakHdr + 1e-12);
        expect(cur.radiusPx).toBeLessThanOrEqual(prev.radiusPx + 1e-9);
        expect(cur.sigmaPx).toBeLessThanOrEqual(prev.sigmaPx + 1e-12);
        expect(cur.spikePx).toBeLessThanOrEqual(prev.spikePx + 1e-9);
        expect(cur.magnitude).toBeGreaterThanOrEqual(prev.magnitude);
      }
      prev = { ...cur };
    }
  });

  it('is continuous: a 1% change in distance never jumps peak, size or spikes', () => {
    let prev = at(1e5);
    for (let d = 1e5; d < 1e15; d *= 1.01) {
      const cur = at(d * 1.01);
      const rel = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y, 1e-9);
      expect(rel(cur.peakHdr, prev.peakHdr)).toBeLessThan(0.03);
      expect(Math.abs(cur.sigmaPx - prev.sigmaPx)).toBeLessThan(0.05);
      expect(Math.abs(cur.haloPx - prev.haloPx)).toBeLessThan(0.5);
      expect(Math.abs(cur.spikePx - prev.spikePx)).toBeLessThan(6);
      expect(Math.abs(cur.radiusPx - prev.radiusPx)).toBeLessThan(8);
      prev = { ...cur };
    }
  });

  it('saturates smoothly at the HDR cap while glare keeps growing to its caps', () => {
    const near = at(1e5); // absurdly bright
    expect(near.peakHdr).toBe(SPRITE.peakMax);
    expect(near.sigmaPx).toBeLessThanOrEqual(SPRITE.sigmaMax * 1.5 + 1e-9);
    expect(near.spikePx).toBeLessThanOrEqual(SPRITE.spikeMax * 1.5 + 1e-9);
  });

  it('scales exposure like flux and resolution like sqrt(ppr)', () => {
    const base = pointSource(1, 1.3e14, PPR, 1); // m ~ 3: below the HDR cap
    const bright = pointSource(1, 1.3e14, PPR, 4);
    expect(bright.peakHdr).toBeCloseTo(base.peakHdr * 4 ** SPRITE.peakExponent, 6);
    expect(resolutionScale(PPR)).toBeCloseTo(1, 6);
    expect(resolutionScale(1e6)).toBe(1.5);
    expect(resolutionScale(1)).toBe(0.8);
  });

  it('exports a GLSL twin built from the same constants', () => {
    expect(MIN_FLUX).toBeCloseTo(10 ** (-0.4 * SPRITE.limitingMag), 12);
    expect(spriteGlsl).toContain('void starSpriteParams(');
    expect(spriteGlsl).toContain('float starPsf(');
    expect(spriteGlsl).toContain(SPRITE.peak0.toFixed(3));
    expect(spriteGlsl).toContain(SPRITE.peakExponent.toFixed(3));
    // ASCII only: WebGL rejects other characters, even in comments.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII range test
    expect(/^[\x00-\x7f]*$/.test(spriteGlsl)).toBe(true);
  });
});
