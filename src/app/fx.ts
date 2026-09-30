/**
 * Optional HDR post effects, integrated behind feature checks: the FX modules (travel streaks, lens
 * flare — src/render/fx; gravitational lensing — src/render/star) are developed concurrently, so they
 * are discovered at build time with `import.meta.glob` (an empty match is not an error) and only
 * installed when their factories exist and return postprocessing Effects.
 */
import { Effect } from 'postprocessing';
import type { Vector3 } from 'three';
import type { FrameInfo } from '../engine/contracts';
import { log } from '../core/log';
import type { PostFX } from '../render/post/PostFX';

type Module = Record<string, unknown>;

const FX_MODULES = import.meta.glob<Module>(['../render/fx/*.ts', '!../render/fx/*.test.ts'], {
  eager: true,
});

function findFactory(modules: Record<string, Module>, name: string): (() => unknown) | null {
  for (const mod of Object.values(modules)) {
    const f = mod[name];
    if (typeof f === 'function') return f as () => unknown;
  }
  return null;
}

interface TravelEffectLike extends Effect {
  setIntensity(v: number): void;
  setDirection?(dir: Vector3): void;
}

function isTravelEffect(v: unknown): v is TravelEffectLike {
  return v instanceof Effect && typeof (v as Partial<TravelEffectLike>).setIntensity === 'function';
}

const fxLog = log.child('fx');

export class FxBridge {
  private readonly post: PostFX;
  private travel: TravelEffectLike | null = null;

  constructor(post: PostFX) {
    this.post = post;
    const createTravel = findFactory(FX_MODULES, 'createTravelEffect');
    if (createTravel) {
      try {
        const fx = createTravel();
        if (isTravelEffect(fx)) {
          this.travel = fx;
          post.setHdrEffects([fx], 'pre-bloom');
        }
      } catch (err) {
        fxLog.warn('travel effect unavailable', err);
      }
    }
  }

  update(frame: FrameInfo): void {
    const t = this.travel;
    if (t) {
      t.setIntensity(frame.travel);
      if (frame.travelDirection) t.setDirection?.(frame.travelDirection);
    }
  }

  dispose(): void {
    if (this.travel) {
      this.post.setHdrEffects([], 'pre-bloom');
      this.travel.dispose();
      this.travel = null;
    }
  }
}
