# src/core — foundations

Pure, dependency-light building blocks used by every other module. No barrel file: import from
the individual modules (`import { createRng } from '../core/rng'`). `types.ts` is the shared data
contract (owned by the lead).

## Determinism (read this first)
`hash.ts`, `rng.ts` and `noise.ts` define the universe. Their algorithms, constants and draw
accounting are **frozen** — the tests pin golden values. Never use `Math.random()` for content.
Add new randomness through a new `rng.fork('label')` stream rather than extra draws from an
existing stream, so existing stars, planets and deep links never change.

## Modules

### `units.ts` — constants & conversions
IAU 2012/2015 and CODATA 2018 values: `KM_PER_AU`, `KM_PER_LY` (Julian), `AU_PER_LY`, `KM_PER_PC`,
`LY_PER_PC` (≈ 3.26156), `SOLAR_RADIUS_KM`, `EARTH_RADIUS_KM`, `JUPITER_RADIUS_KM`, `G_SI`,
`GM_SUN_SI`, `GM_EARTH_SI`, `SOLAR_MASS_KG`/`EARTH_MASS_KG` (= GM / G, so Kepler's law is
self-consistent), `JUPITER_MASS_EARTH`, `SOLAR_MASS_EARTH`, `SOLAR_TEMP_K`, `SOLAR_LUMINOSITY_W`,
`STEFAN_BOLTZMANN_SI`, `MOLAR_GAS_CONSTANT`, `BOLTZMANN_SI`, `ATOMIC_MASS_UNIT_KG`,
`SECONDS_PER_DAY`, `DAYS_PER_YEAR` (365.25), `DAYS_PER_MONTH`, `J2000_UNIX_MS`, … and converters
(`kmToAU`, `auToKm`, `lyToKm`, `kmToLy`, `pcToLy`, `solarMassesToKg`, `daysToYears`, …).
`SECTOR_SIZE_LY` is deprecated — use `BASE_CELL_LY` / `cellSizeLy` from src/universe/contracts.ts.

### `hash.ts`
`hash32(...ints)` — MurmurHash3 (x86_32) over int32 words + `fmix32` finaliser; inputs are truncated
with ToInt32 (`v | 0`: fractions dropped, modulo 2³², NaN → 0), so uint32 seeds hash losslessly but
raw fractional coordinates must go through `hashFloat`. Allocation-free twins `hash1…hash4` give
identical output. Also `hashString`, `hashFloat` (exact float64 bits, little-endian), `hashToUnit`,
`fmix32`.

### `rng.ts`
`createRng(seed): Rng` — SFC32 seeded through a SplitMix32-style mixer, 12 warm-up rounds;
~10 ns per draw (10⁷ `next()` ≈ 0.1 s). Draw accounting: `normal` = 2 draws (no cached spare),
everything else = 1, `fork` = 0. `fork(label)` = `createRng(hash32(seed, hashString(label) | label))`
and never advances the parent. Also `shuffleInPlace(rng, array)`.

