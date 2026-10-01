# Brief: ORRERY & FX (name: orrery, dev port 5307)

You build the instruments of the system view and the cinematic post effects.

## You own
src/render/system/** (replace stub OrbitLines & AsteroidBeltVisual keeping their contracts; add new
visuals), src/render/fx/**, dev/system.html + dev/system.ts, dev/fx.html + dev/fx.ts.

## Build
1. **OrbitLines**: elegant, anti-aliased, constant-pixel-width lines (custom screen-space line shader or
   three/examples Line2/LineMaterial), each orbit brightest at the body's current position and fading
   behind it along the orbit (a comet-tail gradient showing direction of motion), distance-based fade,
   highlight for `highlightId`, fade near `focusPositionKm` (so a line never slices through a close-up
   planet), moon orbits around the focused planet. Tasteful: thin, low-contrast, gold/blue-grey tints.
2. **AsteroidBeltVisual**: thousands of particles with Keplerian differential rotation computed in the
   vertex shader from simDays (ω ∝ r^−1.5), vertical thickness, varied sizes/albedo by composition, soft
   shimmer, sensible appearance from both far (a dusty band) and near (individual rocks as tiny lit
   sprites or instanced low-poly rocks).
3. New visuals (same Visual pattern, SystemFurnitureOptions): **HabitableZoneVisual** (a faint teal
   annulus in the ecliptic, soft edges) and **EclipticGrid** (a subtle polar grid/radial ticks in the
   ecliptic plane for scale, fading with distance). Export factories from src/render/system/index.ts.
4. **FX** (pmndrs `Effect` subclasses, HDR stage — the engine inserts them via PostFX.setHdrEffects):
   `createTravelEffect()` → { effect, setIntensity(0..1), setDirection(ndc vec2) } — hyperspace-style radial
   streaks of the existing image, gentle chromatic aberration, vignette pump; subtle at low intensity,
   dramatic at 1. `createLensFlareEffect()` → { effect, setSources([{ uv, color, intensity }]) } — tasteful
   physically-inspired flare for bright on-screen stars: halo, starburst, a few ghosts; fades near the edges.
   Document the APIs in src/render/fx/README.md for the engine.
5. dev/system.ts: renders the mock home system (universe facade) with stub/real star & planets plus your
   orbits/belts/HZ/grid, with a time slider. dev/fx.ts: a starfield scene demonstrating travel intensity
   0 → 1 and a flare source. Screenshot and iterate (reference: Space Engine / Universe Sandbox orbit views).

## Addenda from the architecture review (binding)
- Never pass raw simDays to shaders (float32 ≈ 84 s resolution at the J2000 offset): for belt rotation pass
  `simDays − epoch` with a per-visual epoch (captured at construction) or CPU-computed phases.
- The system layer will skip the focus body's local group (the planet layer draws it); orbit lines must still
  fade near `focusPositionKm`.
