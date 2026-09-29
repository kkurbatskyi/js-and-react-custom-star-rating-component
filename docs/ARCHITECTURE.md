# Sidereal — Architecture

> *This repository used to hold a star-rating component. Now it rates actual stars.*

Sidereal is a browser-based, procedurally generated galaxy explorer. One continuous camera
zooms from a 100,000-light-year spiral galaxy down to the cloud tops of a single planet —
roughly twenty orders of magnitude with no loading screens. Every star is generated
deterministically from a seed and can be visited, studied and **rated**.

This document is the contract between modules. Read it fully before writing code.
The TypeScript contracts it refers to are the source of truth:

| Contract | File |
|---|---|
| Data model (stars, planets, orbits, navigation) | `src/core/types.ts` |
| Visual modules (camera-relative rendering) | `src/render/contracts.ts` |
| Engine (layers, camera snapshot, picking, labels) | `src/engine/contracts.ts` |
| Universe facade (the only way UI/engine read generated data) | `src/universe/contracts.ts` |
| App state (zustand store) | `src/state/contracts.ts` |
| Audio | `src/audio/contracts.ts` |

---

## 1. Pillars

1. **Breathtaking** — cinematic HDR rendering, bloom, physically-motivated colour. The first frame must make someone say "wow".
2. **Seamless** — one camera, continuous logarithmic zoom, smooth van Wijk–Nuij flights between any two places.
3. **Grounded** — real astrophysics: Kroupa IMF, mass–luminosity–radius relations, blackbody colour, Kepler orbits, Kopparapu habitable zones, frost lines, Sudarsky gas-giant classes, tidal locking.
4. **Delightful** — wry guidebook prose, star ratings, a logbook, generative ambient music, shareable deep links.
5. **Zero assets** — every pixel and every sound is procedural. No image, texture, model or audio files ship.
6. **Runs everywhere** — desktop and phone, WebGL2, adaptive quality, touch + mouse + keyboard.

## 2. Stack

- **TypeScript 7** (strict), **Vite 8**, ES2022 modules.
- **three.js r186** (WebGL2, GLSL ES 3.00 via `ShaderMaterial`/`RawShaderMaterial`, `glslVersion: THREE.GLSL3` preferred).
- **postprocessing 6.39** (pmndrs) for HDR post: mipmap-blur bloom, ACES tone mapping, SMAA, custom effects.
- **React 19** for the UI overlay only; **zustand 5** for state. The 3D engine is imperative and never re-renders React per frame.
- **Vitest 5** (unit, `happy-dom` for UI tests), **Playwright 1.56** (e2e + screenshots), **Biome 2** (lint + format).
- No WebGPU, no WASM, no workers required (a worker is allowed as an optimisation if it falls back gracefully).

## 3. Layout & ownership

```
src/
  core/        math, rng, hash, units, colour (blackbody), noise (TS), formatting, shared types
  gen/
    galaxy/    galaxy structure model (density, arms, dust)            — GalaxyModel
    stars/     sector star catalogue, stellar physics, star details
    names/     procedural names & designations
    systems/   planetary system formation, bodies, rings, belts, habitability
    text/      guidebook prose & survey ratings
  sim/         Kepler orbits, body orientation/spin, time helpers
  universe/    Universe facade: caching, queries, search, home/random picks
  state/       zustand store
  engine/      renderer, layer stack, camera rig & flights, input, picking, labels, quality
  app/         composition: concrete layers wiring visuals + universe + store; boot
  render/
    post/      PostFX (HDR pipeline shared by engine and dev harness)
    shaders/   shared GLSL chunks (noise, hashing, colour)
    galaxy/    GalaxyVisual
    starfield/ StarfieldVisual (catalogue stars as points)
    star/      StarVisual (close-up star, corona, flares; exotic objects)
    planet/    PlanetVisual (surface/, atmosphere/, clouds/, rings/)
    system/    orbit lines, asteroid belts, habitable-zone & ecliptic grid
    fx/        post effects (warp/travel, lens flare)
  ui/          React overlay (panels, search, logbook, StarRating, …)
  audio/       generative audio director
dev/           standalone harness pages for developing a module in isolation
scripts/       tooling (screenshots, artifact build)
tests/e2e/     Playwright tests
docs/          architecture & science notes
```

Every module directory gets a short `README.md`: public API, design notes, known limits.

## 4. Frames of reference, units, precision