### `math.ts`
`clamp`, `saturate`, `lerp`, `invLerp`, `remap`, `remapClamped`, `smoothstep`, `smootherstep`,
`logLerp` (geometric), `fract`, `mod`, `wrapAngle` → (−π, π], `wrapAnglePositive`, `degToRad`,
`radToDeg`, `TAU`, `logGamma` (Lanczos). Samplers: `uniformOpen`, `gammaSample` (Marsaglia–Tsang),
`poissonSample` (Knuth below λ = 10, Hörmann's PTRS above — exact and O(1)), `sampleExponential`,
`sampleLogistic`, `sampleLogNormal`, `samplePowerLaw` (IMF segments), `sampleUnitVector`.
Rejection samplers are bounded.

### `color.ts`
`blackbodyRGB(tempK)` integrates Planck's law against the CIE 1931 2° colour-matching functions
(Wyman–Sloan–Shirley 2013 fit), converts XYZ → linear sRGB (D65), clamps negatives, normalises to
max = 1, and memoises a 512-entry LUT uniform in mireds (1000–40 000 K; ≤ 0 or NaN → black).
Matches Mitchell Charity's reference table within 5/255. The Sun is `#fff1ea`, 3000 K `#ffb96e`,
10 000 K `#cdd9ff`. `blackbodyRGBInto(t, buffer, offset)` fills vertex buffers without allocating.
Also `saturateRGB` (chroma about luminance, keeps the peak — use 1.25 for stars), `srgbToLinear`,
`linearToSrgb`, `rgbToCss` (linear → '#rrggbb'), `cssToRgb`, `mixRGB`, `rgbLuminance`,
`spectralClassOf`, `spectralSubtypeOf` / `spectralTypeCode` ("G2", "M4.5" — Pecaut & Mamajek 2013).
All colours in data are **linear**; only CSS strings are gamma-encoded.

### `noise.ts`
`createNoise3(seed)` → seeded 3D simplex (Gustavson), ≈ [−1, 1], ~60 ns per call, allocation-free.
`fbm3`, `ridged3` (≤ 8 octaves, decorrelated octave offsets), `createFbm3(seed, opts)`.
CPU-side only; GPU noise lives in src/render/shaders and is not bit-identical.

### `format.ts` — UI strings
Instrument-panel typography: digit groups use a narrow no-break space (U+202F, from 5 digits:
"5772", "38 400"), values join units with a no-break space (U+00A0) so they never wrap, negatives
use the true minus (U+2212), trailing zeros are trimmed, non-finite input renders "—". (Testing
Library's default matcher normalises these spaces, so `getByText('4.24 ly')` works.)

| | examples |
|---|---|
| `formatNumber(x, { sig, decimals, keepZeros, group })` | 38 400 · 0.723 · 5.20 |
| `formatScientific`, `formatCount` | 9.39 × 10²⁰ · 410 billion |
| `formatDistanceKm` (m → km → AU → ly → Mly), `formatDistanceLy`, `formatLy` | 850 m · 384 400 km · 0.723 AU · 4.24 ly |
| `formatRadiusKm`, `formatRadiusSolar` | 6371 km (1 R⊕) · 0.0126 R☉ (1.38 R⊕) · 11.8 km |
| `formatMassEarth` (M♃ from 50 M⊕, kg below 0.001 M⊕), `formatMassSolar`, `{ long: true }` | 1 M⊕ · 1.2 M♃ · 1.2 Jupiter masses |
| `formatTemperature` (°C below 1500 K) | 288 K (15 °C) · 5772 K |
| `formatPeriodDays` | 1.34 ms · 27.3 h · 88 days · 11.9 yr |
| `formatPressureAtm`, `formatGravityG`, `formatDensityGcc`, `formatVelocityKms` | 0.0063 atm · 0.378 g · 5.51 g/cm³ · 640 m/s |
| `formatLuminositySolar`, `formatAgeGyr`, `formatAngle`, `formatMagnitude`, `formatPercent` | 1 L☉ · 320 Myr · 23.4° · +4.83 · 71% |
| `formatSimDate(simDays)` (any year; Hinnant's civil-from-days) | 2026-09-29 14:03 UTC |
| `formatTimeScale(simSecondsPerSecond)` | paused · real time · 10× real time · 1 h/s · 2 days/s · 1 yr/s |
| `romanNumeral(n)` | XIV |

### `log.ts`
`log` (root) and `createLogger(scope)` / `log.child(scope)` with `debug < info < warn < error`.
Production shows warn+; the dev server adds info; tests stay quiet. Debug is enabled by `?debug`
in the URL or `setDebugEnabled(true)` (persisted as `localStorage['sidereal:debug']`; storage and
location access are guarded). `setLogLevel(level | null)` overrides.

### `threeUtil.ts`
`tupleToVector3`, `tupleToQuaternion`, `vector3ToTuple`, `quaternionToTuple`, plus the scratch-object
rules for hot paths: module-private scratch objects, results written into a caller's `out`, never
return or share scratch objects across modules.
