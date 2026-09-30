# src/gen/galaxy — the galaxy structure model

`createGalaxyModel(seed)` returns a `GalaxyModel` (src/core/types.ts): analytic fields for stellar
density, arms, dust and stellar populations, plus a constructive sampler that places galaxy
particles ∝ light. Everything derives deterministically from the seed.

```ts
import { createGalaxyModel } from '../gen/galaxy/model';
const galaxy = createGalaxyModel(seed);           // memoised, immutable (params are frozen)
galaxy.stellarDensity(x, y, z);                   // stars / ly³ — 0.004 at params.homeLy
galaxy.samplePosition(rng, out);                  // particle position ∝ light, writes `out`
```

| File | Exports |
|---|---|
| `model.ts` | `createGalaxyModel(seed)`, `createGalaxyModelFromParams(params)` (dev harness: tweak a shape → `finalizeGalaxyParams` → model) |
| `params.ts` | `createGalaxyParams(seed)` (memoised, returns copies), `drawGalaxyShape(seed)`, `finalizeGalaxyParams(shape)`, `GALAXY_HOME_DENSITY` |
| `structure.ts` | internal: field math, LUTs, sampler, `integrateDensity`, `findHome` (tests and the model use it); `light()` (Σρ_c L_c) and `gpu` (every constant and table a GPU port needs — src/render/galaxy bakes the arm factor and midplane dust from it, tested against the CPU fields) |

## Frame
Galactic frame G: Y = north, disk in XZ, light-years. `R = √(x² + z²)`, `θ = atan2(z, x)`.
Arms wind towards +θ with radius — they **trail** for a disk rotating towards −θ, i.e.
counter-clockwise seen from +Y (the same sense as prograde orbits in src/sim). Animate any
galactic rotation in that direction.

## Parameters (`drawGalaxyShape`)
| | range | notes |
|---|---|---|
| radius | 45–60 kly | soft logistic edge, width 0.045 R |
| disk scale length R_d | 10–12 kly | |
| scale height h_z | 800–1000 ly | sech² profile |
| bulge radius | 3.5–5.5 kly | Plummer a = radius / 2, flattening q 0.55–0.8 |
| bar | 55 %: 9–14 kly long | arms then start at the bar ends (`armPhase = barAngle`) |
| arms K | 2 (40 %), 3 (15 %), 4 (45 %) | |
| pitch p | 11°–16° | |
| arm width | 2.5–3.5 kly FWHM | σ₀ = FWHM / 2.355 |
| arm strength S | 2.5–4 | ridge density contrast |
| dust scale height | 250–350 ly | |
| name | "NGC 4417", "IC 2574", "UGC 9760", "PGC 54559", "ESO 137-001" | own rng fork |

Every group draws from its own `rng.fork(label)`; add new parameters in new forks so existing
galaxies never change.

## Density (unscaled; ρ₀ is set by calibration)
```
ρ = ρ₀ [ D(R)·( sech²(y/h_z) + 0.07·sech²(y/3.2h_z) + S·A(x,z)·sech²(y/0.6h_z) )
         + B₀ (1 + m²/a²)^(−5/2)                     m² = x² + z² + (y/q)²        (Plummer bulge)
         + Bar₀ exp(−½(u²/σ_u² + v²/σ_v² + y²/σ_y²))  σ_u = L/4, σ_v = 0.3σ_u, σ_y = 0.6h_z
         + H₀ (1 + r²/r_h²)^(−7/4) ]                  r_h = bulge radius           (halo ∝ r^−3.5)

D(R) = e^(−R/R_d) / (1 + e^((R − R_max)/0.045R_max))
```
Normalisations are fixed by star-count fractions of the smooth disk N_d = 2·(h_z + 0.07·3.2h_z)·∫2πR D dR:
bulge 12–30 % (× 0.7 when barred), bar 18 % × L/12 kly, halo 1.5 %, using
∫Plummer = (4π/3)a³q, ∫Gaussian = (2π)^{3/2}σ_uσ_vσ_y, ∫halo = 4πr_h³·½B(3/2, 1/4).

