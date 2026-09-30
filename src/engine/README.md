# src/engine — renderer, layer stack, camera, flights, input, picking, labels

The imperative 3D core. It knows nothing about the store, the UI or concrete visuals: `src/app`
composes those (layers, store sync, audio, FX, deep links). Contracts: `contracts.ts`
(`Layer`, `LayerRenderSpec`, `CameraSnapshot`, `FrameInfo`, `PickHit`, `LabelSpec`, `LabelTier`).

```ts
const engine = new Engine(canvas, { universe, quality: 'auto', simDays, timeScale: 3600 });
engine.setLayers([galaxy, starfield, system, planet]);        // far → near
engine.hooks.push({ beforeUpdate, beforeRender, afterRender }); // app wiring
engine.navigate({ kind: 'planet', id }, 'fly', reducedMotion);  // or 'jump'
engine.start();
engine.pick(x, y);  engine.collectLabels(out);  engine.screenRay(x, y, out);  engine.renderNow();
```

## Frame

`clock → hooks.beforeUpdate → rig.update (orbit | flight | fade) → CameraSnapshot → layers.update
(far → near; one PerspectiveCamera per layer at the origin, sharing the rig's orientation) → sun &
travel → PostFX (LayerStackPass + HDR effects) → hooks.afterRender`. The rAF loop stops while the tab
is hidden and never sees a giant dt afterwards (clamped to 0.1 s).

## Precision (the part to read first)

- **Authoritative camera state = (anchor focus, `offsetKm`)**, float64, galactic axes. Positions are
  hierarchical `GalacticPoint`s — star in G (ly) + body offset in S (km) — and `frames.relativeKm`
  differences two points *in S* when they share a star (exact to ~1e-8 km at 1e8 km) and through
  light-years only across systems (~30 km at 26 kly: irrelevant at interstellar range).
- `galacticLy`, `systemKm` are derived per frame; layers place objects at `R_SG·(posS − systemKm)`
  or, for the focus's local group, `R_SG·(posS − anchor.posS) − offset` — the focus itself sits at
  exactly `−offset`, so orbiting a moving planet at any time scale cannot jitter.
- **Van Wijk–Nuij** (`camera/vanWijkNuij.ts`): `r = −asinh(b)` (never `ln(−b + √(b²+1))`, which is
  ln 0 at b ≈ 1e13), pan fractions `u(s) = w(s)·sinh(ρs)/(ρ²cosh r0)` from the start and
  `u1 − u(s) = w(s)·sinh(ρ(S−s))/(ρ²cosh r1)` from the end, `w(s)` from the nearer end. `camera/flight.ts`
  anchors the camera at the start focus in the first half and the destination in the second, and
  re-evaluates the separation every frame (bodies move). Unit-tested at b = 1e13: the remaining
  distance 1e-9 path units before arrival resolves below a kilometre.
- No logarithmic depth: layers return **depth slices** (`src/app/layers/depthSlices.ts`) with tight
  near/far, boundaries placed in gaps between objects; `LayerStackPass` clears depth between them.

## Camera (`camera/`)

| File | |
|---|---|
| `focus.ts` | `FocusHandle`: resolved target + per-frame body position; min/max distance (planet: above the cloud tops; star: 1.3 R★ … system radius; galaxy: 0.5 ly … 250 kly), planet zone |
| `framing.ts` | orbit pose ↔ quaternion (`frame · R_Y(yaw) · R_X(−pitch)`), composed arrivals: 110 kly overview at 35°; systems at 2.5× the outermost orbit, 24° above the ecliptic; bodies at ~4 R (rings: 2.4 × outer ring), 20° up, **three-quarter lit** (50° from the sun in azimuth); azimuth chosen for minimal rotation |
| `CameraRig.ts` | damped yaw/pitch/log-distance in the focus frame (frame-rate independent, `damping.ts`), zoom towards the cursor and panning along the galactic plane for galaxy points, idle auto-rotate, hand-over to the parent when zooming out past the max, flights, reduced-motion fade-cuts. Discontinuities never show: a correction rotation `ideal⁻¹·actual` decays to identity |
| `flight.ts` | the flight between moving endpoints; duration `clamp(0.3 s × S, 1.5, 9)`; smootherstep easing; `travel` = normalised speed × how interstellar the hop is |
| `frames.ts` | G ↔ S conversions, `relativeKm`, `galacticLyOf`, `systemKmOf` |

## Levels (`levels.ts`)

The ONE `levelFor()` + `LevelTracker`: `planet` inside the focus body's planet zone, `system` inside
`StarSystem.radiusKm` of a candidate star — only the anchor's star or a flight endpoint, never a
search — else `galaxy`. Enter/exit hysteresis ×1.25 (planet) and ×1.1 (system).

## Input (`input/`)

`GestureRecognizer` (pure, tested): 1-pointer drag orbit (secondary button / modifier: pan),
2-pointer pinch zoom + centroid pan, tap / double tap with slop per pointer type; a 2 → 1 finger
transition continues as a drag without a jump. `keys.ts`: arrows/WASD orbit, +/− zoom (held), Esc,
F, Space, H, [ ] (pressed); ignored while typing or when Space/Enter would activate a control;
wheel normalisation (lines/pages → px, trackpad pinch = ctrl+wheel). `InputController` listens on the
canvas only (page scroll elsewhere is untouched) and maps gestures to app-provided `InputActions`.

## Picking & labels

`picking.ts`: layers are queried near → far; nearer layers' occluder discs discard farther hits and
labels (`PickHit.x/y` carry the object's screen position). `labels/LabelOverlay.ts`: pooled DOM, top 40
by priority (`LabelTier × 1000 + rank`), text measured once per string, greedy placement with a sticky
side (`labels/layout.ts`, tested), fade in/out (snaps while the clock is frozen, clears on cuts),
ring/dot markers, click = select, double-click = fly. Styled with `--sd-*` tokens (with fallbacks).

## Quality (`quality.ts`)

Pixel ratio = `min(devicePixelRatio, cap)` with caps low 0.75 · medium 1 · high 1.5 · ultra 2.
`'auto'` resolves to low on coarse pointers, medium otherwise, and runs `AdaptiveResolution`: an EMA
of the frame interval steps the render scale in [0.5, 1] × cap down after 0.8 s below ~77 % of the
refresh rate, probes up after 3 s at the refresh rate, and caps below a failed probe (no oscillation;
tested against a synthetic vsync-quantised GPU).

## View insets

`engine.setViewInsets({ top, right, bottom, left })` (CSS px covered by UI panels / bottom sheets):
the optical centre glides to the centre of the free rectangle via a three.js view offset on every
layer camera, so arrivals are composed where the user can see them. `screenRay`, the sun position and
all projection-matrix-based picking/labels account for it. Exposed to the UI as an extra
`engineCommands().setViewInsets` (feature-check it until `EngineCommands` declares it).

## Contract extensions (compatible)

`PickHit.x/y?` (hit screen position), `FrameInfo.travelDirection?` (view-space motion direction for
the travel FX), `Layer.setQuality?`.

## Limits / TODO

- `FrameInfo.sun.visibility` ignores partial occlusion (a disc either hides the sun or not).
- Picking is screen-space only (no ray casting against rings).
- The stack renders every slice with its layer's full scene; objects outside a slice are frustum-culled
  on the CPU (cheap), shader-expanded sprites are clipped on the GPU.
