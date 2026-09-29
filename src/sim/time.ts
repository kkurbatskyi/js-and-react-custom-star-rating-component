/**
 * Simulation clock helpers. `simDays` = days since the J2000 epoch (2000-01-01 12:00 UTC); the
 * app starts at the real current date and advances by `timeScale` sim-seconds per real second.
 */
import { formatTimeScale } from '../core/format';
import {
  DAYS_PER_MONTH,
  J2000_UNIX_MS,
  MS_PER_DAY,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
} from '../core/units';

/** Days since J2000 for a Unix timestamp (default: now). */
export function simDaysNow(nowMs: number = Date.now()): number {
  return (nowMs - J2000_UNIX_MS) / MS_PER_DAY;
}

/** Unix timestamp (ms) of a simulation instant. */
export function simDaysToUnixMs(simDays: number): number {
  return J2000_UNIX_MS + simDays * MS_PER_DAY;
}

/** Advance the clock by `dtRealSec` real seconds at `timeScale` sim-seconds per real second. */
export function advanceSimDays(simDays: number, dtRealSec: number, timeScale: number): number {
  return simDays + (dtRealSec * timeScale) / SECONDS_PER_DAY;
}

/**
 * Phase in [0, 1) of a cycle of `periodDays` at `simDays`, computed in float64 (a negative period
 * runs backwards). Shaders must receive phases/angles like this — never raw simDays, which float32
 * resolves only to ~84 s at today's J2000 offset. Non-finite or zero periods give 0.
 */
export function cyclePhase(simDays: number, periodDays: number): number {
  if (periodDays === 0 || !Number.isFinite(periodDays)) return 0;
  const rev = simDays / periodDays;
  return rev - Math.floor(rev);
}

export interface TimeScalePreset {
  /** Display label, identical to `formatTimeScale(secondsPerSecond)` (uses a no-break space). */
  readonly label: string;
  /** Simulated seconds per real second. */
  readonly secondsPerSecond: number;
}

const PRESET_VALUES: readonly number[] = [
  0, // paused
  1, // real time
  60, // 1 min/s
  3600, // 1 h/s
  SECONDS_PER_DAY, // 1 day/s
  7 * SECONDS_PER_DAY, // 1 week/s
  DAYS_PER_MONTH * SECONDS_PER_DAY, // 1 month/s ≈ 2.63e6
  SECONDS_PER_YEAR, // 1 yr/s ≈ 3.156e7
];

/** Ordered time-scale presets, slowest first (index 0 = paused). */
export const TIME_SCALES: readonly TimeScalePreset[] = Object.freeze(
  PRESET_VALUES.map((secondsPerSecond) =>
    Object.freeze({ label: formatTimeScale(secondsPerSecond), secondsPerSecond }),
  ),
);

/** Index of the preset closest to `secondsPerSecond` (compared logarithmically; ≤ 0 → paused). */
export function nearestTimeScaleIndex(secondsPerSecond: number): number {
  if (!(secondsPerSecond > 0)) return 0;
  const target = Math.log(secondsPerSecond);
  let best = 1;
  let bestErr = Number.POSITIVE_INFINITY;
  for (let i = 1; i < TIME_SCALES.length; i++) {
    const err = Math.abs(Math.log((TIME_SCALES[i] as TimeScalePreset).secondsPerSecond) - target);
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}

/**
 * The next preset faster (`direction` = 1) or slower (−1) than `secondsPerSecond`, clamped to the
 * ends of the list — for "speed up / slow down" controls. Slowing down from real time pauses.
 */
export function stepTimeScale(secondsPerSecond: number, direction: 1 | -1): number {
  if (direction > 0) {
    for (const p of TIME_SCALES)
      if (p.secondsPerSecond > secondsPerSecond * (1 + 1e-9)) return p.secondsPerSecond;
    return (TIME_SCALES[TIME_SCALES.length - 1] as TimeScalePreset).secondsPerSecond;
  }
  for (let i = TIME_SCALES.length - 1; i >= 0; i--) {
    const p = TIME_SCALES[i] as TimeScalePreset;
    if (p.secondsPerSecond < secondsPerSecond * (1 - 1e-9)) return p.secondsPerSecond;
  }
  return 0;
}
