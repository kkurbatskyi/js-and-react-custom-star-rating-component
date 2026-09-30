/**
 * LensFlareEffect — a tasteful, physically inspired flare for bright on-screen stars: veiling
 * glare, starburst, ghosts along the optical axis and a dispersed halo (see lensFlare.glsl.ts).
 *
 * A postprocessing `Effect` for the HDR stage AFTER bloom, before tone mapping:
 *
 *   const flare = createLensFlareEffect();
 *   post.setHdrEffects([flare], 'post-bloom');
 *   // every frame:
 *   flare.setSources([{ uv: { x: sun.x / width, y: 1 - sun.y / height },   // uv: origin bottom-left
 *                       color: sunColor,                                    // linear tint (THREE.Color ok)
 *                       intensity: sun.visibility }]);                      // 0..1 (higher = brighter star)
 *
 * Up to four sources (the brightest ones); an empty list switches the flare off. Sources fade out
 * by themselves as they approach the screen edge. It reads only its own pixel, so it merges into
 * whatever pass it lands in.
 */
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector3, Vector4 } from 'three';
import { lensFlareFragmentShader } from './lensFlare.glsl';

/** Sources drawn at once (must match FLARE_MAX_SOURCES in the shader). */
export const MAX_FLARE_SOURCES = 4;

export interface FlareSource {
  /** Screen position, uv (0..1, origin bottom-left). Off-screen values are fine; they fade out. */
  uv: { x: number; y: number };
  /** Linear tint (normalised brightness); THREE.Color and {r,g,b} both work. */
  color: { r: number; g: number; b: number };
  /** ~0..1: the strength of the flare (0 = none). Bright supergiants may exceed 1. */
  intensity: number;
}

export class LensFlareEffect extends Effect {
  /** The `{ effect, setSources }` shape: the effect is its own handle. */
  readonly effect: LensFlareEffect;
  private readonly src: Vector4[];
  private readonly col: Vector3[];
  private readonly gain: Uniform<number>;
  private readonly anamorphicUniform: Uniform<number>;

  constructor() {
    const src = Array.from({ length: MAX_FLARE_SOURCES }, () => new Vector4(0.5, 0.5, 0, 0));
    const col = Array.from({ length: MAX_FLARE_SOURCES }, () => new Vector3(1, 1, 1));
    const gain = new Uniform(1);
    const anamorphic = new Uniform(0.6);
    super('LensFlareEffect', lensFlareFragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uSrc', new Uniform(src)],
        ['uCol', new Uniform(col)],
        ['uGain', gain],
        ['uAnamorphic', anamorphic],
      ]),
    });
    this.src = src;
    this.col = col;
    this.gain = gain;
    this.anamorphicUniform = anamorphic;
    this.effect = this;
  }

  /** Replaces the sources. Allocation-free; extra sources beyond `MAX_FLARE_SOURCES` are ignored. */
  setSources(sources: readonly FlareSource[]): void {
    const n = Math.min(sources.length, MAX_FLARE_SOURCES);
    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      const s = i < n ? sources[i] : undefined;
      const v = this.src[i] as Vector4;
      if (s && s.intensity > 0 && Number.isFinite(s.uv.x) && Number.isFinite(s.uv.y)) {
        v.set(s.uv.x, s.uv.y, s.intensity, 0);
        (this.col[i] as Vector3).set(s.color.r, s.color.g, s.color.b);
      } else {
        v.z = 0;
      }
    }
  }

  /** Overall strength multiplier (default 1). */
  get strength(): number {
    return this.gain.value;
  }

  set strength(value: number) {
    this.gain.value = Math.max(0, value);
  }

  /** Strength of the faint horizontal anamorphic streak, 0..1 (default 0.6). */
  get anamorphic(): number {
    return this.anamorphicUniform.value;
  }

  set anamorphic(value: number) {
    this.anamorphicUniform.value = Math.max(0, value);
  }
}

/** Factory discovered by the app's FX bridge. */
export function createLensFlareEffect(): LensFlareEffect {
  return new LensFlareEffect();
}
