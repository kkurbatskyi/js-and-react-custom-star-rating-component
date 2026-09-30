# src/app — composition root

`boot(canvas, options?)` (called by `src/main.tsx`, which also mounts the React overlay in `#app`)
builds everything and reports progress into `store.boot` ("Seeding 180 billion stars…",
"Igniting the galactic core…", "Calibrating the star-rating instrument…", "Plotting a course…"),
pre-warms shader programs, then flags `store.ready` and `window.__READY__` after real frames.
Stacking: canvas (z 0) ▸ engine labels (z 1) ▸ React UI (z 2).

| File | Role |
|---|---|
| `boot.ts` | composition: engine, layers, store sync, input, labels, audio, FX, engine commands (`zoomBy`, `resetView`, `capture` = render + `toBlob` in one task), deep link on boot, debug handle |
| `StoreSync.ts` | store ⇄ engine: `navRequest` / `timeRequest` by seq, time scale & pause, settings (quality, bloom, orbits, reduced motion, auto-rotate, **galaxy seed → new universe, caches cleared, layers rebuild**), ≤ 10 Hz `setFromEngine` (level, focus, distance, flight progress/target, simDays, cameraLy), arrival (`markVisited`, `remember`, "Arrived at X · n planets" toast when entering a system), `location.hash` sync + `hashchange` |
| `deepLink.ts` | `[seed~]id` tokens (seed only off the default), parse/format (tested), `replaceState` writer |
| `interaction.ts` | what gestures mean: drag orbit, right/two-finger pan (galaxy view; orbits elsewhere), wheel/pinch zoom (towards the cursor in galaxy view), tap select, double tap fly (empty sky: zoom in there), Esc up (or leave photo mode; not while a panel is open), F fly to selection, Space pause, H photo mode, [ ] time scale |
| `AudioBridge.ts` | audio director: unlock on the first gesture when enabled (store subscription keeps `unlock()` inside the click that enabled audio), scene morphs, travel drone, sfx |
| `fx.ts` | optional HDR effects discovered with `import.meta.glob` (installed only if the factories exist) |
| `warmup.ts` | `compileAsync` (sync `compile` without KHR_parallel_shader_compile) on the home system's real assets |
| `debug.ts` | `window.__SIDEREAL__ = { store, engine, universe, debug }` |
| `layers/` | the four layers (below) and their shared helpers |

## Layers (`layers/`)

| Layer | Units | Active | Notes |
|---|---|---|---|
| `GalaxyLayer` | ly | always | labels the core and "You are here" only from > 4 kly |
| `StarfieldLayer` | ly | < ~3 kly from the disk | `queryBlocks` (time-sliced; re-query while pending or after 2 ly), rebase after 50 ly, hides the focus star over the outer 40 % of its system radius, names via cached `getRecord`, star labels: 14 galaxy / 4 system / 0 planet |
| `SystemLayer` | km | inside the active system | StarVisual (fades in exactly as the starfield point fades out), lite visuals for every body not owned by the planet layer, orbits (fade inside the focus's planet zone), belts, markers & labels, picking, occluders |
| `PlanetLayer` | km | `planet` level | the focus's local group (planet + moons), exact positions relative to the anchor, lite → full at 28 px radius (20 px back), full visuals prepared 3 ms/frame from the moment a body is the focus *or the flight destination*, eclipse occluders, same-layer label occlusion |

`SystemAssets` holds a system's visuals and per-frame body state (positions, orientations, lighting:
sun direction, angular radius, artistic intensity `clamp((L/d²)^0.2, 0.4, 2)`), shared by both
in-system layers: handing a body from one layer to the other is the same object — no pop. LRU of 3
systems; `FullVisualCache` keeps 3 full planet visuals. `depthSlices.ts` (tested) splits depth ranges
at gaps with balanced far/near ratios ≤ 2·10⁴.

## Debug handle

```js
const { debug } = window.__SIDEREAL__;
debug.jumpTo('1.399.0.-276.0.d', { distanceKm: 3e4, yaw: 0.6, pitch: 0.3 }); // radians, target frame
debug.flyTo('1.399.-1.-277.1', { at: 0.5 });  // start a flight and freeze it at mid-path
debug.freeze(true); debug.setSimDays(9800); await debug.frames(3); debug.select('1.399.0.-276.0.f');
debug.state(); // { level, focus, anchor, distanceKm, systemId, flight, simDays }
```

`dev/engine.html` is a flight lab over the same boot (GUI + HUD; `?from=&to=&t=` for scripted shots).
