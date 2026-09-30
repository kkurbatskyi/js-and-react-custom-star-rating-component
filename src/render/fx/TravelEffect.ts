/**
 * TravelEffect — hyperspace streaks, gentle chromatic aberration and a vignette pump.
 *
 * A postprocessing `Effect` for the HDR stage (`PostFX.setHdrEffects([fx], 'pre-bloom')`, which is
 * how src/app/fx.ts installs it). The engine drives it every frame:
 *
 *   fx.setIntensity(frame.travel);                 // 0..1: subtle at 0.2, dramatic at 1
 *   fx.setDirection(frame.travelDirection);        // unit vector, VIEW space (x right, y up, −z forward)
 *
 * The direction is turned into the focus of expansion — the screen point the streaks radiate from —
 * using the vertical field of view (default 50°, the engine's; `setFov` if it differs). A zero
 * vector (standing still) leaves the focus where it was; the intensity carries the fade.
 * Backward motion converges the streaks instead of diverging them.
 *
 * Intensity and focus are eased on the CPU (fast attack, slower release) so per-frame jitter in the
 * engine's values never shows; with `deltaTime = 0` (frozen screenshots) they snap.
 */
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import {
  Uniform,
  type Uniform as UniformType,
  Vector2,
  type Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { travelFragmentShader } from './travel.glsl';

const DEFAULT_FOV_Y = (50 * Math.PI) / 180;
/** Ease time constants, seconds. */
const ATTACK_S = 0.1;
const RELEASE_S = 0.3;
const FOCUS_S = 0.2;
/** Focus of expansion is clamped to this many screen-halves from the centre (sideways motion → infinity). */
const MAX_FOCUS_NDC = 4;

/**
 * Focus of expansion in uv (0..1, origin bottom-left) for a motion direction in view space.
 * Forward motion (−z) projects the direction; backward motion projects its reverse and flips
 * `sign` to −1 (the flow converges on that point). Near-sideways motion pushes the focus far off
 * screen along the direction. Returns false (out untouched) for a zero vector.
 */
export function focusOfExpansion(
  dir: { x: number; y: number; z: number },
  fovYRad: number,
  aspect: number,
  out: Vector2,
): { sign: number } | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-4) return null;
  const sign = dir.z <= 0 ? 1 : -1;
  const fx = (dir.x / len) * sign;
  const fy = (dir.y / len) * sign;
  const fz = Math.max(Math.abs(dir.z) / len, 0.05);
  const tanHalf = Math.tan(fovYRad / 2);
  const ndcX = Math.max(-MAX_FOCUS_NDC, Math.min(MAX_FOCUS_NDC, fx / fz / (tanHalf * aspect)));
  const ndcY = Math.max(-MAX_FOCUS_NDC, Math.min(MAX_FOCUS_NDC, fy / fz / tanHalf));
  out.set(0.5 + 0.5 * ndcX, 0.5 + 0.5 * ndcY);
  return { sign };
}

export class TravelEffect extends Effect {
  /** The `{ effect, setIntensity, setDirection }` shape: the effect is its own handle. */
  readonly effect: TravelEffect;
  private readonly uCenter: UniformType<Vector2>;
  private readonly uIntensity: UniformType<number>;
  private readonly uSign: UniformType<number>;
  private target = 0;
  private eased = 0;
  private signTarget = 1;
  private readonly foeTarget = new Vector2(0.5, 0.5);
  private readonly foe = new Vector2(0.5, 0.5);
  private fovY = DEFAULT_FOV_Y;
  private aspectRatio = 16 / 9;

  constructor() {
    const uCenter = new Uniform(new Vector2(0.5, 0.5));
    const uIntensity = new Uniform(0);
    const uSign = new Uniform(1);
    super('TravelEffect', travelFragmentShader, {
      // Samples the input away from its own pixel: must open its own pass (see post/README.md).
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uCenter', uCenter],
        ['uIntensity', uIntensity],
        ['uSign', uSign],
      ]),
    });
    this.uCenter = uCenter;
    this.uIntensity = uIntensity;
    this.uSign = uSign;
    this.effect = this;
  }

  /** 0 = off (the shader copies its input), 1 = full hyperspace. */
  setIntensity(value: number): void {
    this.target = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }

  get intensity(): number {
    return this.target;
  }

  /** Motion direction in view space (x right, y up, −z forward). Zero keeps the previous focus. */
  setDirection(dir: Vector3): void {
    const r = focusOfExpansion(dir, this.fovY, this.aspectRatio, this.foeTarget);
    if (r) this.signTarget = r.sign;
  }

  /** Vertical field of view (radians) used to project the direction. Default 50°. */
  setFov(fovYRad: number): void {
    if (fovYRad > 0.01 && fovYRad < 3) this.fovY = fovYRad;
  }

  override setSize(width: number, height: number): void {
    this.aspectRatio = width / Math.max(1, height);
  }

  override update(_renderer: WebGLRenderer, _input: WebGLRenderTarget, deltaTime = 0): void {
    if (deltaTime > 0) {
      const tau = this.target > this.eased ? ATTACK_S : RELEASE_S;
      this.eased += (this.target - this.eased) * (1 - Math.exp(-deltaTime / tau));
      this.foe.lerp(this.foeTarget, 1 - Math.exp(-deltaTime / FOCUS_S));
    } else {
      this.eased = this.target;
      this.foe.copy(this.foeTarget);
    }
    this.uIntensity.value = this.eased;
    this.uCenter.value.copy(this.foe);
    this.uSign.value = this.signTarget;
  }
}

/** Factory discovered by src/app/fx.ts. */
export function createTravelEffect(): TravelEffect {
  return new TravelEffect();
}
