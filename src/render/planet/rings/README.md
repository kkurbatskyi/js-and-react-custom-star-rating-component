# planet/rings — the ring system

A flat annulus in the equatorial plane with procedural radial structure, slab photometry, optical-depth
transparency and the planet's shadow. Two view-dependent halves share one geometry and one program:
`RENDER_ORDER.ringsFar` (10, hazed by the limb) and `ringsNear` (40), split by the plane through the planet
centre perpendicular to the view direction.

```ts
const rings = createRings(body, system, quality); // IRingVisual | null (body.rings)
root.add(rings.object);
rings.update(frame, planetUniforms);
```

Exports: `createRings`, `RingVisual`, `ringUniformVector(rings)`, `ringProfileGlsl`, `ringShadowGlsl`.

## Structure (`ringProfile.glsl.ts`)

`ringStructure(u, seed, du, tau) -> (relative optical depth, colour ramp, brightness)`; u in 0..1 inner to
outer, `seed = (RingSystem.seed % 997) / 97`, du = pixel footprint in u (octaves below ~2 px fade out).
- tau > 0.3, Saturn-like: faint C ring, tall structured B ring, Cassini-like division, A ring with an
  Encke-like gap (and a ringlet in it) and a Keeler-like gap, sharp outer edge; boundaries move with the seed.
- tau <= 0.3, Uranus/Jupiter-like: a diffuse dust sheet and seven narrow ringlets.
Self-contained, ASCII, every name prefixed `ring`.

## Photometry (`rings.glsl.ts`)

Chandrasekhar single scattering (Cuzzi et al. 2002): reflection `(wP/4) mu0/(mu0+mu) (1 - e^(-tau(1/mu+1/mu0)))`
on the lit face, transmission `(wP/4) mu0/(mu0-mu) (e^(-tau/mu0) - e^(-tau/mu))` on the unlit face (dense B
ring dark, C ring and gaps glowing), P a two-lobe Henyey-Greenstein phase function with an opposition surge,
a multiple-scattering gain for icy grains. Dusty rings scatter strongly forward: near-invisible front-lit,
glowing when the sun is behind them. Composed as premultiplied `(radiance, 1 - e^(-tau/mu))`. The planet's shadow
is the sun disc's overlap with the planet disc (physical penumbra), in sphere space for oblate giants.
Materials by composition (`ringMaterial.ts`): ice bright warm white, rock dark brown, dust reddish grey.

## Ring shadow on the planet: how the surface shaders switch

The surface shaders currently carry a local `ringProfile(u, seed)` + `ringShadow(P, sunDir, ring)` pair
(src/render/planet/surface/glsl/lighting.glsl.ts) that mirrors the old stub. To receive the shadow of the
rings the player actually sees:

1. Delete both functions from `lightingGlsl` and put `ringShadowGlsl` (from `planet/rings`) in their place
   (it defines `ringShadow(vec3 P, vec3 sunDir, vec4 ring)` with the same signature, plus the profile; it
   uses `fwidth`, so call it in uniform control flow, as `rocky.glsl.ts` / `giant.glsl.ts` do).
2. Build `uRing` with `ringUniformVector(body.rings)` = (inner km, outer km, peak tau, seed phase); the
   surfaces already build the same 4 numbers, so this only pins the seed formula in one place.
No other change: the call sites stay `ringShadow(posB, L, uRing)`.

## Limits

No spiral density waves / spokes / moon shadows. Edge-on the ring is a razor-thin line by construction.
Ring particles are not lit by planetshine.

Dev page: `dev/rings.html?view=oblique|front|back|edge|shadow|close|dawn&body=giant|ice&sun=az,el`.
