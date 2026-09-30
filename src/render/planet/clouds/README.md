# planet/clouds — the cloud shell

An animated procedural cloud layer for `PlanetVisual` (`RENDER_ORDER.clouds`, between the far half of the rings
and the atmosphere): cumulus fields with cyclones, an ITCZ and storm tracks; full overcast with subtle banding
on hothouse worlds; thin wind-streaked wisps on thin-air deserts. Lit by the sun with soft self-shadowing,
silver linings and reddening towards the terminator.

```ts
const clouds = createClouds(body, system, quality); // ICloudLayer | null
root.add(clouds.object);
clouds.update(frame, planetUniforms);
```

Exports: `createClouds`, `CloudLayer`, `deriveClouds(body)`, `cloudFieldGlsl`, `cloudShadowGlsl`.
Returns null for giants (`cloudCoverage` = 0: the surface paints bands), airless bodies, cover < 2% or
p < 0.02 atm.

## How it works

- Same skeleton as the atmosphere: a back-face coverage sphere, an analytic hit on the cloud sphere
  (`R (1 + 1.6 H / R)`, clamped to 0.25-1.2% so it floats above the terrain), the planet's own ray hit hides
  the layer behind the ground, analytic depth (1% nearer), premultiplied output.
- **Field** (`cloudField.glsl.ts`), evaluated at the unit direction n: (1) the pattern drifts about the spin
  axis and evolves slowly (phases from `simDays - epoch` and real time on the CPU); (2) up to 3 cyclones twist
  the sample direction (`angle = strength exp(-(d/size)^2)`, sign by hemisphere, placed from a fork of the
  body seed) so the noise curls into spiral arms; (3) local cover = `cloudCoverage` x a zonal envelope
  (normalised to mean 1) -> threshold via the logistic quantile approximation; (4) 3D simplex fBm for weather
  systems + a finer fBm for the cumulus texture with an analytic gradient. Octaves fade out below the pixel
  footprint (`fwidth`), so distant clouds do not shimmer. Wisps use noise stretched along latitude circles.
- **Lighting**: wrap-lambert on the bump normal (density gradient), one coarse-field tap towards the sun for
  self-shadowing, forward-scatter silver lining, sunlight extinction `exp(-tau airmass)` through the air above
  the deck (`sunTau` from the atmosphere model, Kasten-Young air mass), sky-tinted ambient.

## Cloud shadows on the ground (optional)

`cloudShadowGlsl` is a chunk for the surface shader: `float cloudShadow(vec3 P, vec3 sunDir)` (body frame,
km; 1 = unshadowed). Include it after `common` and `noise`, merge `cloudLayer.shadowUniforms()` into the
surface material's uniforms (live objects: the shadows drift with the clouds) and multiply the direct
sunlight by it. `dev/skyKit.ts` (TestSurface) is a working example.

## Limits

Single 2D layer (no volumetric depth, no parallax inside the deck; seen from below it is a dimmed sheet).
Quality steps octaves (3/4/5/5 base, 3/4/5/6 detail) and drops the shadow tap on `low`. Close-up detail is
limited by the noise octaves (a soft blanket below ~1.3 R at `medium`).