| Frame | Origin | Axes | Units | Used by |
|---|---|---|---|---|
| **G** galactic | galactic centre | Y = galactic north, disk in XZ | light-years | galaxy model, star positions, galaxy & starfield layers |
| **S** system | the star | Y = ecliptic north, ecliptic in XZ | km | orbits, system & planet layers |
| **B** body-fixed | body centre | Y = spin axis | km | planet surfaces, rings (equatorial plane) |

- `StarSystem.eclipticToGalactic` rotates S-vectors into G axes (each system has its own tilt — the galaxy's band crosses a system's sky at an angle, like the Milky Way does ours).
- JS numbers are float64 — **all CPU math is double precision** (`THREE.Vector3` is fine on the CPU). Precision is lost only when values reach the GPU as float32.
- **Camera-relative rendering** (see `src/render/contracts.ts`): each layer camera is at the origin; objects are placed at `(objectPos − cameraPos)` computed in float64 and rotated into layer world axes (G-aligned). Geometry vertices stay small relative to their object origin.
- Hierarchical camera position: when inside a system, the authoritative camera position is `(systemId, systemKm)`; `galacticLy = star.posLy + rotate(eclipticToGalactic, systemKm) / KM_PER_LY` is derived for the galaxy/starfield layers. Outside systems, `galacticLy` is authoritative.
- Physical constants: `src/core/units.ts` (`KM_PER_AU`, `KM_PER_LY`, `SOLAR_RADIUS_KM`, …). Never hard-code them elsewhere.

## 5. Render pipeline

```
 frame ─▶ sim clock ─▶ camera rig (focus + orbit + flight) ─▶ CameraSnapshot
       ─▶ layers.update(frame)  (each computes camera-relative transforms, picks near/far)
       ─▶ HDR target (RGBA16F):  galaxy ▸ starfield ▸ system ▸ planet   (depth cleared between)
       ─▶ PostFX: [travel/warp] ▸ bloom (mipmap blur) ▸ lens flare ▸ ACES tone map ▸ SMAA ▸ grain/vignette
       ─▶ DOM label overlay (imperative, pooled) + React UI overlay
```

| Layer | Units | Contents | Active when |
|---|---|---|---|
| `galaxy` | ly | GalaxyVisual (particles + diffuse glow + dust + nebulae) | always (it is the sky) |
| `starfield` | ly | StarfieldVisual — catalogue stars around the camera, magnitude-limited | camera within ~3 kly of the disk |
| `system` | km | StarVisual, lite PlanetVisuals, OrbitLines, belts, HZ/grid | camera within the focus star's system radius |
| `planet` | km | full PlanetVisual of the focused body (+ its moons) | focus is a planet/moon and camera is near it |

**HDR conventions** (every shader must follow these so modules look coherent together):
- Output **scene-linear** HDR colour in linear-sRGB primaries. No tone mapping or gamma in material shaders (`toneMapped: false`, the post chain handles it).
- 1.0 ≈ diffuse white under a "normalised sun" (planet `sunIntensity` ≈ 1). Bloom threshold ≈ 1.0.
- Star photospheres 8–40, coronas/glows fall off from ~4. Galaxy core ~2–6. Lava / city lights 1.5–4.
- Additive blending for light (stars, glows, galaxy particles); premultiplied alpha for atmospheres/clouds.
- Exposure is fixed at 1.0 (the engine may add mild auto-exposure later — do not bake exposure into shaders).
- Colours from data (`colorRGB`, palettes) are linear. Use `src/core/color.ts` for blackbody conversion.

**Transitions** are cross-fades driven by camera distance, passed to visuals as `intensity`/`opacity`
(0..1): e.g. a star's point sprite (starfield) fades out as its StarVisual (system layer) fades in.

## 6. Procedural generation

Seed hierarchy (all via `hash32` / `Rng.fork` in `src/core`, never `Math.random`):
```
galaxySeed ─▶ sectorSeed = hash32(galaxySeed, sx, sy, sz)
           ─▶ starSeed   = hash32(sectorSeed, i)
           ─▶ system     = createRng(starSeed).fork('system') …  planet k: .fork('planet').fork(k) …
```
**Determinism is sacred**: the same id must produce the same object forever — deep links and user
ratings depend on it. Adding a feature must not change existing output: use a new `fork(label)`
stream instead of drawing more numbers from an existing one.