### Arms
```
Φ_k(R) = φ₀ + 2πk/K + ln(R/R₀)·cot p              R₀ = bar half-length, or 0.85 × bulge radius
Δ      = θ − Φ₀(R), reduced modulo 2π/K           → nearest arm k
d      = R·Δ·sin p − 0.6σ(R)·w_k(ln R/R₀)          signed ⊥ distance to the (wiggled) ridge; > 0 = concave side
A      = env(R) · exp(−d²/2σ²) · (1 − 0.65 + 0.65·a(x, z))
σ(R)   = σ₀ (0.6 + 0.4 R / R_home)                 arms flare gently outwards
env(R) = smoothstep(0.6R₀, 1.3R₀, R) · (1 − smoothstep(0.95R_max, 1.2R_max, R))
```
`R·Δ·sin p` is the perpendicular distance for a locally straight spiral (moving along the circle
by arc s changes the distance to the ridge by s·sin p). The ridge **wiggle** `w_k` is 1-D noise
along each arm (a function of R only), so the displaced ridge is single-valued and never folds; a
2-D displacement field produced caustic streaks. The **flocculence** `a(x, z)` is 3-octave fbm
baked on a 256² grid (bilinear lookups), giving clumpy arms.

### Dust, populations
```
dust  = D_dust(R) · sech²(y/h_dust) · g(x,z) · (0.07 + 0.93·env·exp(−(d − 0.5σ)²/(2(0.45σ)²)))
young = (ρ_arm + 0.05 ρ_thin) / ρ            bulgeFraction = (ρ_bulge + ρ_bar) / ρ
```
Dust lanes sit half a σ inside each ridge (the concave side, as in real spirals); `D_dust` has a
central deficit (bulges are dust-poor) and declines slowly with a 2.5 R_d scale; `g` is patchy fbm.
`armFactor` is planar (y is ignored); `youngFraction` carries the thin vertical profile.

## Calibration
* `ρ₀` makes `stellarDensity(homeLy) = 0.004 stars/ly³` exactly (the solar neighbourhood:
  0.14 stars/pc³). The interarm density on the same circle comes out ≈ 0.0017–0.0018, the arm
  ridges ≈ 0.007, the core 0.16–0.63.
* `estimatedStarCount` = ρ₀ × numerical ∭ρ dV over a cylinder of 1.25 R_max (48 × 64 × 40 grid,
  asinh-stretched in R and y, ≈ 12 ms). It agrees with a 4× finer grid to 0.1 % and with the
  analytic component totals to ~1 %. Typical: 4–7 × 10¹⁰ stars.
* **Home** (`findHome`): midplane, R = 0.52 R_max, on the convex (outer) edge of the strongest arm
  crossing that circle where `armFactor` falls to 0.4 — the arm fills half the sky while its dust
  lane stays on the far side.

## Sampling (`samplePosition`)
Mixture by light: component weight ∝ N_c × L_c with light-per-star L = disk 1, arm 4 (OB-rich),
bulge 1.5, bar 1.5, halo 0.5. All constructive, no unbounded loops:
* disk: R from a tabulated inverse CDF of R·D(R); θ uniform; y = h·atanh(2u − 1) (inverse CDF of sech²).
* arm: R from the inverse CDF of D·env·σ (an arm is 1-D: no factor R), pick a ridge, place at
  perpendicular offset `0.6σw_k + N(0, σ)` → θ = Φ_k + d/(R sin p); thinned by flocculence with ≤ 8 tries.
* bulge: Plummer inversion r = a/√(m^(−2/3) − 1) (truncated at 6a), isotropic, y × q.
* bar: triaxial Gaussian rotated by the bar angle. halo: tabulated inverse CDF, isotropic.

≥ 99 % of samples fall within 1.2 R_max; arm samples have mean `armFactor` > 0.45.

## Performance (Node 22, one core)
| | per call |
|---|---|
| `stellarDensity` | ≈ 0.20 µs (10⁶ calls ≈ 200 ms) |
| `armFactor` | ≈ 0.16 µs |
| `dustDensity` | ≈ 0.17 µs |
| `youngFraction` / `bulgeFraction` | ≈ 0.21 µs |
| `samplePosition` | ≈ 0.4 µs |
| `createGalaxyParams` (first call per seed) | 50–80 ms (noise grid ~40 ms, integral ~12 ms), then memoised |

Tricks: radial profiles and sech² are float64 LUTs (relative error < 1e-4); scratch values live in
a `Float64Array` because storing doubles into captured `let`s boxes a HeapNumber per write; the
arm index uses int32 `%` (double `%` is an fmod call). The fields share closure scratch, so a model
is not re-entrant (irrelevant on one thread; build one per worker).

The interarm dust floor is 0.07 (was 0.15): dust is visual only (the catalogue uses the stellar
density), and a lower floor lets sightlines inside the disk reach the band's star clouds.

## Limits / ideas for the galaxy-render owner
* No disk warp, flaring or spurs between arms; the bar is Gaussian rather than Ferrers-like.
* The tunables at the top of `structure.ts` (flocculence, light weights, dust lane offset…) are
  visual choices — retune freely, but remember `stellarDensity` feeds the star catalogue: changing
  it moves every star (the calibration at home is automatic).
