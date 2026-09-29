# dev/ — harness pages

Standalone pages that mount one visual under the real PostFX pipeline, with orbit controls, a
lil-gui panel and deterministic screenshots. `http://127.0.0.1:<port>/dev/` lists every
`dev/*.html` automatically (title + `<meta name="description">`).

```bash
VITE_CACHE_DIR=node_modules/.vite-<you> npx vite --port <PORT> --strictPort --host 127.0.0.1
node scripts/shot.mjs "http://127.0.0.1:<PORT>/dev/<page>.html?t=10&ui=0" shots/<page>.png --size=960x540
```

Reference pages: **`harness-demo.html`** (bloom, ACES mid-grey, sprites, camera-relative placement
1 AU out) and **`shaders.html`** (compiles and numerically tests `src/render/shaders`).

## Page template

`dev/my-thing.html`
```html
<!doctype html>
<html lang="en">
  <head>
    <title>My thing</title>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="One line for the dev index." />
  </head>
  <body>
    <script type="module" src="./my-thing.ts"></script>
  </body>
</html>
```

`dev/my-thing.ts`
```ts
import * as THREE from 'three';
import { MyVisual } from '../src/render/my/MyVisual';
import { createHarness } from './harness';

const h = createHarness({ title: 'My thing', cameraPosition: [0, 2, 8], target: [0, 0, 0] });
const visual = new MyVisual(/* … */);
h.scene.add(visual.object);

const WORLD_POS = new THREE.Vector3(1.5e8, 0, 0); // absolute position, any magnitude
const rel = new THREE.Vector3();                  // reused: no per-frame allocations

const params = { intensity: 1 };
h.gui.add(params, 'intensity', 0, 2);

h.onFrame((f) => {
  h.relative(WORLD_POS, rel);                     // = WORLD_POS − cameraWorldPosition (float64)
  visual.update(f, { positionKm: rel, intensity: params.intensity /* … */ });
});

void h.prepare(visual);          // only if it has prepare(renderer, budgetMs) (GPU bakes)
void h.waitFor(somethingAsync);  // anything else that must finish before a screenshot
h.start();
```

## How it works

OrbitControls drive a **proxy camera** in absolute space (float64). Each frame the **render camera**
(`h.camera`) sits at the origin with the proxy's orientation, as the contracts require. Place objects
at `absPos − h.cameraWorldPosition`, using `h.relative()` or `h.place(object, absPos)`.

## API — `createHarness(options) → Harness`

Options (all optional): `title`, `fov` (deg, 50), `near` (0.01), `far` (1e7), `cameraPosition`,
`target` (absolute; `[x,y,z]` or Vector3), `quality` ('high'), `gui` (true), `bloom`, `exposure`,
`background`, `simRate` (sim days per second, 1), `minDistance`, `maxDistance`.

| Member | |
|---|---|
| `renderer`, `scene`, `camera` | Render camera at the origin; set `fov/near/far` on it. |
| `proxy`, `controls` | Absolute-space camera and its OrbitControls. |
| `gui` | lil-gui root. The harness's own controls sit in a closed "Harness" folder. |
| `post` | The `PostFX` instance (`setHdrEffects`, `setBloom`, …; see `src/render/post/README.md`). |
| `params`, `quality` | URL parameters; resolved quality. |
| `cameraWorldPosition` | Proxy position, updated before `onFrame` callbacks. |
| `relative(absPos, out?)` · `place(obj, absPos)` | Camera-relative placement. |
| `onFrame(cb) → unsubscribe` | `cb(frame: VisualFrame)` before rendering; `frame` is reused. |
| `prepare(visual, budgetMs = 8)` | Calls `visual.prepare(renderer, budgetMs)` each frame until it returns true, as the engine does; holds `__READY__`. |
| `waitFor(promise)` | Holds `__READY__` until the promise settles. |
| `frames(n)` | Resolves after n more frames. |
| `probe(x, y)` | Display RGBA (0–255) at CSS px after the next frame: for numeric checks. |
| `start()`, `dispose()` | |

`window.__READY__` turns true once every `waitFor`/`prepare` has settled **and** 5 more frames have
rendered. `window.__HARNESS__` is the harness, handy with `shot.mjs --eval`.

## URL parameters

| | |
|---|---|
| `?t=12` | Freeze the animation clock at 12 s (dt = 0, grain frozen): **reproducible screenshots**. |
| `?cam=x,y,z&target=x,y,z` | Camera override. The GUI's *copy ?cam= link* writes both for the current view. |
| `?ui=0` | Hide GUI, title and stats. |
| `?quality=low\|medium\|high\|ultra` | Changing quality in the GUI reloads the page with this. |
| `?exposure=1.5` · `?bloom=intensity,threshold,radius` | PostFX overrides (any prefix, e.g. `?bloom=0` for no bloom). |
| `?days=9800&simRate=0` | Simulation clock start and rate. |
| `?dpr=2` | Device-pixel-ratio cap (default 1.5). |

## Screenshots — `scripts/shot.mjs`

```
node scripts/shot.mjs <url> <out.png> [--size=960x540] [--dpr=1] [--mobile] [--wait=300]
                      [--timeout=120000] [--eval=<js>] [--fullpage]
```
It uses headless Chromium with SwiftShader (slow but exact), waits for `__READY__`, runs `--eval`
(result printed as JSON), waits `--wait` ms and shoots. It prints deduplicated console
errors/warnings, page errors and failed requests. Heavy shaders take 10–60 s per frame, so raise
`--timeout`. Keep shots ≤ 1280×720. Example numeric check:
`--eval="__HARNESS__.probe(480, 270)"`.

## Rules for render code

- **Never pass raw `simDays` to a shader.** At today's J2000 offset (~9.8e3 days) float32 resolves
  only ~84 s. Pass phases computed on the CPU (float64), or `simDays − epoch` with a per-visual epoch.
- **No per-instance `#define`s in ShaderMaterials.** Each distinct define set compiles a new
  program (a hitch, and more memory). Use uniforms. Keep defines for quality tiers.
- **Web Workers only via `import Worker from './x.worker.ts?worker&inline'`**, so the single-file
  artifact build (`npm run build:artifact`) keeps working. Always provide a main-thread fallback.
- Scene-linear HDR output, `toneMapped: false`, no gamma. Shared GLSL comes from `src/render/shaders`.
- Dispose every GPU resource. No allocations in `onFrame`/`update` hot paths.

## Deployment note

`.github/workflows/pages.yml` deploys `dist/` to GitHub Pages on pushes to `main`. Enable it once
under repository **Settings → Pages → Source: GitHub Actions**.