### 6.1 Galaxy model (`src/gen/galaxy/model.ts`)
Cylindrical R = √(x²+z²), θ = atan2(z, x).
- Disk: `exp(−R/Rd) · sech²(y/hz) · taper(R)`, Rd ≈ 11 kly, hz ≈ 900 ly, soft edge near `radiusLy`.
- Log-spiral arms: arm *k* ridge at `θk(R) = φ0 + 2πk/K + ln(R/R0)/tan(pitch)`; `armFactor` = Gaussian of the
  perpendicular distance to the nearest ridge (width ≈ 2.5–3.5 kly), modulated by low-frequency noise for flocculence.
- Bulge: flattened Plummer-like `(1 + (r_b/a)²)^−2.5`, optional bar (elongated Gaussian), sparse halo.
- Dust: thinner disk (hz ≈ 250–350 ly), concentrated slightly *inside* each arm ridge (dust lanes on the concave side).
- `youngFraction` tracks arms (blue OB associations, pink HII knots); `bulgeFraction` the old yellow-orange core.
- Calibration: `stellarDensity ≈ 0.004 stars/ly³` at R ≈ 26 kly midplane between arms (≈ solar neighbourhood).

### 6.2 Star catalogue (`src/gen/stars`)
- Cubic sectors of `SECTOR_SIZE_LY` (32 ly). Star count ~ Poisson(density × volume), capped per sector (~4096).
- Masses from the **Kroupa IMF**; populations tilt by `youngFraction`/`bulgeFraction` (more O/B in arms, more old giants in the bulge).
- Main sequence: piecewise mass–luminosity (L ∝ M^4 … M^3.5 … M^2.3 at low mass), mass–radius, `T = 5772 K · (L/R²)^¼`.
- Evolved stars by age: subgiants, red giants (K/M III), rare supergiants, white dwarfs (~6%), rare neutron stars and stellar black holes (visual showpieces).
- Sector `(0,0,0)` index 0 is reserved for the central supermassive black hole.
- Sectors are sorted by luminosity, so magnitude-limited queries can stop early.

### 6.3 Planetary systems (`src/gen/systems`, `src/sim`)
- Planet count and spacing by stellar mass/metallicity; roughly geometric spacing (ratios 1.4–2.2) from ~0.03–0.4 AU × √L.
- Frost line `2.7 AU · √L`; habitable zone (Kopparapu 2013, simplified) `[√(L/1.1), √(L/0.53)] AU`.
- Types by distance, mass and temperature (see `PlanetType`); hot Jupiters are rare; gas giants favour just beyond the frost line.
- `T_eq = 278.6 K · L^¼ · a^−½ · (1−A)^¼`; greenhouse from atmosphere; oceans only when water is liquid.
- Close-in planets of low-mass stars are tidally locked (eyeball worlds!). Moons around giants (2–8) and some terrestrials; rings on ~30% of gas giants.
- Life: microbial → vegetation → (very rare) civilisation, gated by habitability and stellar age. Civilisations show city lights on the night side.
- Every planet and system gets a **guidebook blurb** and a **surveyor's rating** (1–5).

### 6.4 Orbits & time (`src/sim`)
- Kepler's equation solved by Newton–Raphson; positions in frame S (km).
- Simulation clock `simDays` (days since the J2000 epoch, starting at the real current date); `timeScale` = sim seconds per real second.
- Body orientation = ecliptic/parent frame × axial tilt × spin(`simDays / rotationPeriod`).

## 7. Navigation model (engine)
- The camera orbits a **focus** (`FocusTarget`) at a log-scaled distance with yaw/pitch relative to the focus's reference frame (G for galaxy/star focus at galactic distances; S for bodies).
- Flights use the **van Wijk–Nuij** optimal zoom-and-pan path (as in map "flyTo"), in log-distance space, computed *relative to the destination* so precision is perfect on arrival.
- Levels: `planet` when focused on a body and near it; `system` when inside the focus star's system radius; otherwise `galaxy`.
- Input: drag = orbit, wheel/pinch = zoom (towards cursor in galaxy view), right-drag/two-finger = pan (galaxy view), click = select, double-click = fly to, Esc = up a level. Keyboard orbit/zoom for accessibility.
- Deep links: `location.hash` holds a bare token — a `StarId`, `PlanetId` or `MoonId` (only `[A-Za-z0-9._~-]`).

## 8. Performance budgets & quality

