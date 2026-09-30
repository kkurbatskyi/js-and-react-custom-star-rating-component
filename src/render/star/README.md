# render/star — StarVisual, from 1.3 stellar radii to the edge of the system

`StarVisual` (implements `IStarVisual`) draws the focus star of the system layer at **every** distance:

```
resolved sphere ──▶ glow ──▶ point source          (shared photometry: ../starfield/photometry.ts)
```

```ts
const star = new StarVisual(starDetails, quality);   // one per system, cached by the app
scene.add(star.object);
star.update(frame, { positionKm /* camera-relative */, intensity /* 0..1 fade */ });
star.lens;                                           // black holes: LensState for the lensing effect
```

## Three camera-facing quads (all camera-relative, so nothing loses precision at 1e10 km)

1. **Photosphere** — an *analytic ray-cast sphere* on a quad (`star.glsl.ts`). Exact silhouette and
   coverage-based anti-aliasing down to sub-pixel discs, true depth via `gl_FragDepth` (planets pass in
   front of / behind it), premultiplied blending so the rim composites cleanly.
   * **Limb darkening from the Eddington grey atmosphere**: `T⁴ = ¾ T_eff⁴ (τ + ⅔)` with τ = μ, then the
     Planck ratio `B_λ(T)/B_λ(T_ref)` at the R/G/B effective wavelengths. Colour therefore changes
     consistently: the limb is dimmer *and* redder; starspots (T −13 %…−25 %) are darker *and* redder;
     hot granule cores are bluer. Everything is expressed as a temperature perturbation `dT/T`.
   * **Granulation**: animated 3-D Worley cells (feature points orbit inside their cells, so granules
     *boil* instead of sliding) on a domain-warped surface, dark lanes of varying width/depth, bright
     "domes", per-cell brightness and slow pulsing, a second finer octave that fades in as the coarse
     cells grow large on screen, plus fine turbulence and larger supergranular mottling. Every octave is
     level-of-detail-faded by its cell size in pixels — no shimmer when the star shrinks.
   * **Starspots & faculae** scale with `activity` (sunspot belt for slow rotators, anywhere for fast
     rotators / M dwarfs); **flares** (active K/M dwarfs) are a fast-rise/slow-decay white-blue kernel on
     the surface plus brighter limb loops.
   * Rotation phase is computed in float64 from `simDays / rotationPeriodDays`; animation uses `timeSec`.
2. **Corona** — thin chromosphere rim, K-corona with broad streamers + fine filaments (equatorial belt
   for quiet stars), a luminous limb glow, and five animated **prominence arches** (Hα-red) with their
   own life cycles. Everything is windowed to zero at the quad edge.
3. **Point-source sprite** — the same profile and the same `pointSource()` numbers as the starfield
   (see `../starfield/README.md`), fading out only once the disc is 3–24 px wide. This is what keeps the
   star visible from across its system.

## Look by spectral type (`starLook.ts`, pure and unit-tested)

| | look |
|---|---|
| O/B | smooth, blinding blue-white, wide radiative glow, no spots |
| A/F | faint mottling, thin corona |
| G | classic: fine granulation, spot belt, streamers, prominences |
| K | like G, redder, larger spots |
| M dwarf | deep orange, big spots anywhere, frequent flares |
| giants / supergiants | few huge convection cells (5 / 2.6 across a radius), fuzzy limb, dusty glow |
| white dwarf | tiny, intense, smooth |

## HDR & exposure

* Small discs / points radiate at `brightness` = 14·(T/5772) clamped to 6–40 (ARCHITECTURE §5), which the
  bloom pass turns into the familiar glow. A *resolved* sun at 14 sits on ACES's shoulder — no surface
  detail, no colour — so the disc's radiance eases (log-interpolated over 5–50 px of disc radius) to
  `closeBrightness` ≈ 0.3–0.9, an auto-exposure in spirit. It is tuned for the engine's in-disc scene
  exposure (≈ 2); the corona is drawn as if the disc were ≥ 4.5 so it stays legible.
* Chroma of the shaded disc is boosted (×2.4 cool → ×1.3 hot) to counter ACES desaturation.

## Neutron stars and black holes

