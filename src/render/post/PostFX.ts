import {
  BlendFunction,
  BloomEffect,
  type Effect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  type Pass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { HalfFloatType, NoToneMapping, SRGBColorSpace, type WebGLRenderer } from 'three';
import type { Quality } from '../contracts';
import { FilmGrainEffect } from './FilmGrainEffect';
import { effectTraits, planPasses } from './passPlan';

/**
 * Sidereal's HDR post-processing pipeline, shared by the engine and every dev page.
 *
 * ```
 * scene pass (HDR, RGBA16F) ─▶ [pre-bloom HDR effects] ─▶ bloom ─▶ [post-bloom HDR effects]
 *   ─▶ ACES filmic tone map ─▶ SMAA (FXAA on low) ─▶ vignette ─▶ film grain ─▶ sRGB + dither
 * ```
 *
 * Conventions it establishes (docs/ARCHITECTURE.md §5): the renderer does NO tone mapping
 * (`NoToneMapping`) and outputs sRGB; materials write scene-linear HDR (`toneMapped: false`);
 * 1.0 ≈ diffuse white under a normalised sun, and the bloom threshold sits just above it.
 *
 * Ownership: PostFX disposes only what it creates. The scene pass and custom HDR effects belong to
 * the caller, who disposes them after `dispose()` (or after swapping them out).
 */

export interface BloomSettings {
  /** Multiplier on the (additive) bloom contribution. */
  intensity: number;
  /** Scene-linear luminance where pixels start to bloom (1.0 ≈ diffuse white). */
  threshold: number;
  /** Width of the soft knee above the threshold, in luminance units. */
  smoothing: number;
  /** Mipmap-blur spread, 0..1: how far the glow reaches. */
  radius: number;
}

/**
 * Where custom HDR effects run.
 * - `pre-bloom`: on the raw scene; bloom sees their output (warp/travel streaks, gravitational
 *   lensing — anything that moves or adds light that should itself glow).
 * - `post-bloom`: after bloom, before tone mapping (lens-flare ghosts, HDR colour grading).
 */
export type HdrStage = 'pre-bloom' | 'post-bloom';

export interface PostFXOptions {
  quality?: Quality;
  /** Renders the scene into the composer's input buffer. See `setScenePass`. */
  scenePass?: Pass | null;
  bloom?: Partial<BloomSettings>;
  /** Linear exposure multiplier applied before tone mapping. Default 1. */
  exposure?: number;
  /** Subtle lens vignette. Default true. */
  vignette?: boolean;
  /** Film grain amplitude (0 disables). Default 0.035. */
  grain?: number;
}

/**
 * Tuned on dev/harness-demo.html: an emissive-10 sphere of radius R glows at display ≈ 173 / 110 /
 * 54 / 23 (sRGB) at 1.25 / 1.5 / 2 / 3 R. Radius 0.7 kept 51/255 at 3R, which fogged the black sky.
 */
export const DEFAULT_BLOOM: Readonly<BloomSettings> = {
  intensity: 1.0,
  threshold: 1.0,
  smoothing: 0.3,
  radius: 0.6,
};

interface QualityPreset {
  antialias: 'fxaa' | 'smaa';
  smaaPreset: SMAAPreset;
  /** MSAA samples on the HDR buffers (resolves geometric aliasing of thin lines/points). */
  multisampling: number;
}

const QUALITY_PRESETS: Readonly<Record<Quality, QualityPreset>> = {
  low: { antialias: 'fxaa', smaaPreset: SMAAPreset.LOW, multisampling: 0 },
  medium: { antialias: 'smaa', smaaPreset: SMAAPreset.MEDIUM, multisampling: 0 },
  high: { antialias: 'smaa', smaaPreset: SMAAPreset.HIGH, multisampling: 0 },
  ultra: { antialias: 'smaa', smaaPreset: SMAAPreset.ULTRA, multisampling: 4 },
};

/**
 * Vignette: flat to ~35% of the half-diagonal, ~0.97 at the edge midpoints, ~0.85 in the corners
 * (postprocessing's default technique: smoothstep(0.8, 0.799·offset, d·(offset + darkness))).
 */
const VIGNETTE = { offset: 0.19, darkness: 0.25 } as const;

/** An EffectPass that can let go of its effects without disposing them (they are reused). */
class ChainPass extends EffectPass {
  constructor(effects: readonly Effect[]) {
    super(undefined, ...effects);
  }

  /** Detach from the effects and free this pass's own merged shader material. */
  release(): void {
    this.setEffects([]);
    this.fullscreenMaterial.dispose();
  }
}

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloomEffect: BloomEffect;
  readonly toneMappingEffect: ToneMappingEffect;
  readonly vignetteEffect: VignetteEffect;
  readonly grainEffect: FilmGrainEffect;

  private readonly renderer: WebGLRenderer;
  private quality: Quality;
  private exposure: number;
  private vignette: boolean;
  private scenePass: Pass | null;
  private preBloom: readonly Effect[] = [];
  private postBloom: readonly Effect[] = [];
  private smaa: SMAAEffect | null = null;
  private fxaa: FXAAEffect | null = null;
  private chainPasses: ChainPass[] = [];
  private warnedNoScenePass = false;

  constructor(renderer: WebGLRenderer, options: PostFXOptions = {}) {
    this.renderer = renderer;
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = SRGBColorSpace;

    this.quality = options.quality ?? 'high';
    this.exposure = options.exposure ?? 1;
    this.vignette = options.vignette ?? true;
    this.scenePass = options.scenePass ?? null;

    this.composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      multisampling: QUALITY_PRESETS[this.quality].multisampling,
    });

    const bloom = { ...DEFAULT_BLOOM, ...options.bloom };
    this.bloomEffect = new BloomEffect({
      // ADD, not the default SCREEN: screen blending is only meaningful for values in [0, 1].
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      levels: 8,
      luminanceThreshold: bloom.threshold,
      luminanceSmoothing: bloom.smoothing,
      intensity: bloom.intensity,
      radius: bloom.radius,
    });
    this.toneMappingEffect = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignetteEffect = new VignetteEffect(VIGNETTE);
    this.grainEffect = new FilmGrainEffect({ amount: options.grain ?? 0.035 });

    this.rebuild();
  }

  /**
   * Replace the pass that renders the scene into the composer's input buffer (HDR, RGBA16F).
   * Dev pages use a postprocessing `RenderPass`; the engine supplies a multi-layer pass that renders
   * several scenes with depth clears in between. A scene pass must clear the buffer itself, render
   * into `inputBuffer` (or to screen if `renderToScreen`), and keep `needsSwap = false`.
   */
  setScenePass(pass: Pass | null): void {
    if (pass === this.scenePass) return;
    this.scenePass = pass;
    this.warnedNoScenePass = false;
    this.rebuild();
  }

  /**
   * Install custom HDR effects for a stage (replacing that stage's previous list), in order.
   * Consecutive per-pixel effects share one pass; convolution / UV-remapping effects get their
   * own (see `passPlan.ts`). Rebuilding compiles a new merged shader the first time a given
   * combination is used; three.js caches programs, so toggling between known sets is cheap.
   */
  setHdrEffects(effects: readonly Effect[], stage: HdrStage = 'pre-bloom'): void {
    const current = stage === 'pre-bloom' ? this.preBloom : this.postBloom;
    if (current.length === effects.length && current.every((e, i) => e === effects[i])) return;

    const other = stage === 'pre-bloom' ? this.postBloom : this.preBloom;
    const own = this.ownEffects();
    const seen = new Set<Effect>();
    for (const effect of effects) {
      if (seen.has(effect) || other.includes(effect) || own.has(effect)) {
        throw new Error(`PostFX: effect "${effect.name}" is already in the chain`);
      }
      seen.add(effect);
    }

    if (stage === 'pre-bloom') this.preBloom = [...effects];
    else this.postBloom = [...effects];
    this.rebuild();
  }

  getHdrEffects(stage: HdrStage = 'pre-bloom'): readonly Effect[] {
    return stage === 'pre-bloom' ? this.preBloom : this.postBloom;
  }

  getQuality(): Quality {
    return this.quality;
  }

  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    const before = QUALITY_PRESETS[this.quality];
    const after = QUALITY_PRESETS[quality];
    this.quality = quality;
    this.composer.multisampling = after.multisampling;
    if (this.smaa) this.smaa.applyPreset(after.smaaPreset);
    if (before.antialias !== after.antialias) this.rebuild();
  }

  /**
   * Resize to a CSS-pixel viewport. Pass `pixelRatio` to change the render scale at the same time
   * (the engine's adaptive quality does); otherwise the renderer's current pixel ratio is kept.
   */
  setSize(width: number, height: number, pixelRatio?: number): void {
    if (pixelRatio !== undefined && pixelRatio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(pixelRatio);
    }
    this.composer.setSize(width, height);
  }

  getBloom(): BloomSettings {
    const lum = this.bloomEffect.luminanceMaterial;
    return {
      intensity: this.bloomEffect.intensity,
      threshold: lum.threshold,
      smoothing: lum.smoothing,
      radius: this.bloomEffect.mipmapBlurPass.radius,
    };
  }

  setBloom(settings: Partial<BloomSettings>): void {
    const lum = this.bloomEffect.luminanceMaterial;
    if (settings.intensity !== undefined) this.bloomEffect.intensity = settings.intensity;
    if (settings.threshold !== undefined) lum.threshold = settings.threshold;
    if (settings.smoothing !== undefined) lum.smoothing = settings.smoothing;
    if (settings.radius !== undefined) this.bloomEffect.mipmapBlurPass.radius = settings.radius;
  }

  getExposure(): number {
    return this.exposure;
  }

  /** Linear exposure before tone mapping (1 = neutral). Cheap: safe to drive every frame. */
  setExposure(exposure: number): void {
    this.exposure = exposure;
  }

  getVignette(): boolean {
    return this.vignette;
  }

  setVignette(enabled: boolean): void {
    if (enabled === this.vignette) return;
    this.vignette = enabled;
    this.rebuild();
  }

  getGrain(): number {
    return this.grainEffect.amount;
  }

  /** Film grain amplitude, 0 disables (the effect stays merged in the final pass; it is cheap). */
  setGrain(amount: number): void {
    this.grainEffect.amount = amount;
  }

  /** Render one frame. `dtSec` drives time-based effects (grain); pass 0 to freeze them. */
  render(dtSec: number): void {
    if (this.scenePass === null) {
      if (!this.warnedNoScenePass) {
        console.warn('PostFX.render(): no scene pass set — call setScenePass() first');
        this.warnedNoScenePass = true;
      }
      return;
    }
    // Consumed by the ToneMappingEffect (three's ACES implementation reads toneMappingExposure).
    // Scene materials never see it: the renderer's own tone mapping is off.
    this.renderer.toneMappingExposure = this.exposure;
    this.composer.render(dtSec);
  }

  /** Free every GPU resource PostFX created. The scene pass and custom effects are the caller's. */
  dispose(): void {
    this.composer.removeAllPasses();
    for (const pass of this.chainPasses) pass.release();
    this.chainPasses = [];
    for (const effect of this.ownEffects()) effect.dispose();
    this.composer.dispose();
  }

  // ───────────────────────────────────────────────────────────── internals

  private antialiasEffect(): Effect {
    const preset = QUALITY_PRESETS[this.quality];
    if (preset.antialias === 'fxaa') {
      this.fxaa ??= new FXAAEffect();
      return this.fxaa;
    }
    this.smaa ??= new SMAAEffect({ preset: preset.smaaPreset });
    return this.smaa;
  }

  private ownEffects(): Set<Effect> {
    const own = new Set<Effect>([
      this.bloomEffect,
      this.toneMappingEffect,
      this.vignetteEffect,
      this.grainEffect,
    ]);
    if (this.smaa) own.add(this.smaa);
    if (this.fxaa) own.add(this.fxaa);
    return own;
  }

  /** Recreate the effect passes from the current chain. Effects are reused, never re-created. */
  private rebuild(): void {
    const composer = this.composer;
    composer.removeAllPasses();
    for (const pass of this.chainPasses) pass.release();
    this.chainPasses = [];

    if (this.scenePass) composer.addPass(this.scenePass);

    const antialias = this.antialiasEffect();
    const chain: Effect[] = [
      ...this.preBloom,
      this.bloomEffect,
      ...this.postBloom,
      this.toneMappingEffect,
      antialias,
      ...(this.vignette ? [this.vignetteEffect] : []),
      this.grainEffect,
    ];
    // Bloom renders from its input in update(); FXAA samples neighbours without saying so.
    const exclusive = new Set<Effect>([this.bloomEffect]);
    if (this.fxaa) exclusive.add(this.fxaa);

    for (const effects of planPasses(chain, (effect) => effectTraits(effect, exclusive))) {
      const pass = new ChainPass(effects);
      composer.addPass(pass);
      this.chainPasses.push(pass);
    }
    // Final pass writes 8-bit sRGB: dither to break up banding in dark gradients.
    const last = this.chainPasses[this.chainPasses.length - 1];
    if (last) last.dithering = true;
  }
}
