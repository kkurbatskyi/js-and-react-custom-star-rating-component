# render/galaxy — GalaxyVisual

The galaxy as the sky: a volumetric emission–absorption pass for the diffuse light and dust,
plus flux-calibrated particles for star clouds, blue clusters and pink HII knots. One visual
serves every distance — 1 Mly away, face-on, edge-on, a few kly above the disk, and inside it
(the Milky-Way band with dust rifts and core glow).

```ts
import { GalaxyVisual } from '../render/galaxy/GalaxyVisual';

const galaxy = new GalaxyVisual(universe.galaxy, quality);   // ~200 ms CPU (medium)
scene.add(galaxy.object);
// every frame (camera at the origin, galactic axes, ly):
galaxy.update(frame, { cameraLy, nearFadeLy: 2500, intensity: 1 });
post.setExposure(ease(galaxy.exposureHint(cameraLy)));        // optional, see below
galaxy.setQuality('high');                                    // rebuilds what changed
galaxy.dispose();
```

Beyond `IGalaxyVisual`: `look` (a `GalaxyLook`, read every frame — bind a GUI to it),
`rebuildParticles()` (after changing colour temperatures), `exposureHint(cameraLy)`,
`setTemporal(on)`, and the dev helpers `validateMap(frame)` / `probeVolume(frame, u, v)`.

## Technique

| File | Role |
|---|---|
| `GalaxyMap.ts`, `map.glsl.ts` | Planar map (RGBA16F, mipmapped, ±1.2 radii): **r** arm factor, **g** midplane dust — a GLSL port of the model's own formulas and tables (`structure.gpu`), matching the CPU to half-float precision — **b** star-forming ridge clumps, **a** filament noise. Baked once on the GPU in the first `update()`. |
| `fields.glsl.ts`, `uniforms.ts` | GLSL twin of the smooth fields (exponential disk + taper, sech² layers, Plummer bulge, bar) shared by every pass. |
| `GalaxyVolume.ts`, `volume.glsl.ts` | Reduced-resolution raymarch → temporal resolve → full-resolution composite. |
| `GalaxyParticles.ts`, `particles.ts`, `particles.glsl.ts` | Particles generated on the CPU from the structure's component samplers. |
| `calibration.ts` | Brightness / dust / highlight normalisation, population colours. |
| `noiseVolume.ts` | Tileable 64³ fbm for 3D dust clumps near the camera. |

**Volume.** Emission j = k_E Σ_c ρ_c L_c (population colours: old warm bulge and inner disk →
white disk → blue arms, radial gradient; diffuse Hα on the star-forming ridges) and extinction
α = κ · dust · (0.8, 1, 1.25) (reddening), integrated exactly per step:
L += T·j·(1 − e^(−α dt))/α. Steps adapt to what the ray crosses —
`dt = min(kY(|y| + h_d)/|d_y|, kR(|p| + r₀), kT·t + dt_min)` — fine where a ray crosses the
midplane, near the centre, and geometric from the camera when inside the disk; the second half of
the budget stretches to reach the exit. Starts are jittered per pixel with interleaved gradient
noise (+ golden ratio per frame). **A single frame is clean on its own**: the resolve pass first
denoises the frame with a 3×3 tent that is cross-bilateral on dust transmittance e^(−τ) (IGN
spreads the nine taps over the whole jitter range; comparing transmittance rather than τ treats
opaque-vs-opaque as no edge, so rift interiors smooth while lane edges survive). Temporal
accumulation (history reprojected with the emission-weighted distance, clamped to the 3×3
neighbourhood) only refines further — captures after 3 frames are already smooth. The march writes
(MRT) that deterministic optical-depth guide; the full-resolution composite integrates the same
guide along its own ray and weights the 2×2 low-res taps by transmittance similarity
(**dust-guided joint bilateral upsampling**), so lanes stay sharp at ¼ of the pixels.

**Dust.** The model's dust (lanes half a σ inside each arm ridge) is clumped log-normally by the
filament noise, exp(k n − k²s²/2) — turbulent-ISM statistics that keep the mean but open gaps, so
face-on lanes break up like M51's and the band from inside shows star clouds between dark clouds.
Within ~8 kly of the camera the clumping (and emission mottling) switches from the planar map to
3D noise: separable planar × sech² fields otherwise show as vertical stripes in the sky from inside
and as "curtains" below the camera. Rendered dust is 1.5× the model's scale height (face-on lanes
cannot be dark when the light layer is thicker than the dust).

