/**
 * Shared data contracts for Sidereal.
 *
 * These types are the boundary between procedural generation (src/gen, src/sim),
 * the universe facade (src/universe), rendering (src/render, src/engine) and the UI (src/ui).
 * Changing a type here is an API change: prefer adding optional fields over changing
 * existing ones, and update every consumer if you must.
 *
 * Units live in the field-name suffix — always:
 *   Ly (light-years) · Km · AU · K (kelvin) · Solar · Earth · Days · Hours · Sec · Rad
 *   Atm · Gyr · G (standard gravities) · Kms (km/s) · Gcc (g/cm³)
 */

export type Vec3Tuple = readonly [number, number, number];
/** Linear-sRGB colour. Components are usually 0..1; emissive values may exceed 1 (HDR). */
export type RGB = readonly [number, number, number];
/** Unit quaternion (x, y, z, w). */
export type QuatTuple = readonly [number, number, number, number];

/**
 * Star identifier: `${level}.${cx}.${cy}.${cz}.${i}` — catalogue level (luminosity band, see
 * src/universe/contracts.ts), integer cell coordinates at that level's cell size (may be negative),
 * and the star's DRAW ORDER within the cell (stable; not a luminosity rank).
 * URL-hash safe: digits, '-', '.'. Example: "3.101.-1.14.7". "8.0.0.0.0" is the galactic-core black hole.
 */
export type StarId = string;
/** `${StarId}.${letter}` — letter follows exoplanet convention: b, c, d… by orbital order. */
export type PlanetId = string;
/** `${PlanetId}.${n}` — n is the 1-based moon number by orbital order. */
export type MoonId = string;
export type BodyId = PlanetId | MoonId;

// ───────────────────────────────────────────────────────────── Random numbers

/** Deterministic pseudo-random stream. Implemented by `createRng` in src/core/rng.ts. */
export interface Rng {
  /** Seed this stream was created from (uint32). */
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Normally distributed value (Box–Muller). */
  normal(mean?: number, std?: number): number;
  /** true with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Index chosen with probability proportional to `weights`. */
  weighted(weights: readonly number[]): number;
  /** Raw uint32. */
  uint32(): number;
  /**
   * Independent child stream derived from this stream's *seed* and `label`.
   * Does NOT advance this stream, so adding a new fork never changes existing output.
   */
  fork(label: number | string): Rng;
}

// ───────────────────────────────────────────────────────────── Galaxy

/**
 * Galactic frame G: right-handed, Y up (galactic north), disk in the XZ plane,
 * origin at the galactic centre, units light-years.
 */
export interface GalaxyParams {
  seed: number;
  /** Procedural catalogue name of the galaxy, e.g. "NGC 4417". */
  name: string;
  /** Visible disk radius (soft edge). ~45–60 kly. */
  radiusLy: number;
  diskScaleLengthLy: number;
  diskScaleHeightLy: number;
  bulgeRadiusLy: number;
  /** y-axis squash of the bulge (0.4–1). */
  bulgeFlattening: number;
  /** 0 = unbarred. */
  barLengthLy: number;
  barAngleRad: number;
  armCount: number;
  /** Logarithmic-spiral pitch angle. */
  armPitchRad: number;
  armWidthLy: number;
  /** Density contrast of arms relative to the underlying disk. */
  armStrength: number;
  /** Rotation of arm 0. */
  armPhaseRad: number;
  dustScaleHeightLy: number;
  /** The curated starting location ("you are here"), in the disk midplane. */
  homeLy: Vec3Tuple;
  /** Integral of stellarDensity over the galaxy (for the "N billion stars" tagline). */
  estimatedStarCount: number;
}

