/**
 * Quality tiers, render-scale caps (docs/ARCHITECTURE.md §8) and the adaptive render scale used by
 * the 'auto' quality setting.
 */
import type { Quality } from '../render/contracts';
import type { QualitySetting } from '../state/contracts';

/** Render-scale cap per tier: the pixel ratio is min(devicePixelRatio, cap). */
export const RENDER_SCALE_CAP: Readonly<Record<Quality, number>> = {
  low: 0.75,
  medium: 1,
  high: 1.5,
  ultra: 2,
};

export function pixelRatioCap(quality: Quality, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, RENDER_SCALE_CAP[quality]);
}

export interface DeviceHints {
  /** `(pointer: coarse)` — phones and tablets. */
  coarsePointer: boolean;
}

/** The concrete tier for a setting: 'auto' starts phones on low and everything else on medium. */
export function resolveQuality(setting: QualitySetting, device: DeviceHints): Quality {
  if (setting !== 'auto') return setting;
  return device.coarsePointer ? 'low' : 'medium';
}

export interface AdaptiveResolutionOptions {
  minScale?: number;
  maxScale?: number;
}

/** Frames longer than this are hitches (tab switch, GC, shader compile) and are ignored. */
const HITCH_MS = 250;
/** EMA weight per frame (~10-frame memory). */
const EMA_ALPHA = 0.1;
/** The refresh-interval estimate may creep up by this fraction per frame (tracks display changes). */
const REFRESH_CREEP = 0.002;
/** Too slow: EMA above this multiple of the refresh interval (< ~77 % of the refresh rate)… */
const SLOW_RATIO = 1.3;
/** …for this long → step down. */
const SLOW_HOLD_MS = 800;
/** Comfortably at the refresh rate: EMA below this multiple… */
const FAST_RATIO = 1.08;
/** …for this long → try a step up. */
const FAST_HOLD_MS = 3000;
const STEP_DOWN = 0.85;
const STEP_UP = 1.12;
/** After any change, measurements settle for this long before the next decision. */
const COOLDOWN_MS = 1000;
/** A step down this soon after a step up means the step up failed: cap below it (no oscillation). */
const FLIP_WINDOW_MS = 5000;
/** The ceiling set by a failed probe is lifted again after this long without a step down. */
const CEILING_RELAX_MS = 30_000;

/**
 * Adaptive render scale: an EMA of the frame interval drives a multiplier in [minScale, maxScale]
 * on the pixel-ratio cap.
 *
 * rAF intervals are quantised to the display refresh, so headroom is invisible: running at the
 * refresh rate says nothing about how much spare time there is. Stepping up is therefore a probe —
 * if the next step down follows within FLIP_WINDOW_MS, the probe failed and the ceiling drops below
 * it, so the scale converges instead of oscillating. The ceiling is lifted after CEILING_RELAX_MS
 * without a step down (the scene may have become cheaper), so a failed probe costs at most a brief
 * dip every half minute. Time is the sum of the intervals fed in (deterministic; unit-tested with a
 * synthetic GPU).
 */
export class AdaptiveResolution {
  scale: number;
  private readonly minScale: number;
  private maxScale: number;
  private ceiling: number;
  private ema = 16.7;
  private refresh = 16.7;
  private slowMs = 0;
  private fastMs = 0;
  private cooldownMs = COOLDOWN_MS;
  private clockMs = 0;
  private lastUpAt = Number.NEGATIVE_INFINITY;
  private lastDownAt = Number.NEGATIVE_INFINITY;
  private scaleBeforeUp = 1;

  constructor(options: AdaptiveResolutionOptions = {}) {
    this.minScale = options.minScale ?? 0.5;
    this.maxScale = options.maxScale ?? 1;
    this.scale = this.maxScale;
    this.ceiling = this.maxScale;
  }

  /** Feed one frame interval (ms). Returns true when `scale` changed. */
  sample(dtMs: number): boolean {
    if (!(dtMs > 0) || dtMs > HITCH_MS) return false;
    this.clockMs += dtMs;
    this.refresh = Math.min(this.refresh * (1 + REFRESH_CREEP), dtMs);
    this.ema += (dtMs - this.ema) * EMA_ALPHA;
    if (this.cooldownMs > 0) {
      this.cooldownMs -= dtMs;
      return false;
    }
    this.slowMs = this.ema > this.refresh * SLOW_RATIO ? this.slowMs + dtMs : 0;
    this.fastMs = this.ema < this.refresh * FAST_RATIO ? this.fastMs + dtMs : 0;

    if (this.slowMs >= SLOW_HOLD_MS && this.scale > this.minScale) {
      this.lastDownAt = this.clockMs;
      if (this.clockMs - this.lastUpAt < FLIP_WINDOW_MS) {
        // The probe failed: go straight back to where it started and cap there.
        this.ceiling = Math.max(this.minScale, this.scaleBeforeUp);
        this.lastUpAt = Number.NEGATIVE_INFINITY;
        return this.apply(this.ceiling);
      }
      return this.apply(Math.max(this.minScale, this.scale * STEP_DOWN));
    }
    if (this.clockMs - this.lastDownAt > CEILING_RELAX_MS) this.ceiling = this.maxScale;
    const ceiling = Math.min(this.ceiling, this.maxScale);
    if (this.fastMs >= FAST_HOLD_MS && this.scale < ceiling) {
      this.scaleBeforeUp = this.scale;
      this.lastUpAt = this.clockMs;
      return this.apply(Math.min(ceiling, this.scale * STEP_UP));
    }
    return false;
  }

  /** Forget history (quality or viewport changed): start again from the top. */
  reset(maxScale: number = this.maxScale): void {
    this.maxScale = maxScale;
    this.ceiling = maxScale;
    this.scale = maxScale;
    this.slowMs = 0;
    this.fastMs = 0;
    this.cooldownMs = COOLDOWN_MS;
    this.lastUpAt = Number.NEGATIVE_INFINITY;
    this.lastDownAt = Number.NEGATIVE_INFINITY;
  }

  private apply(next: number): boolean {
    this.slowMs = 0;
    this.fastMs = 0;
    this.cooldownMs = COOLDOWN_MS;
    if (Math.abs(next - this.scale) < 1e-6) return false;
    this.scale = next;
    return true;
  }
}