**Particles.** Gaussians of world σ with flux Φ: field particles carry `share[c]` of each
component's light (arm 30 %, disk 12 %, bulge 4 %), the volume the rest, so the two add up to the
calibrated galaxy (tested). Truncated-Pareto fluxes (few bright, many faint), clusters and HII knots
in clumps on the ridges. Sub-pixel sprites keep a stable 0.75 px σ footprint and dim by the area
ratio (flux conserved); resolved ones are capped at 1 px σ at constant surface brightness, so near
particles dim away instead of becoming bokeh. Each vertex integrates line-of-sight dust from the
camera through the dust slab (map dust per sub-segment, sech² integrated analytically), so particles
behind lanes are extinguished and reddened. Near fade: `nearFadeLy`.

**Calibration** (`calibration.ts`). k_E makes the mean face-on surface brightness around the home
circle equal `look.brightness` (0.11); κ makes the face-on optical depth of the densest lane on that
circle `look.dustOpacity` (3). Emissivity above 0.8 × the home arm-ridge light is compressed,
j → knee·(j/knee)^0.4 (volume and particle fluxes alike), which keeps the core golden instead of
clipped. The volume's unresolved light also near-fades (1.6 × `nearFadeLy`): the starfield owns the
foreground, and it keeps the high-latitude sky dark (band/pole contrast ~5× → realistic).

## Quality

| | particles | map | volume scale | steps | LOS dust samples | guided upsample |
|---|---|---|---|---|---|---|
| low | 80k | 1024² | 0.4 | 32 | 4 | off |
| medium | 150k | 1024² | 0.5 (¼ px) | 48 | 6 | on |
| high | 300k | 2048² | 0.7 (½ px) | 60 | 8 | on |
| ultra | 500k | 2048² | 0.7 | 72 | 8 | on |

Draw calls: 3 offscreen + 2 in the scene. GPU memory (medium): map 11 MB, volume targets
3 × RGBA16F at ¼ px, noise 256 KB, particles 150k × 32 B. CPU: construction ≈ 200 ms (medium,
particles + 3D noise), `update()` is allocation-free (uniform writes only).

## Exposure hint

Exposure is 1 by contract. A single exposure cannot suit every view: inside the disk the band is
fainter than the face-on galaxy (needs ~2), and a few kly above the disk the disk fills the view at
grazing angles, ~1/sin(elevation) brighter (needs ~0.45). `exposureHint(cameraLy)` blends these by
camera position (log space; 1 far away). The dev page applies it; the engine may ease toward it.

## Dev page — `dev/galaxy.html`

`?view=overview|faceon|edgeon|above-home|inside-core|inside-plane`, `?seed=`, `?near=`,
`?look=key:value,…` (A/B without code edits), `?temporal=0&settle=0` (a single, unaccumulated
frame — how the app looks right after a cut), `?validate=1` (GPU bake vs CPU model →
`window.__GALAXY_CHECK__`, max error ≈ 2e-4), `?probe=u,v;…` (HDR volume radiance →
`window.__GALAXY_PROBE__`), plus the harness parameters. lil-gui exposes the whole `GalaxyLook`.

## Limits / ideas

- Arms follow the model exactly (the catalogue depends on it); tightly wound 4-arm seeds look more
  M101 than M51. No spurs/feathers between arms yet (a visual-only dust term would do).
- The composite needs ~12 map taps per pixel on medium+ (guided upsampling); `low` uses bilinear.
- Temporal accumulation ghosts slightly under fast rotation (neighbourhood clamping limits it);
  `setTemporal(false)` gives the denoised single frame only.
- The app's `nearFadeLy` is 1200 ly (dev page default 2500): the volume's unresolved light fades
  over 1.6 × that, so inside-disk skies carry a little more foreground glow in the app.
- Resolved HII regions near the camera become dim dots, not nebulae (a noise-textured nebula
  sprite would be the next step).
- On portrait phones the overview needs a wider framing (camera distance is the engine's call).