| | low | medium | high | ultra |
|---|---|---|---|---|
| render scale cap | 0.75× | 1× | 1.5× DPR | 2× DPR |
| galaxy particles | 80k | 150k | 300k | 500k |
| galaxy volume pass | off / ¼ res | ¼ res | ½ res | ½ res |
| planet bake (per cube face) | 256² | 512² | 1024² | 1536² |
| atmosphere samples | 8 | 12 | 16 | 24 |

- Target 60 fps at 1080p on an integrated laptop GPU (Iris Xe / M1) at `medium`; phones default to `low`.
- `auto` quality: engine adapts render scale continuously from frame time.
- JS per frame < 4 ms; draw calls < 200; first galaxy frame < 1.5 s on desktop.
- Dispose every GPU resource you create. No per-frame allocations in hot paths (reuse vectors).

## 9. Visual direction

**3D** — cinematic realism, reference: Hubble/JWST imagery, NASA planetary photography, Space Engine.
- Galaxy: warm yellow-white core, blue-white arms beaded with pink HII knots, dark brown dust lanes; edge-on it shows a thin dust lane. From inside the disk it becomes a luminous band across the sky.
- Stars: blackbody colours with ~1.25× saturation boost (true blackbody colours are pale). Diffraction spikes only on bright stars. Close up: granulation, limb darkening, corona.
- Planets: physically plausible palettes; crisp terminators with a soft atmospheric rim; oceans with specular glint; clouds that cast the eye; gas giants with flowing bands and storms; rings with shadows.
- Motion is slow and majestic. No cartoon saturation, no neon.

**UI** — "a classical star atlas meets an observatory instrument panel".
- Deliberately dark, single theme. Glassy ink panels over the 3D view, hairline rules, tick marks, catalogue numbers.
- Type: display `Cormorant Garamond` (names, wordmark — small caps, generous tracking), UI `IBM Plex Sans`, data `IBM Plex Mono` (tabular numerals). Loaded from Google Fonts with system fallbacks.
- Design tokens (CSS custom properties, defined in `src/ui/theme.css`, used by the engine's label overlay too):
  `--sd-ink` `--sd-panel` `--sd-line` `--sd-text` `--sd-text-dim` `--sd-accent` (stellar gold, ratings & primary actions)
  `--sd-accent-2` (Rayleigh blue, focus/interactive) `--sd-danger` `--sd-font-display` `--sd-font-ui` `--sd-font-mono`.
- Respect `prefers-reduced-motion`; everything keyboard-accessible; touch targets ≥ 44px.

## 10. Hosting constraints (the demo is also published as a sandboxed single-file page)
- No `alert/confirm/prompt`. Downloads (`<a download>`) may be blocked — photo mode must also offer an in-page preview.
- `localStorage` may throw — always wrap in try/catch and work without it.
- Only bare `#token` hashes survive — our ids are designed for that.
- External resources: Google Fonts only. Everything else is bundled.
- Audio starts only after a user gesture.

## 11. Development workflow

- `npm run dev` — Vite dev server (`--port N --strictPort` when several run at once; set `VITE_CACHE_DIR=node_modules/.vite-<name>` per server).
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `npm run build`.
- **Dev harness**: `dev/<module>.html` pages mount one visual under the real PostFX pipeline with orbit controls
  and a lil-gui panel (`dev/harness.ts`). They set `window.__READY__ = true` once frames have rendered.
- **Screenshots**: `node scripts/shot.mjs <url> <out.png> [--size=1280x720] [--wait=ms] [--timeout=ms]` renders
  with headless Chromium (SwiftShader WebGL2 — slow but exact) and prints console errors. Open the PNG to look
  at your work. Iterate visually; do not guess.
- Debug handle in the app: `window.__SIDEREAL__ = { store, engine, universe }`.

## 12. Code conventions
- Strict TypeScript, no `any` (use `unknown` + narrowing). Named exports. Classes/components in `PascalCase.ts(x)`, modules `camelCase.ts`.
- GLSL lives in `*.glsl.ts` files exporting template strings tagged with `/* glsl */`. Share chunks via `src/render/shaders`.
- Comments explain *why*; generation code cites the formula/source it implements.
- No `Math.random()` in anything that affects generated content. (Fine for film grain.)
- No per-frame allocations in hot paths; no `console.log` left behind (use `src/core/log.ts`).
- Tests live next to code as `*.test.ts(x)`.
