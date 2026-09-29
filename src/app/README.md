# src/app — composition root

`boot(canvas): BootHandle` is called once by `src/main.tsx`, which also mounts the React overlay
(`src/ui/App.tsx`) in `#app` above a full-screen canvas.

**Integration phase:** `boot.ts` is a temporary stand-in for the engine. It renders the galaxy
through the shared `PostFX` pipeline with a slowly orbiting camera-relative camera, runs the sim
clock, answers `navRequest`/`timeRequest` by jumping (no flights), writes throttled engine state,
exposes `window.__SIDEREAL__ = { store, universe }` and sets `window.__READY__` after 3 frames.
The engine specialist replaces it with the real layer stack; keep the `boot(canvas)` signature.
