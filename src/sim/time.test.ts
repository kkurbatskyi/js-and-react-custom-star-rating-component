import { describe, expect, it } from 'vitest';
import { formatTimeScale } from '../core/format';
import { J2000_UNIX_MS } from '../core/units';
import {
  advanceSimDays,
  cyclePhase,
  nearestTimeScaleIndex,
  simDaysNow,
  simDaysToUnixMs,
  stepTimeScale,
  TIME_SCALES,
} from './time';

describe('clock', () => {
  it('simDays counts days since J2000', () => {
    expect(simDaysNow(J2000_UNIX_MS)).toBe(0);
    expect(simDaysNow(Date.UTC(2026, 8, 29, 12))).toBe(9768);
    expect(simDaysToUnixMs(simDaysNow(1_790_000_000_000))).toBeCloseTo(1_790_000_000_000, 1);
    const now = simDaysNow();
    expect(now).toBeGreaterThan(9000); // after 2024
  });

  it('advances by timeScale sim-seconds per real second', () => {
    expect(advanceSimDays(10, 2, 43_200)).toBe(11);
    expect(advanceSimDays(10, 1, 0)).toBe(10);
  });

  it('cyclePhase is a float64 phase in [0, 1)', () => {
    expect(cyclePhase(10.25, 1)).toBeCloseTo(0.25, 12);
    expect(cyclePhase(-0.25, 1)).toBeCloseTo(0.75, 12);
    expect(cyclePhase(0.25, -1)).toBeCloseTo(0.75, 12);
    expect(cyclePhase(9768.123, 0)).toBe(0);
    // ~84 s float32 resolution at this offset — but the phase keeps sub-second precision.
    expect(cyclePhase(9768 + 1 / 86_400, 1 / 24) * 3600).toBeCloseTo(1, 6);
  });
});

describe('TIME_SCALES', () => {
  it('lists the presets slowest first with matching labels', () => {
    expect(TIME_SCALES.map((p) => p.label.replace(/ /g, ' '))).toEqual([
      'paused',
      'real time',
      '1 min/s',
      '1 h/s',
      '1 day/s',
      '1 week/s',
      '1 month/s',
      '1 yr/s',
    ]);
    const values = TIME_SCALES.map((p) => p.secondsPerSecond);
    expect(values.slice(0, 6)).toEqual([0, 1, 60, 3600, 86_400, 604_800]);
    expect(values[6]).toBeCloseTo(2.63e6, -4);
    expect(values[7]).toBeCloseTo(3.156e7, -5);
    for (const p of TIME_SCALES) expect(p.label).toBe(formatTimeScale(p.secondsPerSecond));
    expect(Object.isFrozen(TIME_SCALES)).toBe(true);
  });

  it('nearest and step', () => {
    expect(nearestTimeScaleIndex(0)).toBe(0);
    expect(nearestTimeScaleIndex(4000)).toBe(3);
    expect(nearestTimeScaleIndex(1e12)).toBe(TIME_SCALES.length - 1);
    expect(stepTimeScale(1, 1)).toBe(60);
    expect(stepTimeScale(1, -1)).toBe(0);
    expect(stepTimeScale(0, 1)).toBe(1);
    expect(stepTimeScale(5000, -1)).toBe(3600);
    expect(stepTimeScale(5000, 1)).toBe(86_400);
    expect(stepTimeScale(1e12, 1)).toBe(TIME_SCALES[TIME_SCALES.length - 1]?.secondsPerSecond);
    expect(stepTimeScale(0, -1)).toBe(0);
  });
});
