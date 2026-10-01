# Pending integration items (for one engine/integration pass)
1. src/app/fx.ts: wire black-hole lensing — import createLensingEffect from src/render/star/lensing.ts, install pre-bloom,
   each frame call lensing.setState(starVisual.lens) (IStarVisual.lens?: LensState now in contracts).
2. Warm up black-hole + neutron-star shader programs at boot (renderer.compileAsync) — they compile on first visit.
3. Galactic core: bulge glow washes out the frame at engine exposure; the core black hole is barely visible. Dim/expose for core focus.
4. Orrery (when done): travel effect auto-discovered by fx.ts — verify; wire HabitableZoneVisual + EclipticGrid into SystemLayer.
5. Cartographer (when done) + planetologist (when done): swap getSystem → generateSystem (one-liner by design).
6. Re-verify planet deep link renders (planet-sculptor fixing).
7. Galaxy: HII near camera are dots; default seed arms slightly regular (cosmetic).
8. src/app/warmup.ts: renderer.compile skips invisible objects → planet programs not pre-warmed. Call `await visual.warm(renderer)`
   (or `prewarmPlanetPrograms` from src/render/planet/PlanetVisual.ts) for sample terran/giant visuals.
9. Ring shadows: planet surface uses a local copy of the ring radial profile — swap to sky-weaver's exported ringDensity chunk (see sky report).
