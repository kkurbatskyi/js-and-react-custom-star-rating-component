# render/post — PostFX, the HDR pipeline

One post-processing chain for the engine and every dev page, built on
[pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) 6.39.

```
scene pass ──▶ [pre-bloom HDR effects] ──▶ bloom ──▶ [post-bloom HDR effects] ──▶ ACES filmic
  (RGBA16F)       warp, lensing…            mipmap     lens flare, grading          tone map
──▶ SMAA (FXAA on low) ──▶ vignette ──▶ film grain ──▶ sRGB encode + dither ──▶ screen
```

## Conventions (every material must follow them)

- Renderer: `toneMapping = NoToneMapping`, `outputColorSpace = SRGBColorSpace` (PostFX sets both).
- Materials output **scene-linear HDR**, linear-sRGB primaries, `toneMapped: false`, no gamma.
- 1.0 ≈ diffuse white under a normalised sun; bloom starts at luminance **1.0** (soft knee 0.3).
- Exposure is 1.0 unless the engine drives `setExposure()`; never bake exposure into shaders.

**Calibration** (measured with `dev/harness-demo.html`):

| Scene-linear input | Display (sRGB 0–255) |
|---|---|
| 0.18 grey diffuse, bloom off | **126–127** (photographic mid-grey) |
| emissive 10 sphere, radius R | centre 255; glow 173 / 110 / 54 / 23 at 1.25 / 1.5 / 2 / 3 R |

## API

```ts
import { PostFX } from '../render/post/PostFX';

const post = new PostFX(renderer, { quality: 'high', scenePass: new RenderPass(scene, camera) });
post.setSize(cssWidth, cssHeight, pixelRatio?);  // pixelRatio optional: also sets the render scale
post.render(dtSec);                              // dt drives grain animation; 0 freezes it
```

| Method | Notes |
|---|---|
| `constructor(renderer, { quality?, scenePass?, bloom?, exposure?, vignette?, grain? })` | Defaults: `high`, bloom `{ intensity 1, threshold 1, smoothing 0.3, radius 0.6 }`, exposure 1, vignette on, grain 0.035. |
| `setScenePass(pass \| null)` | See *Scene pass* below. |
| `setHdrEffects(effects, stage = 'pre-bloom')` | Replaces that stage's list; `'pre-bloom' \| 'post-bloom'`. |
| `getHdrEffects(stage)` | |
| `setQuality(q)` / `getQuality()` | low: FXAA · medium/high/ultra: SMAA preset of that name · ultra adds 4× MSAA on the HDR buffers. |
| `setSize(w, h, pixelRatio?)` | CSS px. |
| `setBloom({ intensity?, threshold?, smoothing?, radius? })` / `getBloom()` | Live, no rebuild. |
| `setExposure(x)` / `getExposure()` | Linear multiplier before ACES; safe to drive every frame. |
| `setVignette(on)`, `setGrain(amount)` + getters | |
| `render(dtSec)`, `dispose()` | |
| `composer`, `bloomEffect`, `toneMappingEffect`, `vignetteEffect`, `grainEffect` | Escape hatches for tuning. |

**Ownership:** PostFX disposes only what it creates. The scene pass and your HDR effects are yours:
dispose them after `post.dispose()` or after swapping them out.

## Scene pass

The pass that fills the composer's input buffer (HalfFloat RGBA, with depth). Dev pages use
postprocessing's `RenderPass`. The engine supplies its own `Pass` that renders several layer scenes
far → near with depth cleared in between. Contract: clear colour and depth yourself (the composer
sets `renderer.autoClear = false`), draw into `inputBuffer` (or `null` when `renderToScreen`), and
keep `needsSwap = false`.

## Custom HDR effects

Write a postprocessing `Effect` (GLSL `mainImage` or `mainUv`) and install it:

```ts
post.setHdrEffects([warpEffect]);                    // before bloom: bloom sees the warped image
post.setHdrEffects([flareEffect], 'post-bloom');     // after bloom, before tone mapping
post.setHdrEffects([]);                              // remove
```

Pass planning (`passPlan.ts`, unit-tested): consecutive per-pixel effects are merged into one
EffectPass (one shader, one full-screen draw). An effect that **reads its input anywhere but at its own
pixel** (convolutions like warp or chromatic aberration, or rendering from the input in
`update()` like flare ghosts) must say so with `attributes: EffectAttribute.CONVOLUTION`. It then
starts a new pass, so its input already contains everything before it. `mainUv` effects (lensing)
get a pass of their own. Depth-reading effects are not supported: depth is cleared between layers.

Toggling: `setHdrEffects` rebuilds passes. The first use of a combination compiles a shader, and
three.js caches programs, so switching between known sets later is cheap. For per-frame fades,
keep the effect installed and drive its own uniforms.

Shared GLSL for effects lives in `src/render/shaders` (safe to include in several merged effects).

## Design notes

- **Bloom** is additive (`BlendFunction.ADD`); postprocessing's default SCREEN is only meaningful for
  values in [0, 1]. Radius 0.6, not 0.7: at 0.7 an emissive disc still left 51/255 at 3R, fogging
  the black sky.
- **Tone mapping** is three.js's ACES filmic (`exposure / 0.6` pre-scale, so 0.18 maps to 0.5).
  Exposure goes through `renderer.toneMappingExposure`, which only the ToneMappingEffect reads.
- **Film grain** (`FilmGrainEffect`): zero-mean triangular noise, multiplicative, weighted by
  (1 − L). Black stays black and highlights stay clean, unlike `NoiseEffect`, which lifts blacks.
  It is keyed to pixel and 24 Hz frame, so it freezes when `dt = 0` (deterministic screenshots).
- **Dithering** on the final 8-bit pass removes banding in dark gradients.
- AA runs after tone mapping, on display-referred values.

## Limits / TODO

- No auto-exposure yet (the engine may add it through `setExposure`).
- SMAA edge detection runs on display-linear (not gamma) values: slightly less sensitive in shadows.
- MSAA (ultra) multiplies the cost of every HDR effect pass; fine on desktop GPUs only.
