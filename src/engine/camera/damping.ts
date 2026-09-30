/**
 * Frame-rate independent exponential smoothing. `λ` (1/s) is the convergence rate: after t seconds
 * the remaining error is e^(−λt), whatever the frame rate — so the camera feels the same at 30, 60 or
 * 144 Hz and never overshoots (critically damped first-order response).
 */
import { TAU } from '../../core/math';

/** Blend weight for one step: 1 − e^(−λ·dt). */
export function dampFactor(lambda: number, dtSec: number): number {
  return 1 - Math.exp(-lambda * Math.max(0, dtSec));
}

export function damp(current: number, target: number, lambda: number, dtSec: number): number {
  return current + (target - current) * dampFactor(lambda, dtSec);
}

/** Wrap `target` into (current − π, current + π] so an angle damps the short way round. */
export function nearestAngle(current: number, target: number): number {
  let d = (target - current) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return current + d;
}
