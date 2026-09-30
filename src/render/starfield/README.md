# render/starfield — catalogue stars as points of light, and the shared photometry

`StarfieldVisual` draws every star of the current catalogue blocks as an anti-aliased, physically
scaled sprite (20–30k stars, one draw call). `photometry.ts` is the single source of truth for how
bright and how big an unresolved star looks — **both** the starfield and `StarVisual`'s
point-source mode use it, so the hand-off between them is seamless.

```ts
import { StarfieldVisual } from './StarfieldVisual';
const field = new StarfieldVisual(quality);
scene.add(field.object);
field.setBlocks(blocks, originLy);            // when the block set changes / the camera drifts > ~50 ly
field.update(frame, { cameraLy, hiddenStarId, hiddenFade, selectedId, hoveredId, exposure });
field.pick(x, y, maxDistPx);                  // → { id, distPx } | null   (id = `${block.key}.${i}`)
field.anchors(12);                            // → [{ id, x, y, priority }]  brightest first, ids only
```

## How a star becomes a sprite

```
M_V (block.absMag), d (camera distance, ly)
  → m = M_V + 5 log10(d / 10 pc)            apparent magnitude (vertex shader, per star)
  → f = exposure · 10^(−0.4 m)              flux relative to a magnitude-0 star; f < 10^(−0.4·6.8) is culled
  → peak = min(20, 4 · f^0.8)               compressive: 12 magnitudes fit on one display
  → sigma, halo, spikes from log10(1 + peak)  (see `SPRITE` in photometry.ts — the constants live in one place)
```

* **No aliasing shimmer.** The profile is evaluated analytically at the exact sub-pixel star position
  (`gl_InstanceID` quads, no point-size limits). The core Gaussian never shrinks below σ ≈ 0.8 px (a
  point-sampled Gaussian narrower than that changes total energy with sub-pixel phase); faint stars
  *dim*, they do not shrink. Sizes are CSS px scaled by `resolutionScale(pixelsPerRadian)`.
* **Bright stars** get a soft Plummer halo and faint JWST-style diffraction spikes (six main spikes at
  90°/30°/150° + two short horizontal ones). Spike amplitude and length follow flux, so only stars
  brighter than ≈ m 3 show any. `quality: 'low'` drops spikes.
* **HDR budget.** The bloom pass turns every HDR unit above 1 into a wide glow, so the sprite's peak is
  capped at 20 and its halo at 0.4: past the cap only the glare (halo radius / spike length) keeps
  growing, slowly (`glareGrow`, ≤ +72 %). Without the cap the Sun seen from 1 AU is a fog ball.
* **Colour** is `block.colorRGB` with the ARCHITECTURE §9 ×1.25 saturation boost (brightest channel kept).

## Shared photometry hand-off

`photometry.ts`:

```ts
pointSource(luminositySolar, distanceKm, pixelsPerRadian, exposure = 1, out?) → PointSource
// { peakHdr, radiusPx, sigmaPx, haloPx, haloGain, spikePx, spikeGain, magnitude }
visualLuminositySolar(absMag)   // L_V / L☉ = 10^(−0.4 (M_V − 4.83))
spriteGlsl                      // GLSL twin: starSpriteParams() + starPsf(), built from the same constants
```

* `luminositySolar` is the **V-band** luminosity in solar units (use `visualLuminositySolar(star.absMag)`),
  because that is what the eye — and `block.absMag` — measures; a bolometric L would over-brighten hot
  and cool stars by their bolometric correction.
* Inside a system the layer fades the starfield's sprite (`hiddenFade`, a *peak* scale) while StarVisual
  fades in the same sprite (`intensity`): the two sum to a constant. Verified numerically:
  `dev/star.html?type=G&r=3000` and `…&mode=starfield` give **identical** display values at every probed
  radius (`__HARNESS__.probe`), at several distances.
* Unit tests (`photometry.test.ts`) pin the magnitudes (Sun: −26.74 at 1 AU) and check monotonicity and
  continuity of every sprite parameter over ten decades of distance.

## Precision & performance

* `setBlocks` merges all blocks into ONE instanced buffer of float32 offsets from `originLy` (computed
  in float64 from each block's own origin), reuses capacity (power-of-two growth, never shrinks), and
  stores per-star absolute magnitude for the CPU side. ~13 ms for 20k stars on a cold JIT.
* The object sits at `origin − cameraLy` (float64). `pick()` / `anchors()` project every star once per
  `update` (lazily, only if called) into reusable typed arrays in double precision — no per-star objects,
  no allocation except the returned anchor list. `pick` favours bright stars (≤ 4 px of forgiveness).
  `anchors(12)` on 20k stars: ≈ 1 ms.
* Highlights: the selected star gets a slowly turning four-gap gold reticle with an outgoing ripple, the
  hovered star a thin blue-white ring; both are drawn analytically in the sprite shader (no extra draw).
  The hidden star is culled once `hiddenFade` ≈ 1.

## Limits

* Stars are drawn without depth testing (they are at infinity for occlusion purposes); the layer is
  responsible for occluders (`ScreenDisc`s) when picking.
* One global `limitingMag` (6.8 at exposure 1); an exposure > 1 lets fainter stars through (the CPU
  visibility test mirrors the shader).
* The dev page (`dev/starfield.html`) covers block rebasing, fly-through, picking, anchors and
  highlights; `?src=universe` feeds it from `getUniverse().queryBlocks`.
