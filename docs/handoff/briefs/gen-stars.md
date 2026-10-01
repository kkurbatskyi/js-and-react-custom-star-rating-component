# Brief: GEN-STARS (name: cartographer, dev port 5309 if needed)

You are the stellar astrophysicist-engineer: the star catalogue for ~10^11 stars, generated lazily,
deterministically and fast; plus names; plus the Universe facade that everyone reads from.

## You own
src/gen/stars/**, src/gen/names/**, src/universe/** (take over from the stub author: keep the facade API
in src/universe/contracts.ts EXACTLY; replace mock internals with real generation; keep mock.ts only if
tests still use it).

## Build
1. **Sectors** (`src/gen/stars/sector.ts`): cubic sectors of SECTOR_SIZE_LY (src/core/units.ts). Star count
   ~ Poisson(mean density × volume) — average `galaxy.stellarDensity` over a few points in the sector
   (the disk is thin near the core), capped (~4096). Positions uniform within the sector (optionally
   density-weighted in y). Sort by luminosity desc so index 0 is the brightest. seedOf(sector) via hash32.
   LRU cache (~2000 sectors). Sector (0,0,0) index 0 is the central supermassive black hole (~4×10⁶ M☉,
   with a great proper name).
2. **Stellar physics** (`src/gen/stars/physics.ts`): Kroupa IMF sampling (0.08–120 M☉); population by
   position (youngFraction boosts recent star formation → more O/B in arms; bulge → old, metal-rich);
   ages & metallicity; main-sequence relations (piecewise mass–luminosity, mass–radius, T from
   Stefan–Boltzmann: T = 5772·(L/R²)^¼); lifetime t_MS ≈ 10 Gyr·M^−2.5 decides evolution: subgiants,
   red giants (K/M III, R 10–100 R☉, L 50–1000 L☉), rare supergiants, white dwarfs (≈6%, R ≈ 0.012 R☉,
   hot/cooling), neutron stars and stellar black holes (rare showpieces — make them findable but rare,
   ~1 per few thousand stars). MK spectral types with subclasses + luminosity classes ("G2V", "M4.5V",
   "K1III", "B1Ia", "DA3"); absolute visual magnitude via a temperature-dependent bolometric correction.
   `colorRGB` from core `blackbodyRGB`. `starDetails(record)` → StarDetails (radiusKm, age, [Fe/H], rotation,
   activity (young M dwarfs high), pulsarPeriodSec, accretion).
3. **Names** (`src/gen/names`): pronounceable, beautiful proper names from several phonotactic "cultures"
   chosen by galactic region (so neighbourhoods feel coherent — e.g. Arabic-inspired classical star names,
   Latinate, Nordic, Polynesian-inspired, invented lyrical), with a blocklist against accidental offensive
   words. `properName(rng, culture)`, `cultureAt(posLy)`, designations for every star (catalogue style,
   parseable back to the id, e.g. "SDR 812-2-113 7" — your design, but unique & reversible). Notable stars
   (bright/giant/exotic, or within ~30 ly of home) get proper names; others keep designations. The systems
   agent will import `properName` for planets — export it early.
4. **Queries** (`src/universe/index.ts` + helpers): `queryStars(center, radius, {limit, magnitudeLimit,
   observerLy, completeRadiusLy})` — iterate sectors near→far, early-exit per sector when stars get too
   faint (sorted by luminosity). Targets: 150 ly query with magnitudeLimit 8.5 < 30 ms cold / < 5 ms warm.
   `nearestStar`, `getStar` (parse id → sector → index), `getSystem` (calls `generateSystem(details,
   galaxy)` from src/gen/systems — written concurrently by the systems agent; until it exists keep the mock
   fallback; LRU cache systems), `getBody`.
5. **Home**: deterministic scan of stars near `galaxy.params.homeLy` for the most wonderful G/K
   main-sequence system (habitable terran/ocean world with a moon, a ringed giant, ≥5 planets …). Cache it.
6. **randomStarId(kind, seed)**: sample sectors weighted towards the disk until a match (bounded).
7. **search**: index over remembered ids (+ their planets), notable named stars within ~300 ly of home
   (built lazily in idle slices — requestIdleCallback with setTimeout fallback), exact id / designation
   parse. Ranking: exact > prefix > word-start > substring > subsequence; ≤ 50 ms.
8. **Tests**: determinism across runs, IMF class proportions (M ~75%, K ~12%, G ~7%, F ~3%, A ~0.6%, B
   ~0.1%, O rare; giants ~1%; WD ~6%), density calibration near home (≈0.004/ly³), id/designation
   round-trips, query performance, name quality (length/charset/no blocklisted substrings).
   Report 10 sample names and the home system you picked.

## Addenda from the architecture review (binding — supersedes "Sectors" above)
- The catalogue is **stratified by luminosity band** — read src/universe/contracts.ts and ARCHITECTURE §6.2.
  Level ℓ: 1.5-mag bands (level 0 = M > 5.0), cells of 32·2^ℓ ly. StarId = `${level}.${cx}.${cy}.${cz}.${i}`
  with i = DRAW ORDER (stable), star seed = hash32(cellSeed, i). No luminosity sorting in ids.
- Per cell: count ~ Poisson(∫ stellarDensity × bandFraction(ℓ, population) dV) (sample the density at a few points;
  cells at high levels are large and the disk is thin), cap ~4096; draw each star conditioned on its band —
  e.g. build per-population per-band sample tables ONCE from a fixed seed (a few hundred thousand IMF+evolution
  draws, cached in memory) and pick+jitter from them. Validate: the union over levels reproduces the IMF class
  proportions and the unconditioned luminosity function.
- `queryBlocks({observerLy, magnitudeLimit, budgetMs})` → `{blocks, pending}`: for each level, cells whose nearest
  point is within the band's visibility radius for the limit; generate missing cells within the ms budget
  (nearest first), LRU-cache StarBlocks (struct-of-arrays, see types.ts), stable object identity while cached.
  Target: a full view at home (m_lim 6.5) ≈ 10–30k visible stars; ≤ 4 ms per call; warm calls ≈ 0.1 ms.
- `getRecord(id)` builds a StarRecord lazily from its block; `getStar` adds details; queryStars/nearestStar are
  small-radius (≤ 50 ly) helpers over level-0..N cells.
- Core SMBH id is "8.0.0.0.0" (`coreStarId()`); home via `homeStarId()`.
- Deep-link helpers in src/universe/ids.ts: `formatToken(seed, id)` / `parseToken(hash)` for `[seed~]id`
  (seed prefix only when ≠ DEFAULT_GALAXY_SEED); id validation.
- `remember()` accepts star or body ids (index planets/moons of remembered systems for search).
- Keep a frozen density used by the catalogue: if the galaxy painter re-tunes stellarDensity later, that's fine
  pre-release, but note GEN_VERSION semantics in your README.
