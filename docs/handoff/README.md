# Sidereal — build paused (handoff)

Status as of 2026-10-01 21:00 UTC, branch `claude/creative-project-build-4otvu1`. This folder holds the plan
for the unfinished work; delete it when the project is finished.

## The project

Sidereal is a browser galaxy explorer that replaced the old star-rating take-home ("This repository used to
hold a star-rating component. Now it rates actual stars."): a continuous zoom from a 100,000-light-year spiral
galaxy down to a planet's cloud tops, every star deterministic from a seed, every star open for study and a
rating. No asset files — everything is procedural. Stack: TypeScript 7, Vite 8, three.js 0.186 (WebGL2),
postprocessing 6.39, React 19 + zustand, Vitest, Playwright, Biome.

- Design doc: `docs/ARCHITECTURE.md`. Fixed interfaces: `src/core/types.ts` and `src/*/contracts.ts`.
- Preview (v2, published 2026-09-30 ~16:40 UTC): https://claude.ai/artifact/DmyuJ8bCJdGjare7sE9Kw7
- Commands: `npm ci`, `npm run dev`, `npm run check` (typecheck + lint + unit tests), `npm run e2e`,
  `npm run build:artifact` (→ `dist-artifact/sidereal.html`), `node scripts/shot.mjs <url> <png>` (headless
  screenshot; SwiftShader is slow, so pass a generous `--timeout=`).

## Health right now

- `npm run build` **fails**: `src/render/planet/atmosphere/atmosphere.glsl.ts` contains a duplicated
  vertex + fragment shader pair (TS2451, `atmosphereFragment` declared at lines 35 and 170) — the atmosphere
  work was cut off mid-edit by the usage limit. Keep the one pair `AtmosphereShell.ts` expects, then re-run
  `npm run check`.
- Unit tests: 527 pass in 55 files; `src/render/planet/sky.glsl.test.ts` cannot load because of the same error.
- Playwright e2e (`tests/e2e`) was green when last run on 2026-09-30; not re-run since.

## Done

- Tooling: CI + Pages workflows, single-file artifact build, dev harness pages (`dev/*.html`), screenshot script.
- Core: rng, hashing, noise, blackbody colour, units; Kepler / orientation / time simulation.
- Galaxy: density model and GPU renderer with adaptive exposure.
- Engine: layered camera-relative renderer (galaxy → starfield → system → planet), van Wijk–Nuij flights,
  input, labels, deep links (`#[seed~]id`), HDR post (bloom, ACES, SMAA).
- UI: panels, search, logbook, minimap, the StarRating (your rating per star), view insets.
- Stars: plasma photospheres, shared photometry, starfield, black holes (lensing shader) and neutron stars.
- Planets: GPU-baked procedural surfaces for every planet type.
- Universe: still serves MOCK data — the hand-authored home system "Aurelia" plus simple mock systems.

## Remaining work, in order

1. **Fix the build** (above).
2. **Atmospheres, clouds, rings** — `src/render/planet/{atmosphere,clouds,rings}`, ~2.6k lines written.
   Brief: `briefs/sky.md`. Left: atmosphere that looks right from orbit and at the limb (no facet lattice);
   rings with the planet's shadow, exporting a `ringDensity` GLSL chunk + uniform helper so planet surfaces can
   receive ring shadows; finish clouds; verify on the `dev/` pages.
3. **Orbits & system furniture** — `src/render/system`, `src/render/fx`, ~2k lines written. Brief:
   `briefs/orrery.md`. Left: orbit lines that stay kink-free right next to a planet, with the fading
   comet-tail gradient; asteroid-belt polish; new `HabitableZoneVisual` and `EclipticGrid`; check the travel
   effect and lens flare; module README.
4. **Star catalogue** — `src/gen/stars` is empty; `src/gen/names` has only `designation.ts` and
   `blocklist.ts`. Brief: `briefs/gen-stars.md`. Left: deterministic catalogue stratified by luminosity band
   (cells `32·2^ℓ` ly) behind `queryBlocks` / `getRecord` / `getStar` / `queryStars` / `nearestStar` /
   `randomStarId` / `search` / `remember` in `src/universe`; Kroupa-IMF stellar physics; proper-name
   generation; keep Aurelia on the home star.
5. **Planetary systems & guidebook** — not started. Brief: `briefs/gen-systems.md`. Left:
   `generateSystem(star, galaxy): StarSystem` in `src/gen/systems` (planets and moons with real physics,
   `appearance` colour hints, rings, belts, life, survey ratings), witty blurbs in `src/gen/text`,
   `bodyPositionKm` helpers in `src/sim`, and a 5,000-system statistics test.
6. **Integration pass** — the nine items in `INTEGRATION.md`: wire lensing into `src/app/fx.ts` and warm up
   the exotic-star shaders; galactic-core exposure; wire the habitable zone and grid into `SystemLayer`; swap
   `getSystem` → `generateSystem`; re-check the planet deep link; galaxy cosmetics; pre-warm planet programs
   in `src/app/warmup.ts`; use the shared ring-shadow chunk.
7. **Audio** (optional) — `src/audio` is a stub. Brief: `briefs/audio.md`.
8. **Finish** — root `README.md` (hero screenshots, the star-rating joke, features, controls, science,
   architecture, dev setup), `docs/SCIENCE.md`, `CLAUDE.md`; `npm run check` and `npm run e2e`;
   `npm run build:artifact`, scan the file for secrets and personal data, smoke-test, republish to the same
   artifact URL; delete `docs/handoff/` and the paused routine "Sidereal build: hourly resume check".

## Working rules

- `TEAM.md` and `briefs/COMMON.md` were written for agents working in parallel on one checkout (file
  ownership, frozen dependencies, token economy). Scratchpad paths in them appear as `<scratch>`.
- Camera-relative rendering: layer cameras sit at the origin; positions are computed in float64 on the CPU.
  Never pass raw `simDays` to a shader.
- Determinism: `GEN_VERSION = 1`. A new random feature gets a new rng fork label, never extra draws on an
  existing stream.
- Artifact hosting: one HTML file; stylesheets only from Google Fonts (fonts are self-hosted via
  @fontsource); web workers only as `?worker&inline`; no `alert`/`confirm`; `localStorage` may throw.
- Usage: work stopped when the account hit its weekly usage limit (resets 8 pm UTC). Before that, each
  5-hour window allowed about 45–60 minutes of four agents working in parallel.