export interface GalaxyModel {
  readonly params: GalaxyParams;
  /**
   * Stars per cubic light-year at a galactic position.
   * Calibrated so a solar-neighbourhood-like spot (R ≈ 26 kly, midplane, between arms) ≈ 0.004.
   */
  stellarDensity(x: number, y: number, z: number): number;
  /** Relative dust density 0..~1 — dark lanes on the inner (concave) edges of arms, thin in y. */
  dustDensity(x: number, y: number, z: number): number;
  /** 0..1 proximity to a spiral-arm ridge (1 = on the ridge). */
  armFactor(x: number, y: number, z: number): number;
  /** 0..1 fraction of young (blue, OB-rich) stellar population here. */
  youngFraction(x: number, y: number, z: number): number;
  /** 0..1 fraction of the old bulge/bar population here. */
  bulgeFraction(x: number, y: number, z: number): number;
  /**
   * Sample a random position distributed ∝ stellar light (used to place galaxy particles).
   * Writes into `out` when given and returns it.
   */
  samplePosition(rng: Rng, out?: [number, number, number]): [number, number, number];
}

// ───────────────────────────────────────────────────────────── Stars

export type StarKind =
  | 'main-sequence'
  | 'subgiant'
  | 'giant'
  | 'supergiant'
  | 'white-dwarf'
  | 'neutron-star'
  | 'black-hole';

/** Harvard class letter; 'D' = white dwarf, 'N' = neutron star, 'X' = black hole. */
export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'D' | 'N' | 'X';

/** Lightweight star record, generated in bulk per sector (thousands at a time). */
export interface StarRecord {
  id: StarId;
  /** Catalogue level (luminosity band). */
  level: number;
  /** Integer cell coordinates at this level's cell size. */
  cell: Vec3Tuple;
  /** Draw order within the cell (stable). */
  index: number;
  /** Position in the galactic frame, light-years. */
  posLy: Vec3Tuple;
  /** uint32 seed from which everything about this star and its system derives. */
  seed: number;
  kind: StarKind;
  spectralClass: SpectralClass;
  /** Full MK-style type, e.g. "G2V", "M4.5V", "K1III", "B1Ia", "DA3". */
  spectralType: string;
  massSolar: number;
  radiusSolar: number;
  /** Bolometric luminosity. */
  luminositySolar: number;
  /** Effective temperature (0 for black holes). */
  temperatureK: number;
  /** Absolute visual magnitude (approximate). */
  absMag: number;
  /** Blackbody chromaticity as linear sRGB, normalised so max component = 1. */
  colorRGB: RGB;
  /** Display name: a proper name when the star is notable, else its designation. */
  name: string;
  /** Catalogue designation, always present, e.g. "SDR 812-2-113 7". */
  designation: string;
}

/** Full star description (derived deterministically from a StarRecord). */
export interface StarDetails extends StarRecord {
  radiusKm: number;
  ageGyr: number;
  /** [Fe/H] in dex (0 = solar). */
  metallicityFeH: number;
  rotationPeriodDays: number;
  /** 0..1 — starspots and flares (young M dwarfs are high). */
  activity: number;
  /** Neutron stars: pulsar spin period. */
  pulsarPeriodSec?: number;
  /** Black holes (and some white dwarfs): 0..1 visual accretion-disk brightness. */
  accretion?: number;
}

/**
 * One catalogue cell in struct-of-arrays form — no per-star objects, cheap to cache and to upload.
 * Star `i` of the block has id `${key}.${i}`. Produced by the Universe facade, consumed by the starfield.
 */
export interface StarBlock {
  /** `${level}.${cx}.${cy}.${cz}` */
  key: string;
  level: number;
  cell: Vec3Tuple;
  /** Cell centre in the galactic frame (ly, float64). */
  originLy: Vec3Tuple;
  count: number;
  /** count×3 positions relative to originLy (ly). */
  offsetsLy: Float32Array;
  /** count absolute visual magnitudes. */
  absMag: Float32Array;
  /** count bolometric luminosities (L☉) — for shared photometry. */
  luminositySolar: Float32Array;
  /** count×3 linear-sRGB blackbody chromaticity (max component 1, NOT saturation-boosted). */
  colorRGB: Float32Array;
  /** count StarKind indices into STAR_KINDS (src/universe/contracts.ts). */
  kind: Uint8Array;
}

