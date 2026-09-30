# render/planet — worlds you can orbit (planet-sculptor)

`PlanetVisual` (../PlanetVisual.ts) draws one body: an opaque, lit, shaded **surface** (this directory) plus
the sky specialist's **atmosphere, clouds and rings** (`../atmosphere`, `../clouds`, `../rings` — composed via
their factories, never edited here). Everything is procedural and deterministic from `body.seed`; no textures
ship. Visual parameters come from `../appearance.ts`, which turns the physical body + its star system + the
generator's `AppearanceHints` into plain data (`deriveLook`), unit-tested without a GPU.

```ts
const visual = new PlanetVisual(body, { system }, quality, 'full' | 'lite');
scene.add(visual.object);                 // root group: carries positionKm + orientation, children work in body-fixed km
// engine, every frame while !visual.ready:  visual.prepare(renderer, budgetMs)
// every frame:                              visual.update(frame, { positionKm, orientation, sunDirection, sunColor,
//                                                                  sunAngularRadiusRad, sunIntensity, occluders?, intensity })
visual.dispose();
```

Extras beyond `IPlanetVisual`: `look` (the derived `PlanetLook`), `progress` (0..1), `drawable` (the surface can
actually be drawn — lite visuals report `ready` at once but draw a few frames later), `bakedCubes()`,
`setDebug(mode)` (0 shaded · 1 albedo · 2 normals · 3 height · 4 shadow · 5 diffuse), `warm(renderer)`, and
`prewarmPlanetPrograms(renderer, samples, quality)` (see *Integration*).

## Surfaces

| family | full | lite |
|---|---|---|
| rocky (terran, ocean, desert, hothouse, barren, ice, lava, dwarf) | time-sliced GPU bake -> `RockySurface` | **the same bake at 64² per face** + the same shader, cloud shell and atmosphere rim folded in |
| gas / ice giant | `GiantSurface` (analytic, no bake) | the same shader, octave cap only |

Lite is a faithful low-detail version of full, not a different look: same seed, palette, terrain functions,
lighting response and terminator, so the engine's swap at ~28 px radius changes detail only
(`dev/planet.html?compare=1&px=30` renders both side by side). The lite bake starts lazily from the first
`update()` (three per rendered frame across all visuals) and the visual stays hidden until it is drawable.

## Rocky bake (surface/bake.ts, glsl/bake*.glsl.ts)

Three passes into cube maps, one face at a time as strips of rows:

1. **terrain** -> temporary RGBA16F cube: height (0 = sea level), moisture, a style-specific mask (mare, lineae,
   lava cracks), crater freshness / ray brightness. Continents are an 8-octave domain-warped simplex fBm whose
   sea level is the Gaussian quantile for `oceanCoverage` (`CONTINENT_SIGMA`; measured: 67.4 % vs 68 % on
   Halcyon); mountains are ridged multifractal masked to orogenic belts; craters are a 7-octave 3D-lattice
   population with depth ~ D^0.63 (d/D from 0.2 for small bowls to ~0.03 for basins), rays, mare flooding;
   shield volcanoes, a Valles-Marineris canyon, Europa lineae/chaos, Io paterae + crack network.
2. **albedo** -> sRGB8 + A cube (mip-mapped): linear albedo; alpha = 0.5 + 0.5 emissive - 0.5 ice. Biomes
   (temperature x moisture, Hadley-cell wet/dry latitude bands, rock on steep or high ground, beaches, tundra,
   snow line), ice from a zonal temperature table whose coverage quantile reproduces `iceCoverage`, lava as
   radiant *energy* E = e^2.2 (so mip filtering conserves it), city lights, baked multi-scale cavity occlusion.
3. **relief** -> RGBA8 cube (mip-mapped): tangent slope vector (object space; a vector field filters correctly,
   an octahedral normal would fold along z = 0) + 8-bit height (coast test, ocean depth, horizon shadows).

Sizes per face: low 256², medium 512², high 1024², ultra 1536² (docs/ARCHITECTURE.md §8); the temporary
height cube (8 B/texel) is freed when the bake ends, leaving 2 x 4 B/texel (50 MB at high).

