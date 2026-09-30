/**
 * The engine's clocks: an animation clock (real seconds since start, drives shaders) and the
 * simulation clock `simDays` (days since J2000, drives orbits and spin), plus the debug freeze used
 * for deterministic screenshots. float64 throughout; shaders only ever see phases (src/sim/time.ts).
 */
import { advanceSimDays } from '../sim/time';

export class SimClock {
  /** Real seconds since start (animation clock). */
  timeSec = 0;
  simDays: number;
  /** Simulated seconds per real second. */
  timeScale: number;
  paused = false;
  /** Debug: stop every clock (animation, simulation, flights) for reproducible frames. */
  frozen = false;

  constructor(simDays: number, timeScale = 3600) {
    this.simDays = simDays;
    this.timeScale = timeScale;
  }

  /** Advance by a real interval; returns the dt the frame should use (0 while frozen). */
  advance(dtSec: number): number {
    if (this.frozen || !(dtSec > 0)) return 0;
    this.timeSec += dtSec;
    if (!this.paused) this.simDays = advanceSimDays(this.simDays, dtSec, this.timeScale);
    return dtSec;
  }

  setSimDays(simDays: number): void {
    if (Number.isFinite(simDays)) this.simDays = simDays;
  }
}