// ───────────────────────────────────────────────────────────── Planets & moons

export type PlanetType =
  /** Molten or partially molten surface with glowing lava (Io, hot super-Earths). */
  | 'lava'
  /** Airless cratered rock (Mercury, the Moon). */
  | 'barren'
  /** Dry world with thin/moderate atmosphere (Mars, dune worlds). */
  | 'desert'
  /** Liquid water with continents (Earth-like). */
  | 'terran'
  /** Global ocean with scattered islands. */
  | 'ocean'
  /** Frozen surface (Europa, snowball worlds). */
  | 'ice'
  /** Thick opaque atmosphere, runaway greenhouse (Venus). */
  | 'hothouse'
  /** Jupiter/Saturn class. */
  | 'gas-giant'
  /** Uranus/Neptune class. */
  | 'ice-giant'
  /** Small icy/rocky body (Ceres, Pluto) — common as moons and in the outer system. */
  | 'dwarf';

export type LifeLevel = 'none' | 'microbial' | 'vegetation' | 'civilization';

/** Sudarsky gas-giant classes by temperature: I ammonia clouds … V silicate clouds. */
export type SudarskyClass = 'I' | 'II' | 'III' | 'IV' | 'V';

/**
 * Keplerian elements. Reference plane: the parent's reference plane (planets: the system
 * ecliptic, i.e. the XZ plane of frame S; moons: the parent planet's equatorial plane).
 * Always evaluate with src/sim/kepler.ts — never re-derive positions ad hoc.
 */
export interface OrbitalElements {
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationRad: number;
  longitudeAscendingNodeRad: number;
  argumentPeriapsisRad: number;
  /** Mean anomaly at simDays = 0. */
  meanAnomalyEpochRad: number;
  periodDays: number;
}

export interface Atmosphere {
  /** Surface pressure; for giants, the pressure at the visible cloud deck (~1). */
  surfacePressureAtm: number;
  /** Sorted by fraction, descending; fractions sum to ~1. Gas names use Unicode subscripts: "N₂", "CO₂". */
  composition: readonly { gas: string; fraction: number }[];
  scaleHeightKm: number;
  /** Warming of the mean surface temperature over equilibrium. */
  greenhouseK: number;
}

export interface RingSystem {
  innerRadiusKm: number;
  outerRadiusKm: number;
  composition: 'ice' | 'rock' | 'dust';
  /** 0..~2 — Saturn's dense B ring is ~1–2, faint dusty rings ~0.05. */
  opticalDepth: number;
  seed: number;
}

/**
 * Canonical colours & coverages decided by the generator, so every consumer agrees: the surface,
 * cloud and atmosphere shaders use these as their base values (adding detail on top), and the UI uses
 * `swatch`/`surfaceColors` for thumbnails. All colours linear sRGB.
 */
export interface AppearanceHints {
  /** 2–5 representative surface albedo colours, dominant first (rock/soil/vegetation/ice; giants: band colours). */
  surfaceColors: RGB[];
  /** Liquid colour when oceanCoverage > 0 (water deep blue; hydrocarbon seas dark amber), else null. */
  oceanColor: RGB | null;
  /** 0..1 cloud-cover fraction (hothouse ≈ 1). */
  cloudCoverage: number;
  cloudColor: RGB;
  /** Limb/sky tint seen from space; null when airless. */
  hazeColor: RGB | null;
  /** 0..1 night-side city-light density (civilisations). */
  nightLights: number;
  /** 0..1 molten-surface glow (lava worlds, tidally heated moons). */
  lavaGlow: number;
  /** One colour summarising the body from afar (UI swatches, markers, lite visuals). */
  swatch: RGB;
}

