# src/sim — orbits, orientation, time

Deterministic celestial mechanics in float64. Allocation-free except `orbitPathKm`.
Everything writes into caller-supplied `out` objects (three.js convention).

## Frames

All frames are right-handed and **Y-up**. Orbital elements are defined in *astronomical* axes
(X = reference direction, Z = north) and mapped with `(Xa, Ya, Za) → (Xa, Za, −Ya)` — a proper
rotation, so prograde orbits run **counter-clockwise seen from +Y**, the reference plane is XZ,
and astronomical `R_z(θ)` / `R_x(θ)` become right-handed rotations about **+Y** / **+X**.

| Body | Its orbit's reference frame ("parent frame") |
|---|---|
| planet | the system ecliptic frame **S** (star at the origin) |
| moon | its planet's non-rotating **equatorial frame** — use `moonPositionKm` / `moonOrientation` to get frame S |

## API

### `kepler.ts`
| | |
|---|---|
| `solveKepler(M, e)` | eccentric anomaly; Newton–Raphson from Danby's starter `M + 0.85e·sign(sin M)`, residual < 1e-12 for e ≤ 0.97 (tested to 0.999) |
| `meanAnomalyAt(orbit, simDays)` | (−π, π]; only the fractional revolution is scaled by 2π, so it stays exact after 10⁶ orbits |
| `eccentricAnomalyAt`, `trueAnomalyFromEccentric`, `meanLongitude` | |
| `orbitalPositionKm(orbit, simDays, out)` | position relative to the parent, parent frame, km |
| `orbitalVelocityKms(orbit, simDays, out)` | km/s (checked against finite differences and vis-viva) |
| `orbitPathKm(orbit, segments)` | `Float32Array` of `segments + 1` xyz vertices from periapsis; last = first (draw as `Line`); uniform in E |
| `orbitNormal(orbit, out)` | unit angular-momentum direction |
| `periapsisKm`, `apoapsisKm` | |
| `orbitalPeriodDays(aKm, M, m?)`, `semiMajorAxisKmForPeriod(P, M, m?)` | Kepler III with `G_SI` (masses in kg) |

Perifocal position `(a(cos E − e), a√(1−e²) sin E)` is rotated by `R_z(Ω)·R_x(i)·R_z(ω)`
(Murray & Dermott §2.8), then mapped to Y-up. Eccentricity is clamped to `[0, 0.999999]`.

### `orientation.ts`
```
orbitFrame      = R_Y(Ω) · R_X(i)                 Y → orbit normal, X → ascending node
equatorialFrame = orbitFrame · R_Y(α) · R_X(ε)    Y → spin axis (ε = axialTiltRad, α = axialAzimuthRad)
bodyOrientation = equatorialFrame · R_Y(φ(t))     φ = spinAngleRad(body, simDays)
```
Quaternions map **body → parent frame**. Body-fixed frame: +Y = north pole, +X = prime meridian.
Functions take `OrientedBody = Pick<BodyBase, 'orbit' | 'axialTiltRad' | 'axialAzimuthRad' |
'rotationPeriodHours' | 'tidallyLocked'>`, so any `Planet`/`Moon` works.

| | |
|---|---|
| `orbitFrame(orbit, out)` | |
| `equatorialFrame(body, out)` | non-rotating; rings and moon orbits live here |
| `spinAxis(body, out)` | north pole in the parent frame |
| `spinAngleRad(body, simDays)` | free rotators: `2π·frac(simDays·24 / rotationPeriodHours)`; negative period = retrograde |
| `bodyOrientation(body, simDays, out)` | |
| `moonPositionKm(moon, planet, simDays, out)` | `equatorialFrame(planet) · orbitalPositionKm(moon.orbit)` — frame S, relative to the planet |
| `moonOrientation(moon, planet, simDays, out)` | `equatorialFrame(planet) · bodyOrientation(moon)` — frame S |

#### Axial tilt convention (exact — several modules depend on it)
Orbit-frame axes: **x̂ₒ** = ascending node, **ŷₒ** = orbit normal, **ẑₒ** = x̂ₒ × ŷₒ
(for i = 0, Ω = 0 these are the parent's own +X, +Y, +Z).

* The north pole is ŷₒ tipped by ε towards `lean(α) = sin α · x̂ₒ + cos α · ẑₒ`:
  **spin axis = (sin ε sin α, cos ε, sin ε cos α)** in (x̂ₒ, ŷₒ, ẑₒ).
  α = 0 leans the pole towards +ẑₒ, α = π/2 towards +x̂ₒ; α grows counter-clockwise seen from
  the orbit's north (right-hand rule about ŷₒ).
* The tilt hinge (the equator's line of nodes on the orbit plane, and the equatorial frame's +X
  before spin) is `cos α · x̂ₒ − sin α · ẑₒ`.
* ε > π/2 puts the pole below the orbit plane; retrograde rotation may equally be expressed with a
  negative `rotationPeriodHours` — both are honoured.
* Seasons: with ŝ the unit vector from planet to star, the sub-stellar latitude is
  `asin(sin ε · (ŝ · lean(α)))`. Northern midsummer is when the planet is at **−lean(α)** as seen
  from the star.

#### Tidal locking
For `tidallyLocked` bodies the spin angle turns +X towards the parent along the orbit's **mean**
argument of latitude ω + M (projected onto the equator when tilted). Uniform spin on an
eccentric orbit therefore produces genuine optical libration (≈ ±2e rad), exactly like the Moon.
A circular orbit faces the parent to 1e-9 rad.

### `time.ts`
| | |
|---|---|
| `simDaysNow(nowMs?)` | days since J2000 (2000-01-01 12:00 UTC) |
| `simDaysToUnixMs`, `advanceSimDays(simDays, dtRealSec, timeScale)` | |
| `cyclePhase(simDays, periodDays)` | float64 phase in [0, 1) — **hand shaders phases/angles, never raw simDays** (float32 resolves only ~84 s at today's offset) |
| `TIME_SCALES` | frozen presets `{ label, secondsPerSecond }`: paused 0, real time 1, 1 min/s, 1 h/s, 1 day/s, 1 week/s, 1 month/s (Julian month), 1 yr/s (Julian year); labels = `formatTimeScale` (no-break space before the unit) |
| `nearestTimeScaleIndex(sps)`, `stepTimeScale(sps, ±1)` | for speed-up / slow-down controls |

## Limits
* Two-body Keplerian motion only: no perturbations, precession, or resonances.
* Elliptic orbits only (e < 1).
* Tidally locked bodies with a large obliquity still face their parent via projection; physically
  such bodies sit in Cassini states with ε ≈ 0, so generators should keep ε small for them.
