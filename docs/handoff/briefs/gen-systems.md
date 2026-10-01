# Brief: GEN-SYSTEMS (name: planetologist, dev port 5310 if needed)

You are the planetary scientist-engineer and the guidebook's author. Every star gets a plausible,
surprising, deterministic planetary system with prose that makes people want to visit.

## You own
src/gen/systems/**, src/gen/text/**, src/sim/** (take over from the core agent; keep existing exports).

## Build
1. `generateSystem(star: StarDetails, galaxy: GalaxyModel): StarSystem` (src/gen/systems/index.ts) filling
   EVERY field of the contract types. Deterministic from star.seed via rng forks (a new feature = a new fork
   label, never extra draws on an existing stream). Performance: < 1 ms average.
2. Architecture of systems: planet count by star kind (M dwarfs 1–7 compact TRAPPIST-like systems; FGK 2–10;
   giants lost inner planets; white dwarfs/neutron stars 0–2 (pulsar planets!); black holes none);
   metallicity raises giant-planet odds; spacing roughly geometric (period ratios, near-resonances are a
   nice touch); frost line & Kopparapu HZ per ARCHITECTURE §6.3; inclinations Rayleigh(~2°), eccentricity
   Rayleigh(~0.05) with rare eccentric outliers; `eclipticToGalactic` random orientation (seeded).
3. Bodies: mass→radius via Chen & Kipping 2017 (rocky/Neptunian/Jovian regimes, with scatter);
   density, gravity, escape velocity; T_eq = 278.6·L^¼·a^−½·(1−A)^¼ K; atmospheres by retention (Jeans
   parameter from escape vs thermal velocity) & temperature → composition (N₂/O₂ with life, CO₂, H₂/He,
   CH₄, SO₂, thin/none) with greenhouse warming; oceans only where water is liquid; ice coverage; volcanism
   (tidal heating for close moons!); craters for airless; Sudarsky class for giants from temperature;
   tidal locking (M-dwarf HZ planets usually locked → "eyeball worlds"), obliquity, rotation periods;
   `axialAzimuthRad`. Types per PlanetType with sensible boundaries (lava when T > ~1000 K, hothouse when
   thick CO₂ and hot, ice when cold, etc.). Rings on ~30% of gas giants, fainter on ice giants, rare on
   others. Moons: giants 2–8 (sizes, some icy, a volcanic Io, maybe a hazy Titan), terrestrials 0–2;
   orbits inside the Hill sphere, prograde mostly. Belts: a main belt inside the first giant beyond the frost
   line when a gap exists; sometimes an outer Kuiper belt.
4. Life & habitability: habitability index (ESI-like from radius, density, temperature, escape velocity);
   life gated by habitability, liquid water and stellar age: microbial → vegetation → civilisation (very
   rare, ~1 in several hundred habitable worlds — it lights city lights on the night side).
5. Names: planets `${star.name} ${letter}`; notable planets (habitable, civilised, extreme, gorgeous)
   get a proper name via `properName` from src/gen/names (being written concurrently by the cartographer;
   if missing, use a temporary local fallback and switch when it lands). Moons: `${planetName} I, II…`.
6. **Guidebook** (src/gen/text): witty, informative, specific prose — Hitchhiker's Guide meets National
   Geographic. System blurbs & planet blurbs built from facts (e.g. "a year here lasts nine days",
   "the sunset never ends", "its rings would span the daytime sky", "surface gravity 2.3 g — bring
   knees"), large template variety with conditional clauses so neighbouring systems never read alike;
   British or American spelling consistently (pick one). Tags ("eyeball world", "super-Earth", "ringed",
   "hot Jupiter", "tidally heated", "pulsar planet"…). **Surveyor's rating** 1–5 (0.5 steps) from beauty +
   habitability + novelty, with a sensible distribution (5 stars must be genuinely rare).
7. src/sim: refine as needed; add `bodyPositionKm(system, bodyId, simDays, out)` (planets and moons in frame S)
   and `bodyWorldOrientation` helpers the engine can call per frame without allocations. Keep existing
   exports stable (the engine is using them).
8. Tests: every field populated & finite; determinism; Kepler III consistency; HZ planets exist at a
   plausible rate; type distribution sanity; performance. Add a stats test that generates 5,000 systems and
   prints distributions (types, rings, moons, HZ, life levels, ratings) — include the table in your report,
   plus 5 sample blurbs you're proud of.

## Addenda from the architecture review (binding)
- BodyBase now carries `oblateness`, `rings`, `habitability`, `blurb`, `surveyRating`, `tags` and
  `appearance: AppearanceHints` — MOONS need all of these too (moons are selectable and rateable).
- `appearance` is the canonical colour/coverage source for every renderer and the UI: plausible LINEAR sRGB
  surfaceColors (dominant first; vegetation tinted by the host star's spectrum: M → dark purple/black, K → deep
  red-brown, G → green, F/A → blue-green), oceanColor, cloudCoverage & cloudColor (hothouse ≈ 1), hazeColor (limb
  tint; null if airless), nightLights (civilisations), lavaGlow, swatch. Giants: surfaceColors = band colours by
  Sudarsky class. Unit-test ranges.
- `StarSystem.radiusKm = max(1.5 × outermost orbit/belt edge, 2000 × stellar radius, 1 AU)`.
- src/sim: add `bodyPositionKm(system, bodyId, simDays, out)` (planets & moons in frame S, allocation-free) and
  document the spin-axis / axialAzimuthRad convention in src/sim/README.md (keep whatever the core agent defined).
