# Brief: SKY (name: sky-weaver, dev port 5306)

You make the thin blue line: atmospheres, clouds and rings — the details that turn a sphere into a world.

## You own
src/render/planet/atmosphere/**, src/render/planet/clouds/**, src/render/planet/rings/** (replace the stub
factories in each index.ts, keep their signatures: `createAtmosphere(body, system, quality)`,
`createClouds(body, system, quality)`, `createRings(planet, system, quality)` returning
IAtmosphereShell / ICloudLayer / IRingVisual or null), dev/sky.html + dev/sky.ts, dev/rings.html + dev/rings.ts.
The planet agent owns PlanetVisual and composes your pieces; to test, build your dev pages with a simple
lit sphere of your own (or their PlanetVisual when it's ready).

## Build
1. **Atmosphere**: physically-based single scattering — Rayleigh + Mie (+ optional ozone absorption) —
   raymarched in a shell shader (quality-scaled samples, §8) rendered after the surface with premultiplied
   blending (inscatter + transmittance × destination; the grey-transmittance approximation is fine). Must
   look right from far space (thin limb glow, blue rim), mid orbit, and low orbit near the terminator
   (sunset-coloured band, horizon haze), and handle the camera INSIDE the shell. Correct against the
   planet's own sphere (analytic intersection) so it hazes the surface (aerial perspective) without
   needing the surface shader. Parameters derived from the body: pressure, composition → colour & density
   (N₂/O₂ blue; thin CO₂ Mars butterscotch with a blue sunset; thick hothouse → dense yellow-white; hazy
   Titan orange; H₂/He giants subtle blue-white limb; ice giants cyan), scale height → thickness.
2. **Clouds**: a cloud shell with animated procedural structure — cumulus fields, cyclones/vortices on
   terran/ocean worlds, ITCZ-like equatorial bands, full overcast with subtle banding on hothouse worlds,
   thin wispy clouds on Mars-likes; lit by the sun with soft self-shadowing, silver lining and reddening at
   the terminator; slow drift and rotation over time. Optionally export a GLSL `cloudShadow` chunk the
   surface can sample.
3. **Rings**: a flat annulus in the planet's equatorial plane with procedural radial structure (gaps like
   the Cassini division, ringlets, density waves), colour by composition (icy bright, rocky dusty brown),
   optical-depth transparency, forward-scattering glow when backlit, lit vs unlit face, the planet's
   shadow cast on the rings; export `ringDensity` GLSL (+ a uniforms helper) so the planet surface can
   receive ring shadows.
4. Performance per ARCHITECTURE §8. dev/sky.ts: views (?body=terran|desert|hothouse|ocean|titan|giant
   &view=far|limb|low|terminator). dev/rings.ts: ringed giant front-lit, backlit, edge-on. Iterate with
   screenshots against NASA imagery (ISS limb photos, Cassini ring images) until genuinely beautiful.

## Addenda from the architecture review (binding)
- Use `body.appearance` (hazeColor, cloudCoverage, cloudColor) as the source of truth; derive physical scattering
  coefficients consistent with it.
- Render order (RENDER_ORDER in src/render/contracts.ts): clouds 20, atmosphere 30; rings are TWO view-dependent
  halves in one IRingVisual: far half (ringsFar 10) and near half (ringsNear 40) — e.g. two meshes sharing geometry
  whose shader discards the wrong side of the plane through the planet centre perpendicular to the view direction.
- Recommended: composite the atmosphere as dst·T_rgb + inscatter (a multiplicative pass then an additive pass)
  so a star seen through the limb reddens.
- `body.rings` now lives on BodyBase. `PlanetUniforms.sunAngularRadiusRad` is available.
- Never pass raw simDays to shaders; avoid per-instance #defines.
