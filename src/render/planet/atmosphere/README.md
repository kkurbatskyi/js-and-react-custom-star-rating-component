# planet/atmosphere — the thin blue line

A physically based scattering shell for `PlanetVisual`: Rayleigh + Mie + an absorber (ozone / methane),
single scattering with a multiple-scattering stand-in, raymarched analytically in the fragment shader. It
looks right from far space (a thin limb glow), from low orbit (the orange-to-blue sunrise band, horizon
haze), at the terminator, and from inside the shell.

```ts
import { createAtmosphere } from './atmosphere';
const shell = createAtmosphere(body, system, quality); // IAtmosphereShell | null (airless / no hazeColor)
root.add(shell.object);                                // child of the PlanetVisual root group
shell.update(frame, planetUniforms);                   // every frame; dispose() when done
```

Exports: `createAtmosphere`, `AtmosphereShell`, `deriveAtmosphere(body) -> AtmosphereParams | null`,
`MIN_PRESSURE_ATM`. The shell works in body space (Y = spin axis) and never re-transforms: the root group
already carries the position and orientation.

## How it works

- **Coverage mesh, analytic shading.** A back-face sphere 4% larger than the atmosphere only decides which
  pixels to shade (it covers the disc from outside and the whole screen from inside, one code path). The
  atmosphere and the planet are intersected analytically (`raySphere` from `shaders/common.glsl`), so mesh
  tessellation never shows (no facets, no dot lattice). All ray maths is relative to the interpolated mesh
  point, which sits near the planet, so nothing cancels when the camera is millions of km away.
- **Samples are placed by altitude.** Around the lowest point of the ray (ground hit, tangent point of a limb
  ray, or the camera when looking up) with quadratic spacing, in increasing t; the view transmittance
  accumulates in order and each step is integrated analytically (Hillaire 2020). 8 / 12 / 16 / 24 samples for
  low / medium / high / ultra (ARCHITECTURE section 8), nearly midpoint (a full stratified jitter shows as a dot
  lattice).
- **Sunlight** at each sample is one fetch of a transmittance table (`transmittance.ts`, Bruneton
  parametrisation: rho/horizon, d/d_max) built on the CPU (~4 ms) and uploaded as a half-float texture; the
  planet's shadow with a penumbra of the star's angular size multiplies it. Grazing sun rays through the lower
  atmosphere are what turn the sunrise band orange-red and leave deep blue above it.
- **Compositing dst * T + inscatter** in two draws sharing one program (`uPass`): a multiplicative pass
  (per-channel T: a star behind the limb reddens, the surface near the limb is tinted) then an additive one.
  Drawn at `RENDER_ORDER.atmosphere` (30) and 31, after the clouds and before the near half of the rings.
- **Analytic depth.** `gl_FragDepth` is the first atmosphere point on the ray (1% nearer, so a 24-bit depth
  buffer cannot z-fight the shell with the surface it hovers over): nearer opaque objects (moons) occlude the
  shell, the planet's own surface is hazed. `projectionMatrix` is read from three.js per render call, so
  depth slices with their own near/far work.
- **Oblate bodies** (giants): everything runs in sphere space `(x, y/(1-f), z)`; rays stay straight, the
  terminator stays where the surface shader puts it.

## Parameters from the body (`params.ts`, `deriveAtmosphere`)

`appearance.hazeColor` is the source of truth: it picks the class and tints the aerosol. Rayleigh optical
depth = Earth's (0.046, 0.108, 0.265 at 1 atm, 1 g) x (P/g) x (per-mass scattering of the gas mixture / air),
capped at 3 Earth columns; the scale height is stretched 1.3x (artistic: real limb photographs are taller than
single scattering predicts) and giants get at least 0.22% of R.

| class | when | aerosol | look |
|---|---|---|---|
| terran | blue haze | clear-sky AOD ~0.08, 2 km | blue limb, white base, ozone twilight (Chappuis) |
| dusty | non-blue haze, p < 0.6 atm | dust tau 0.22, blue absorbed | butterscotch limb, thin |
| hazy | non-blue haze, p >= 0.6 atm | tholin tau 2.6, strongly absorbing | opaque orange ball, tall glow |
| dense | p >= 6 atm | tau 3 | featureless yellow-white |
| gas-giant / ice-giant | by type | tau 0.7 / 0.3, methane absorber on ice giants | subtle blue-white / cyan limb |

## Limits

Single scattering plus a phase-blend and a per-class gain instead of true multiple scattering (thick hazes are
brightened by a class gain, so they read as bright but lose the physical shading). No refraction, no airglow,
no aurora, no ground-level ambient (the surface shader owns skylight). The oblate mapping is exact for the
terminator and approximate for path lengths (< 10%). A ground-hit ray and a just-grazing ray differ by the
far half of the path, so an opaque haze shows a faint circle at the planet's true limb.
Shader programs compile on first draw: `PlanetVisual.prepare` should include this object in its
`compileAsync` scene (see the sky report).

Dev page: `dev/sky.html?body=terran|desert|hothouse|ocean|titan|giant|ice&view=far|mid|limb|sunrise|low|
ground|sunset|dusk|terminator|crescent&sun=az,el` (`&real=1` uses the sculptor's `PlanetVisual`).