/** Physical description shared by planets and moons. Renderers derive appearance from this. */
export interface BodyBase {
  id: BodyId;
  name: string;
  type: PlanetType;
  seed: number;
  orbit: OrbitalElements;
  radiusKm: number;
  massEarth: number;
  densityGcc: number;
  surfaceGravityG: number;
  escapeVelocityKms: number;
  /** Sidereal day; negative = retrograde rotation. Equals the orbital period when tidally locked. */
  rotationPeriodHours: number;
  /** Obliquity: tilt of the spin axis from the orbit normal. */
  axialTiltRad: number;
  /** Azimuth of the spin-axis tilt (where the pole leans), for variety. */
  axialAzimuthRad: number;
  tidallyLocked: boolean;
  /** Bond albedo. */
  albedo: number;
  equilibriumTempK: number;
  /** Mean surface temperature (giants: at the 1-bar level). */
  surfaceTempK: number;
  atmosphere: Atmosphere | null;
  /** 0..1 fraction of the surface covered by liquid. */
  oceanCoverage: number;
  /** 0..1 fraction covered by ice. */
  iceCoverage: number;
  /** 0..1 */
  volcanism: number;
  /** 0..1 */
  craterDensity: number;
  life: LifeLevel;
  /** Giants only. */
  sudarskyClass: SudarskyClass | null;
  /** Polar flattening (0 = sphere; Saturn ≈ 0.098). */
  oblateness: number;
  /** Rings in the body's equatorial plane, or null (moons: always null). */
  rings: RingSystem | null;
  /** 0..1 Earth-similarity-style index. */
  habitability: number;
  /** One or two sentences of guidebook prose (wry, informative). */
  blurb: string;
  /** Computed "surveyor's rating", 1..5 in 0.5 steps. */
  surveyRating: number;
  /** Short descriptive tags, e.g. ["eyeball world", "super-Earth", "ringed"]. */
  tags: string[];
  appearance: AppearanceHints;
}

export interface Moon extends BodyBase {
  id: MoonId;
  parentId: PlanetId;
  /** 0-based orbital order around the parent. */
  index: number;
}

export interface Planet extends BodyBase {
  id: PlanetId;
  /** 0 = innermost. */
  index: number;
  /** 'b', 'c', … */
  letter: string;
  /** Notable planets get a proper name; `name` is then that proper name. */
  properName: string | null;
  moons: Moon[];
  inHabitableZone: boolean;
}

export interface AsteroidBelt {
  innerRadiusKm: number;
  outerRadiusKm: number;
  thicknessKm: number;
  /** Suggested particle count at 'high' quality. */
  count: number;
  composition: 'rock' | 'ice' | 'metal';
  seed: number;
}

/** A generated planetary system. Frame S: origin at the star, ecliptic = XZ plane, Y = ecliptic north, km. */
export interface StarSystem {
  id: StarId;
  star: StarDetails;
  /** Sorted by semi-major axis. */
  planets: Planet[];
  belts: AsteroidBelt[];
  habitableZoneKm: readonly [number, number];
  frostLineKm: number;
  /**
   * Radius of the system's "sphere of influence" for navigation & layer activation:
   * max(1.5 × outermost orbit or belt edge, 2000 × stellar radius, 1 AU).
   */
  radiusKm: number;
  /** Rotation taking vectors from the system's ecliptic frame S into galactic axes G. */
  eclipticToGalactic: QuatTuple;
  blurb: string;
  /** 1..5 in 0.5 steps. */
  surveyRating: number;
  tags: string[];
}

// ───────────────────────────────────────────────────────────── Navigation & search

export type FocusTarget =
  /** A free point in the galaxy (orbit around it). */
  | { kind: 'galaxy'; centerLy: Vec3Tuple }
  | { kind: 'star'; id: StarId }
  | { kind: 'planet'; id: PlanetId }
  | { kind: 'moon'; id: MoonId };

export type ViewLevel = 'galaxy' | 'system' | 'planet';

export type SelectionRef =
  | { kind: 'star'; id: StarId }
  | { kind: 'planet'; id: PlanetId }
  | { kind: 'moon'; id: MoonId };

export interface SearchResult {
  ref: SelectionRef;
  name: string;
  /** e.g. "G2V · 3 planets · 41 ly from home". */
  subtitle: string;
  score: number;
}
