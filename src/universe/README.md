# src/universe — the Universe facade

**The facade is the only data entry point.** The engine and UI read generated data exclusively
through `getUniverse(seed)` (contract: `contracts.ts`). Nothing outside this directory imports
`src/gen/*` generators directly.

```ts
import { getUniverse, DEFAULT_GALAXY_SEED, parseId, starIdOf, planetIdOf } from '../universe';

const u = getUniverse();            // memoised per seed (DEFAULT_GALAXY_SEED = 20260929)
u.homeStarId();                     // "1.399.0.-276.0" — Aurelia (G2V)
u.coreStarId();                     // "8.0.0.0.0" — the central supermassive black hole
u.getSystem(u.homeStarId());        // StarSystem (cached)
u.getBody(`${home}.d.1`);           // { system, planet: Halcyon, moon: Lanthorn }
u.queryBlocks({ observerLy, magnitudeLimit: 6.5 }); // StarBlocks for the starfield
u.search('aurel');                  // SearchResult[]
```

## Files

| File | Role |
|---|---|
| `index.ts` | `getUniverse`, the facade (caching, `queryBlocks`, `queryStars`, `nearestStar`, search, random picks), id helper re-exports |
| `ids.ts` | canonical id grammar: `formatStarId`, `parseId`, `starIdOf`, `planetIdOf`, `splitStarId`, … |
| `mock.ts` | **MOCK** catalogue: home star, ~300 local stars, core black hole, `StarBlock`s |
| `mockHome.ts` | hand-authored home system (Aurelia) |
| `mockBodies.ts` | body builder (derived physics, appearance hints, prose) + procedural systems |
| `mockPhysics.ts`, `mockNames.ts` | small relations / syllable names used by the mock |

## Mock phase — what is real and what is not

The real generators (`src/gen/stars`, `src/gen/systems`, `src/gen/names`, `src/gen/text`) will
replace the internals of `mock*.ts`; `index.ts` keeps its API and is written against the
`MockCatalog` shape (`stars`, `blocks`, `record/details/system`).

- **Catalogue**: only a ball of `MOCK_RADIUS_LY` = 80 ly around `galaxy.params.homeLy` (+ the core
  black hole). Class quotas follow the solar neighbourhood (M 74 %, K 12 %, G 7 %, F 3 %, A 1 %,
  giants, white dwarfs, one pulsar). Ids, levels (`levelForAbsMag`), cells (`cellSizeLy`), draw
  indices and seeds follow the contracts exactly:
  `cellSeed = hash32(galaxySeed, level, cx, cy, cz)`, `starSeed = hash32(cellSeed, index)`.
- **Home system (Aurelia, G2V, L = 1.05 L☉)**: lava world b, Mercury-like c (3:2 resonance),
  **Halcyon** (terran, vegetation, moon *Lanthorn*), desert e, ringed class-I gas giant f (Io,
  Europa, Titan, Callisto analogues), ice giant g (98° tilt, faint rings, retrograde Triton
  analogue + a dwarf moon), dwarf h (Pluto-like), a main belt and a Kuiper belt.
- **Every other star** gets a small procedurally-perturbed system (2–5 planets; remnants and giants
  1–3) so anything can be visited; every planet type, some life, and 4 civilisations exist nearby.
- Only the *inputs* of a body are chosen; periods (Kepler III, `sim/kepler.orbitalPeriodDays`),
  `T_eq = 278.6 K·L^¼·a^−½·(1−A)^¼`, surface temperature, density, gravity, scale height,
  oblateness (Darwin–Radau), habitability (ESI) and `appearance` hints are derived, so the data is
  consistent by construction (`universe.test.ts` checks it for every body).
- `queryBlocks` returns, per level, the cells whose box lies within the band's visibility reach
  `10 pc · 10^((m_lim − M_bright)/5)`; `pending` is always 0 (nothing to time-slice).
- Search covers all catalogue stars, the home system's bodies and bodies of `remember()`ed systems.