The mesh set is chosen from `StarDetails.kind` (`exotics.ts`).

**Black holes** (`HoleVisual.ts`, `hole.glsl.ts`) — one quad running a per-pixel **geodesic integrator** in
the Schwarzschild metric (`u'' = −u + 3/2 u²`, leapfrog, 56–160 steps by quality; `radiusKm` is `r_s`).
Captured rays are the black shadow (b < 3√3/2 r_s); equatorial-plane crossings found along each ray give
the accretion disk's primary image, the far side lensed over the top and the higher-order images, all from
one integration. The disk is a thin Novikov–Thorne-like profile (`T ∝ x^-3/4 (1 − x^-1/2)^1/4`,
ISCO = 3 r_s, blackbody colour) with Keplerian **Doppler beaming and gravitational redshift** (one side
brighter and bluer) and shearing turbulence; a thin photon ring hugs the critical curve. `accretion`
(0..1) scales the disk (0 = a bare shadow). Supermassive holes glow gold, stellar ones blue-white. The quad
covers the disk and becomes full-screen when the camera is close; the shared point-source sprite covers
the far range. Output is premultiplied (the shadow hides what is behind it).

**Neutron stars** (`NeutronVisual.ts`, `neutron.glsl.ts`) — a tiny blue-white sphere (StarVisual's own),
two opposite **pulsar beams** sweeping the sky around the spin axis (real period slowed to 1.6–6 s;
foreshortened shafts plus a lighthouse flash when a beam crosses the line of sight) and a faint **wind
nebula** (equatorial termination-shock ring, filaments, polar jets; fades out inside the bubble).

**Gravitational lensing** (`lensing.ts`) — a postprocessing `Effect` for the background sky:

```ts
const lensing = createLensingEffect();                 // Effect with mainUv + mainImage
post.setHdrEffects([lensing], 'pre-bloom');            // pre-bloom: bloom sees the warped sky
// every frame, for the focus star's StarVisual:
lensing.setState(starVisual.lens);                     // or lensing.setTarget(uvX, uvY, einsteinRadiusPx, strength[, innerPx, heightPx])
```

It applies the point-lens equation `β = θ − θ_E²/θ` (`θ_E = √(2 r_s / D)`, exposed in px as
`lens.einsteinRadiusPx`) as an inverse UV remap: stars smear into tangential arcs, a clear void opens around
the hole. The hole's own image is already strongly lensed by the ray tracer, so the effect fades in from
`lens.innerRadiusPx` (the hole quad's edge) over a ramp that `lensRampEnd()` widens until the remap is
provably fold-free; sky sampled from beyond the frame fades to black. `lens.active` is false unless the star is
a black hole on screen and not so close that the disk fills the view. Remaining limit: when the Einstein
radius is well inside the hole quad (close range) the ring itself cannot be reproduced — only its tail.
**The engine must wire it** (`src/app/fx.ts` currently only globs `render/fx/*`): import
`createLensingEffect` from `render/star/lensing` and forward `assets.star.lens` each frame.

## Files

`StarVisual.ts` (orchestration) · `star.glsl.ts` (photosphere, corona, sprite shaders) · `starLook.ts` ·
`HoleVisual.ts` + `hole.glsl.ts` · `NeutronVisual.ts` + `neutron.glsl.ts` · `lensing.ts` · `exotics.ts` ·
`types.ts` (each with a `*.test.ts` where there is logic to test). Dev page:
`dev/star.html?type=O|B|A|F|G|K|M|K-giant|M-supergiant|white-dwarf|neutron-star|black-hole|smbh|gallery`
with `?dist=close|mid|system|far` or `?r=<stellar radii>`.

## Known limits

* The black-hole and neutron-star programs compile on first use (the engine's warm-up covers the home star's
  disc, corona and sprite programs only); the hole shader is the heaviest — `quality: 'low'` uses 56 steps.
* At the galactic centre the galaxy layer's bulge glow washes out the whole frame at the engine's exposure,
  so the core black hole is hard to see in the app (not something StarVisual can fix).
* Granulation cell sizes are exaggerated by ~30× relative to the real Sun (700 cells per radius would be
  invisible); that is deliberate.