**Time slicing.** `step(renderer, budgetMs)` renders strips of rows sized from a measured cost model
`dt = fixed + rowMs * rows` (the sync round trip is the fixed part; `gl.finish()` plus a 1-pixel readback
guarantees the GPU has really finished, since `finish()` alone is a no-op on some drivers), capped at 131 072
px per strip and 2x growth per step, so a call stays within its budget plus at most one strip on any GPU.
Shader programs are compiled first with `compileAsync` (KHR_parallel_shader_compile where available).
Mip chains are generated once per cube by flipping `generateMipmaps` for a single empty render.

## Runtime shading (glsl/rocky.glsl.ts)

Body-frame lighting (sun, camera and eclipse casters are rotated into the body frame in float64 by
`BodyFrame`, so the shader needs no model matrix). Baked albedo/relief -> sub-texel detail octaves (3D
simplex with analytic gradients, faded by pixel footprint) -> land: Oren-Nayar, or McEwen lunar-Lambert on
airless bodies (flat full moon) -> ocean: anti-aliased coast, depth-tinted water with turquoise shelves,
GGX sun glint (roughness from a wind field), Schlick Fresnel sky reflection, resolved wave normals only when
close -> sunlight extinction by airmass (Kasten-Young; Rayleigh/dust/tholin optical depths in appearance.ts:
red sunsets, brown haze) plus skylight -> **terrain shadows** (11-step horizon march over the baked height,
fading out with distance), **eclipses** (exact two-disc overlap: umbra, penumbra, antumbra, up to 4
occluders), **ring shadows** (slant optical depth through the ring plane) -> lava and city-light emissives.

## Giants (glsl/giant.glsl.ts)

A CPU-built 1-D latitude profile (`giantProfile.ts`: belts/zones, zonal winds with an equatorial jet, shear)
drives palette lookup; turbulence is domain-warped fBm sheared in longitude by the local wind, two copies half
a cycle apart cross-faded (the flow-map loop); vortices twist the sampling point about their centre and drift
with the jet; optional polar hexagon; ice-giant cirrus streaks; thermal glow for hot Jupiters (class IV/V);
limb darkening; ring and eclipse shadows. Flow time is `simDays - epoch` plus a slow wall-clock drift.

## Conventions

* Camera-relative: the group carries `positionKm`/`orientation`; children never re-apply them. Never a raw
  `simDays` in a shader. Oblateness scales the mesh (ellipsoid radii uniform).
* Programs are shared: no per-instance `#define`s (everything is a uniform), so all rocky worlds use one
  surface program + three bake programs, all giants one program.
* Opaque surface: `intensity` is a brightness multiplier, never alpha. `renderOrder` = `RENDER_ORDER.surface`.
* HDR scene-linear output; 1.0 ~ diffuse white under the normalised sun; lava 1.5-3.4, city lights ~2.5.

## Dev pages

`dev/planet.html?body=home.d | ?type=terran&n=1 | ?body=<id>`, `&view=far|mid|close|terminator|crescent|surface`,
`&sun=<az>,<el>`, `&lite=1`, `&compare=1&px=30` (lite left, full right), `&debug=albedo|normal|height|shadow|diffuse`,
`&shells=0` (hide the sky specialist's parts), `&budget=<ms>` (bake budget per frame; default 250),
`&nightlights=0.8` (force a civilisation). `window.__COVERAGE__()` reads the baked cubes back (ocean/ice
fractions vs the body's targets), `window.__PREP__` the time-slicing statistics.
`dev/planets.html` is the twelve-world gallery (`?quality=`, `&sun=`, `&labels=0`, `&cols=`).

## Integration

* Call `prewarmPlanetPrograms(renderer, [rockySample, giantSample], quality)` at boot (next to the engine's
  other `compileAsync` pre-warms) and keep the handle: it compiles the bake, rocky and giant programs so no
  arrival stalls on compilation (browsers without KHR_parallel_shader_compile compile synchronously).
* Ring shadows use a local copy of the ring radial profile (`ringProfile` in glsl/lighting.glsl.ts, mirroring
  ../rings); when the sky specialist exports a shared chunk, swap it in.
* Cloud shadows on the ground are not modelled (they would need the cloud layer's density in the surface
  shader); lite visuals fold a stand-in cloud cover into the surface.

## Limits / TODO

* Vegetation/city detail is bake-resolution limited beyond the procedural detail octaves (no per-tree detail).
* Terrain shadows sample 8-bit heights (small quantisation softening); no cloud or ring-light bounce.
* Gas-giant rings' own shadow on the planet uses the profile above; the planet's shadow on rings is the sky
  specialist's.
