/**
 * MOCK planetary systems.
 *
 * `buildPlanet` turns a compact, hand-editable `PlanetSpec` (orbit, size, albedo, atmosphere …)
 * into a fully-populated `Planet` (and its `Moon`s), DERIVING everything physics fixes so the data
 * is always self-consistent:
 *   period          Kepler III around the parent's mass          (sim/kepler.orbitalPeriodDays)
 *   T_eq            278.6 K · L^¼ · a^−½ · (1−A)^¼  (ARCHITECTURE §6.3; moons use the parent's a)
 *   T_surface       T_eq + greenhouse (0 when airless)
 *   ρ, g, v_esc     from mass & radius;  atmospheric scale height H = RT/μg
 *   oblateness      Darwin–Radau from spin rate and a type-typical moment of inertia
 *   habitability    Earth Similarity Index (radius, temperature), damped for air/water/surface
 *   appearance      plausible linear-sRGB palette hints from type, coverage, air and life
 *
 * `buildProceduralSystem` gives every other mock star a small, plausible, perturbed system so any
 * star can be visited. The real generator (src/gen/systems) replaces all of this.
 */
import { formatNumber, romanNumeral } from '../core/format';
import { clamp, TAU } from '../core/math';
import { createRng } from '../core/rng';
import type {
  AppearanceHints,
  AsteroidBelt,
  Atmosphere,
  BodyBase,
  LifeLevel,
  Moon,
  Planet,
  PlanetType,
  QuatTuple,
  RGB,
  RingSystem,
  Rng,
  StarDetails,
  StarSystem,
} from '../core/types';
import { EARTH_RADIUS_KM, G_SI, HOURS_PER_DAY, KM_PER_AU, SECONDS_PER_HOUR } from '../core/units';
import { orbitalPeriodDays } from '../sim/kepler';
import { formatMoonId, formatPlanetId, planetLetter } from './ids';
import { uniqueProperName } from './mockNames';
import {
  densityGcc,
  earthMassKg,
  equilibriumTempK,
  escapeVelocityKms,
  frostLineKm,
  habitabilityIndex,
  habitableZoneKm,
  hillRadiusKm,
  meanMolarMassG,
  scaleHeightKm,
  solarMassKg,
  sudarskyClass,
  surfaceGravityG,
} from './mockPhysics';

// ───────────────────────────────────────────── Specs

export type Gas = readonly [gas: string, fraction: number];

export interface AtmosphereSpec {
  pressureAtm: number;
  /** [gas, fraction] pairs; normalised to sum 1 and sorted on build. */
  composition: readonly Gas[];
}

export type SpinSpec =
  | { kind: 'hours'; hours: number }
  | { kind: 'locked' }
  /** Spin–orbit resonance (Mercury: 1.5 spins per orbit). */
  | { kind: 'resonance'; spinsPerOrbit: number };

export interface OrbitSpec {
  aKm: number;
  e: number;
  iRad: number;
  nodeRad: number;
  periRad: number;
  meanAnomalyRad: number;
}

export interface BodySpec {
  name: string;
  type: PlanetType;
  orbit: OrbitSpec;
  radiusKm: number;
  massEarth: number;
  spin: SpinSpec;
  axialTiltRad: number;
  axialAzimuthRad: number;
  albedo: number;
  /** Warming over T_eq (giants: internal heat + greenhouse at the 1-bar level). Ignored when airless. */
  greenhouseK: number;
  atmosphere: AtmosphereSpec | null;
  oceanCoverage: number;
  iceCoverage: number;
  volcanism: number;
  craterDensity: number;
  life: LifeLevel;
  /** Hand-authored prose/rating/tags; generated when omitted. */
  blurb?: string;
  surveyRating?: number;
  tags?: readonly string[];
  /** Overrides merged over the derived appearance hints. */
  appearance?: Partial<AppearanceHints>;
}

export interface PlanetSpec extends BodySpec {
  properName: string | null;
  rings: Omit<RingSystem, 'seed'> | null;
  moons: readonly BodySpec[];
}

export interface SystemContext {
  star: StarDetails;
  starMassKg: number;
  /** `createRng(star.seed).fork('system')` — the root of every per-body stream (ARCHITECTURE §6). */
  rng: Rng;
}

export function createSystemContext(star: StarDetails): SystemContext {
  return {
    star,
    starMassKg: solarMassKg(star.massSolar),
    rng: createRng(star.seed).fork('system'),
  };
}

const isGiantType = (t: PlanetType): boolean => t === 'gas-giant' || t === 'ice-giant';

// ───────────────────────────────────────────── Physical derivations

function buildAtmosphere(
  spec: AtmosphereSpec,
  tempK: number,
  gravityG: number,
  greenhouseK: number,
): Atmosphere {
  const total = spec.composition.reduce((sum, [, f]) => sum + f, 0) || 1;
  const composition = spec.composition
    .map(([gas, f]) => ({ gas, fraction: f / total }))
    .sort((a, b) => b.fraction - a.fraction);
  return {
    surfacePressureAtm: spec.pressureAtm,
    composition,
    scaleHeightKm: scaleHeightKm(tempK, meanMolarMassG(composition), gravityG),
    greenhouseK,
  };
}

/** Normalised moment of inertia C/MR² by type (Earth 0.33, Jupiter 0.25, Saturn 0.22, Uranus 0.23). */
const MOMENT_OF_INERTIA: Readonly<Record<PlanetType, number>> = {
  lava: 0.33,
  barren: 0.35,
  desert: 0.36,
  terran: 0.33,
  ocean: 0.32,
  ice: 0.33,
  hothouse: 0.33,
  'gas-giant': 0.25,
  'ice-giant': 0.23,
  dwarf: 0.33,
};

/**
 * Polar flattening from the Darwin–Radau relation f = (5/2)q / (1 + (25/4)(1 − (3/2)C/MR²)²),
 * q = ω²R³/GM. Reproduces Earth (0.0034), Jupiter (0.065) and Saturn (0.098) to ~5 %.
 */
function oblateness(
  type: PlanetType,
  massEarth: number,
  radiusKm: number,
  rotationHours: number,
): number {
  const period = Math.abs(rotationHours) * SECONDS_PER_HOUR;
  if (!(period > 0) || !Number.isFinite(period)) return 0;
  const omega = TAU / period;
  const r = radiusKm * 1000;
  const q = (omega * omega * r * r * r) / (G_SI * earthMassKg(massEarth));
  const k = 1 - 1.5 * MOMENT_OF_INERTIA[type];
  return Math.min(0.2, (2.5 * q) / (1 + 6.25 * k * k));
}

// ───────────────────────────────────────────── Appearance hints (linear sRGB)

const WATER: RGB = [0.012, 0.045, 0.12];
const HYDROCARBON: RGB = [0.06, 0.04, 0.015];
const MAGMA: RGB = [0.3, 0.05, 0.012];
const WATER_CLOUD: RGB = [0.9, 0.9, 0.92];
const ICE_WHITE: RGB = [0.82, 0.85, 0.9];

const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** ±amount brightness and small hue variation, so no two worlds of a type share a palette. */
function vary(rng: Rng, c: RGB, amount = 0.08): RGB {
  const k = 1 + rng.range(-amount, amount);
  return [
    clamp(c[0] * k * (1 + rng.range(-amount, amount) * 0.5), 0, 1),
    clamp(c[1] * k * (1 + rng.range(-amount, amount) * 0.5), 0, 1),
    clamp(c[2] * k * (1 + rng.range(-amount, amount) * 0.5), 0, 1),
  ];
}

/** Sky/limb tint seen from space, from the dominant gases (null when airless or near-vacuum). */
function hazeFor(body: BodyBase): RGB | null {
  const atm = body.atmosphere;
  if (!atm || atm.surfacePressureAtm < 0.005) return null;
  const frac = (gas: string) => atm.composition.find((c) => c.gas === gas)?.fraction ?? 0;
  if (frac('H₂') > 0.5) return frac('CH₄') > 0.015 ? [0.42, 0.78, 1] : [0.8, 0.82, 0.95];
  if (frac('CH₄') > 0.02 && frac('N₂') > 0.5) return [1, 0.58, 0.25]; // tholin haze
  if (frac('CO₂') > 0.5) return atm.surfacePressureAtm > 5 ? [1, 0.84, 0.55] : [0.95, 0.62, 0.45];
  if (frac('Na') > 0.2 || frac('SiO') > 0.2) return [1, 0.72, 0.42];
  return [0.32, 0.56, 1]; // Rayleigh blue
}

const GIANT_BANDS: Readonly<Record<string, readonly RGB[]>> = {
  I: [
    [0.78, 0.62, 0.42],
    [0.92, 0.86, 0.74],
    [0.55, 0.38, 0.24],
    [0.7, 0.42, 0.26],
  ],
  II: [
    [0.86, 0.86, 0.83],
    [0.72, 0.74, 0.72],
    [0.8, 0.78, 0.7],
  ],
  III: [
    [0.22, 0.36, 0.7],
    [0.3, 0.45, 0.78],
    [0.16, 0.26, 0.55],
  ],
  IV: [
    [0.12, 0.1, 0.1],
    [0.2, 0.14, 0.12],
    [0.08, 0.07, 0.08],
  ],
  V: [
    [0.55, 0.5, 0.45],
    [0.4, 0.36, 0.33],
    [0.65, 0.6, 0.55],
  ],
};

function surfacePalette(body: BodyBase): readonly RGB[] {
  switch (body.type) {
    case 'lava':
      return [
        [0.05, 0.045, 0.04],
        [0.1, 0.08, 0.065],
        [0.16, 0.12, 0.09],
      ];
    case 'barren':
      return [
        [0.2, 0.19, 0.18],
        [0.12, 0.11, 0.1],
        [0.3, 0.28, 0.26],
      ];
    case 'desert':
      return [
        [0.45, 0.2, 0.09],
        [0.6, 0.42, 0.25],
        [0.2, 0.11, 0.06],
      ];
    case 'terran':
      return body.life === 'vegetation' || body.life === 'civilization'
        ? [
            [0.05, 0.12, 0.03],
            [0.22, 0.17, 0.09],
            [0.45, 0.36, 0.22],
            [0.26, 0.23, 0.2],
          ]
        : [
            [0.24, 0.18, 0.1],
            [0.42, 0.33, 0.2],
            [0.18, 0.16, 0.14],
          ];
    case 'ocean':
      return [
        [0.2, 0.18, 0.12],
        [0.06, 0.12, 0.04],
      ];
    case 'ice':
      return [
        [0.75, 0.78, 0.82],
        [0.55, 0.6, 0.68],
        [0.4, 0.28, 0.18],
      ];
    case 'hothouse':
      return [
        [0.3, 0.22, 0.15],
        [0.22, 0.16, 0.11],
      ];
    case 'gas-giant':
      return GIANT_BANDS[body.sudarskyClass ?? 'I'];
    case 'ice-giant':
      return [
        [0.45, 0.72, 0.85],
        [0.35, 0.62, 0.8],
        [0.55, 0.8, 0.9],
      ];
    case 'dwarf':
      return [
        [0.55, 0.48, 0.4],
        [0.7, 0.66, 0.6],
        [0.45, 0.25, 0.12],
      ];
  }
}

function cloudsFor(body: BodyBase, rng: Rng): { coverage: number; color: RGB } {
  const p = body.atmosphere?.surfacePressureAtm ?? 0;
  switch (body.type) {
    case 'terran':
      return { coverage: rng.range(0.35, 0.6), color: WATER_CLOUD };
    case 'ocean':
      return { coverage: rng.range(0.5, 0.8), color: WATER_CLOUD };
    case 'hothouse':
      return { coverage: 1, color: [0.9, 0.8, 0.55] };
    case 'desert':
      return { coverage: p > 0.05 ? rng.range(0, 0.08) : 0, color: [0.75, 0.55, 0.4] };
    case 'ice':
      return { coverage: p > 0.5 ? 0.15 : 0, color: [0.85, 0.6, 0.3] };
    default:
      // Giants: 0 — their cloud decks ARE the banded surfaceColors.
      return { coverage: 0, color: WATER_CLOUD };
  }
}

export function deriveAppearance(body: BodyBase, rng: Rng): AppearanceHints {
  const surfaceColors = surfacePalette(body).map((c) => vary(rng, c));
  if (body.iceCoverage > 0.05 && body.type !== 'ice' && !isGiantType(body.type))
    surfaceColors.push(ICE_WHITE);
  const oceanColor: RGB | null =
    body.oceanCoverage <= 0
      ? null
      : body.type === 'lava'
        ? MAGMA
        : body.surfaceTempK < 200
          ? HYDROCARBON
          : vary(rng, WATER, 0.15);
  const clouds = cloudsFor(body, rng);
  let swatch: RGB = surfaceColors[0];
  if (oceanColor) swatch = mix3(swatch, oceanColor, body.oceanCoverage * 0.9);
  if (body.iceCoverage > 0) swatch = mix3(swatch, ICE_WHITE, body.iceCoverage * 0.6);
  if (clouds.coverage > 0) swatch = mix3(swatch, clouds.color, clouds.coverage * 0.7);
  return {
    surfaceColors: surfaceColors.slice(0, 5),
    oceanColor,
    cloudCoverage: clouds.coverage,
    cloudColor: clouds.color,
    hazeColor: hazeFor(body),
    nightLights: body.life === 'civilization' ? rng.range(0.55, 0.9) : 0,
    lavaGlow: body.type === 'lava' ? clamp(0.4 + 0.6 * body.volcanism, 0, 1) : 0,
    swatch,
  };
}

// ───────────────────────────────────────────── Builders

const EMPTY_APPEARANCE: AppearanceHints = {
  surfaceColors: [],
  oceanColor: null,
  cloudCoverage: 0,
  cloudColor: WATER_CLOUD,
  hazeColor: null,
  nightLights: 0,
  lavaGlow: 0,
  swatch: [0, 0, 0],
};

function buildBodyBase(
  spec: BodySpec,
  id: string,
  rng: Rng,
  centralMassKg: number,
  starDistanceAU: number,
  luminositySolar: number,
  rings: RingSystem | null,
): BodyBase {
  // Kepler III around the parent's mass alone (the body's own mass is ≤ 0.05 % of it here).
  const periodDays = orbitalPeriodDays(spec.orbit.aKm, centralMassKg);
  const teq = equilibriumTempK(luminositySolar, starDistanceAU, spec.albedo);
  const greenhouseK = spec.atmosphere ? spec.greenhouseK : 0;
  const surfaceTempK = teq + greenhouseK;
  const gravity = surfaceGravityG(spec.massEarth, spec.radiusKm);
  const spin = spec.spin;
  const rotationPeriodHours =
    spin.kind === 'hours'
      ? spin.hours
      : spin.kind === 'locked'
        ? periodDays * HOURS_PER_DAY
        : (periodDays * HOURS_PER_DAY) / spin.spinsPerOrbit;
  const body: BodyBase = {
    id,
    name: spec.name,
    type: spec.type,
    seed: rng.seed,
    orbit: {
      semiMajorAxisKm: spec.orbit.aKm,
      eccentricity: spec.orbit.e,
      inclinationRad: spec.orbit.iRad,
      longitudeAscendingNodeRad: spec.orbit.nodeRad,
      argumentPeriapsisRad: spec.orbit.periRad,
      meanAnomalyEpochRad: spec.orbit.meanAnomalyRad,
      periodDays,
    },
    radiusKm: spec.radiusKm,
    massEarth: spec.massEarth,
    densityGcc: densityGcc(spec.massEarth, spec.radiusKm),
    surfaceGravityG: gravity,
    escapeVelocityKms: escapeVelocityKms(spec.massEarth, spec.radiusKm),
    rotationPeriodHours,
    axialTiltRad: spec.axialTiltRad,
    axialAzimuthRad: spec.axialAzimuthRad,
    tidallyLocked: spin.kind === 'locked',
    albedo: spec.albedo,
    equilibriumTempK: teq,
    surfaceTempK,
    atmosphere: spec.atmosphere
      ? buildAtmosphere(spec.atmosphere, surfaceTempK, gravity, greenhouseK)
      : null,
    oceanCoverage: spec.oceanCoverage,
    iceCoverage: spec.iceCoverage,
    volcanism: spec.volcanism,
    craterDensity: spec.craterDensity,
    life: spec.life,
    sudarskyClass: isGiantType(spec.type) ? sudarskyClass(teq) : null,
    oblateness: oblateness(spec.type, spec.massEarth, spec.radiusKm, rotationPeriodHours),
    rings,
    habitability: 0,
    blurb: '',
    surveyRating: 1,
    tags: [],
    appearance: EMPTY_APPEARANCE,
  };
  body.habitability = habitabilityIndex({
    radiusEarth: spec.radiusKm / EARTH_RADIUS_KM,
    surfaceTempK,
    pressureAtm: body.atmosphere?.surfacePressureAtm ?? 0,
    giant: isGiantType(spec.type),
  });
  body.appearance = { ...deriveAppearance(body, rng.fork('appearance')), ...spec.appearance };
  return body;
}

export function buildPlanet(ctx: SystemContext, spec: PlanetSpec, index: number): Planet {
  const { star } = ctx;
  const planetRng = ctx.rng.fork('planet').fork(index);
  const id = formatPlanetId(star.id, index);
  const aAU = spec.orbit.aKm / KM_PER_AU;
  const rings = spec.rings ? { ...spec.rings, seed: planetRng.fork('rings').seed } : null;
  const base = buildBodyBase(spec, id, planetRng, ctx.starMassKg, aAU, star.luminositySolar, rings);
  const moons: Moon[] = spec.moons.map((moonSpec, j) => {
    const moonId = formatMoonId(id, j);
    const moonRng = planetRng.fork('moon').fork(j);
    const moonBase = buildBodyBase(
      moonSpec,
      moonId,
      moonRng,
      earthMassKg(spec.massEarth),
      aAU,
      star.luminositySolar,
      null,
    );
    const moon: Moon = { ...moonBase, id: moonId, parentId: id, index: j };
    moon.tags = moonSpec.tags ? [...moonSpec.tags] : moonTags(moon);
    moon.surveyRating = moonSpec.surveyRating ?? bodyRating(moon, 1, 0);
    moon.blurb = moonSpec.blurb ?? moonBlurb(moon, spec.name, moonRng.fork('prose'));
    return moon;
  });
  const [hzIn, hzOut] = habitableZoneKm(star.luminositySolar);
  const planet: Planet = {
    ...base,
    id,
    index,
    letter: planetLetter(index),
    properName: spec.properName,
    moons,
    inHabitableZone: spec.orbit.aKm >= hzIn && spec.orbit.aKm <= hzOut,
  };
  planet.tags = spec.tags ? [...spec.tags] : planetTags(planet, star);
  planet.surveyRating = spec.surveyRating ?? bodyRating(planet, 1.5, moons.length);
  planet.blurb = spec.blurb ?? planetBlurb(planet, star, planetRng.fork('prose'));
  return planet;
}

// ───────────────────────────────────────────── Prose, tags, ratings (mock quality)

const TYPE_LABEL: Readonly<Record<PlanetType, string>> = {
  lava: 'lava world',
  barren: 'barren world',
  desert: 'desert world',
  terran: 'terran world',
  ocean: 'ocean world',
  ice: 'ice world',
  hothouse: 'hothouse world',
  'gas-giant': 'gas giant',
  'ice-giant': 'ice giant',
  dwarf: 'dwarf planet',
};

export function planetTypeLabel(type: PlanetType): string {
  return TYPE_LABEL[type];
}

function planetTags(p: Planet, star: StarDetails): string[] {
  const tags = [TYPE_LABEL[p.type]];
  const rocky = !isGiantType(p.type) && p.type !== 'dwarf';
  const rEarth = p.radiusKm / EARTH_RADIUS_KM;
  if (p.inHabitableZone) tags.push('habitable zone');
  if (p.tidallyLocked && rocky && star.spectralClass === 'M' && p.inHabitableZone)
    tags.push('eyeball world');
  else if (p.tidallyLocked) tags.push('tidally locked');
  if (rocky && rEarth >= 1.25 && rEarth <= 2.2) tags.push('super-Earth');
  if (p.type === 'gas-giant' && p.equilibriumTempK > 900) tags.push('hot Jupiter');
  if (p.life !== 'none') tags.push(p.life === 'microbial' ? 'microbial life' : p.life);
  if (p.rings) tags.push(p.rings.opticalDepth < 0.2 ? 'faint rings' : 'ringed');
  if (p.moons.length >= 2) tags.push(`${p.moons.length} moons`);
  if (Math.abs(p.axialTiltRad) > 1.2 && Math.abs(p.axialTiltRad) < Math.PI - 0.3)
    tags.push('extreme axial tilt');
  if (p.orbit.eccentricity > 0.2) tags.push('eccentric orbit');
  return tags;
}

function moonTags(m: Moon): string[] {
  const tags = ['moon', TYPE_LABEL[m.type].replace(' world', '')];
  if (m.tidallyLocked) tags.push('tidally locked');
  if (m.orbit.inclinationRad > Math.PI / 2) tags.push('retrograde orbit');
  if ((m.atmosphere?.surfacePressureAtm ?? 0) > 0.5) tags.push('thick atmosphere');
  if (m.type === 'lava') tags.push('tidal heating');
  return tags;
}

const LIFE_BONUS: Readonly<Record<LifeLevel, number>> = {
  none: 0,
  microbial: 0.5,
  vegetation: 1.5,
  civilization: 2.5,
};
const TYPE_BONUS: Readonly<Record<PlanetType, number>> = {
  lava: 0.5,
  barren: 0,
  desert: 0.25,
  terran: 0.5,
  ocean: 0.5,
  ice: 0.25,
  hothouse: 0.25,
  'gas-giant': 0.5,
  'ice-giant': 0.25,
  dwarf: 0,
};

/** Surveyor's rating 1..5 in 0.5 steps. */
function bodyRating(b: BodyBase, base: number, moonCount: number): number {
  let score = base + TYPE_BONUS[b.type] + LIFE_BONUS[b.life] + 1.5 * b.habitability;
  if (b.rings) score += b.rings.opticalDepth > 0.3 ? 1 : 0.5;
  if (moonCount >= 3) score += 0.5;
  if ((b.atmosphere?.surfacePressureAtm ?? 0) > 0.5 && !isGiantType(b.type)) score += 0.25;
  return clamp(Math.round(score * 2) / 2, 1, 5);
}

interface ProseContext {
  name: string;
  star: string;
  tempC: string;
  gravity: string;
  pressure: string;
  year: string;
}

type Template = (c: ProseContext) => string;

const BLURBS: Readonly<Record<PlanetType, readonly Template[]>> = {
  lava: [
    (c) =>
      `${c.name} has not finished deciding what shape to be. Lava seas glow at ${c.tempC} under ${c.star}'s glare; landing is possible, briefly.`,
    () =>
      'Molten, tidally squeezed and permanently on fire: a world geologists dream about and insurers refuse to discuss.',
  ],
  barren: [
    (c) =>
      `Airless, cratered and perfectly still, ${c.name} keeps an exact record of every rock that ever hit it.`,
    () =>
      'A grey ball of dust and old impacts where nothing has happened for a billion years, and nothing is scheduled.',
  ],
  desert: [
    (c) =>
      `Dunes, dust devils and a sky the colour of old brass. ${c.name} is a desert in the grand tradition: beautiful, empty and trying to kill you slowly.`,
    (c) =>
      `A dry, wind-carved world at ${c.tempC}. The dunes sing when the wind is right, which is the only entertainment for light-years.`,
  ],
  terran: [
    (c) =>
      `Oceans, clouds and continents at a comfortable ${c.tempC}. Suspiciously pleasant; read the small print.`,
    (c) =>
      `Blue water, brown land, white weather: ${c.name} looks like a postcard from somewhere you have never been. A year here lasts ${c.year}.`,
  ],
  ocean: [
    () =>
      'One enormous ocean with a few islands for punctuation. The surf is up everywhere, forever.',
    (c) =>
      `A planet-wide sea hundreds of kilometres deep under ${c.pressure} of humid air. Bring a boat; bring a bigger boat.`,
  ],
  ice: [
    () =>
      'A world sealed under a shell of ice, cracked like old porcelain. Something may be sloshing about underneath.',
    (c) =>
      `Frozen solid at ${c.tempC}, ${c.name} reflects most of the light it gets and resents the rest.`,
  ],
  hothouse: [
    (c) =>
      `A runaway greenhouse under ${c.pressure} of carbon dioxide, with a surface at ${c.tempC}. The clouds are acid and the forecast is worse.`,
    () =>
      'Venus went wrong once; this planet went wrong on purpose. Visit the upper atmosphere, where it is merely unpleasant.',
  ],
  'gas-giant': [
    () =>
      'A banded giant of hydrogen and helium, with storms larger than whole planets drifting through its clouds.',
    (c) =>
      `${c.name} is mostly weather: stripes of ammonia cloud racing round a world where the cloud-top gravity is ${c.gravity}.`,
  ],
  'ice-giant': [
    () => 'A cold blue-green giant of water, ammonia and methane ices under a deep hydrogen sky.',
    (c) =>
      `Serene, remote and ${c.tempC} at the cloud tops, ${c.name} is the colour of glacier meltwater and roughly as welcoming.`,
  ],
  dwarf: [
    () =>
      'A small, icy world on the outskirts: too modest to clear its orbit, too far out to care.',
    (c) =>
      `From ${c.name}, ${c.star} is just the brightest star in a black sky. A year here lasts ${c.year}.`,
  ],
};

const LIFE_LINE: Readonly<Record<LifeLevel, string>> = {
  none: '',
  microbial: ' Something microscopic is quietly getting on with it in the shallows.',
  vegetation: ' The continents are furred with something that photosynthesises.',
  civilization: ' At night the dark side glitters with city lights: someone is home.',
};

function formatDuration(days: number): string {
  if (days < 2) return `${(days * 24).toFixed(0)} hours`;
  if (days < 400) return `${days.toFixed(0)} days`;
  const years = days / 365.25;
  return years < 10 ? `${years.toFixed(1)} years` : `${years.toFixed(0)} years`;
}

function proseContext(b: BodyBase, starName: string): ProseContext {
  const p = b.atmosphere?.surfacePressureAtm ?? 0;
  return {
    name: b.name,
    star: starName,
    tempC: `${formatNumber(Math.round(b.surfaceTempK - 273.15))} °C`,
    gravity: `${b.surfaceGravityG.toFixed(1)} g`,
    pressure: `${p.toFixed(p < 10 ? 1 : 0)} atm`,
    year: formatDuration(b.orbit.periodDays),
  };
}

function planetBlurb(p: Planet, star: StarDetails, rng: Rng): string {
  return rng.pick(BLURBS[p.type])(proseContext(p, star.name)) + LIFE_LINE[p.life];
}

const MOON_BLURBS: Readonly<Partial<Record<PlanetType, (name: string, parent: string) => string>>> =
  {
    lava: (n, p) =>
      `${n} is kneaded by ${p}'s tides until its insides melt; its volcanoes repaint the surface every few years.`,
    ice: (n, p) =>
      `An ice-shelled moon of ${p}. Cracks in ${n}'s crust hint at an ocean below, kept liquid by tidal flexing.`,
    barren: (n, p) =>
      `A battered, airless companion of ${p}; ${n} keeps count of every impact since the system formed.`,
    dwarf: (n) =>
      `${n} is small, lumpy and possibly a captured asteroid that never found the exit.`,
  };

function moonBlurb(m: Moon, parentName: string, rng: Rng): string {
  const template = MOON_BLURBS[m.type];
  return template
    ? template(m.name, parentName)
    : rng.pick(BLURBS[m.type])(proseContext(m, parentName));
}

// ───────────────────────────────────────────── Procedural systems

interface RockyTemplate {
  radiusEarth: readonly [number, number];
  densityGcc: readonly [number, number];
  albedo: readonly [number, number];
}

const ROCKY: Readonly<Partial<Record<PlanetType, RockyTemplate>>> = {
  lava: { radiusEarth: [0.7, 1.8], densityGcc: [5, 7], albedo: [0.08, 0.15] },
  barren: { radiusEarth: [0.25, 1.1], densityGcc: [3.3, 5.8], albedo: [0.07, 0.2] },
  desert: { radiusEarth: [0.4, 1.3], densityGcc: [3.8, 5.5], albedo: [0.2, 0.35] },
  terran: { radiusEarth: [0.8, 1.5], densityGcc: [4.8, 6], albedo: [0.25, 0.35] },
  ocean: { radiusEarth: [0.9, 2.2], densityGcc: [3, 4.8], albedo: [0.25, 0.32] },
  hothouse: { radiusEarth: [0.8, 1.3], densityGcc: [4.8, 5.6], albedo: [0.65, 0.8] },
  ice: { radiusEarth: [0.15, 0.9], densityGcc: [1.4, 2.6], albedo: [0.45, 0.8] },
  dwarf: { radiusEarth: [0.05, 0.25], densityGcc: [1.6, 2.6], albedo: [0.3, 0.7] },
};

/** Earth's mean density from the unit constants (≈ 5.51 g/cm³). */
const EARTH_DENSITY = densityGcc(1, EARTH_RADIUS_KM);

function pickWeighted<T>(rng: Rng, options: readonly (readonly [T, number])[]): T {
  return options[rng.weighted(options.map(([, w]) => w))][0];
}

function logRange(rng: Rng, min: number, max: number): number {
  return Math.exp(rng.range(Math.log(min), Math.log(max)));
}

function chooseType(
  rng: Rng,
  star: StarDetails,
  aAU: number,
  teq: number,
  zones: { hzIn: number; hzOut: number; frost: number },
  giantsSoFar: number,
  outermost: boolean,
): PlanetType {
  if (star.kind === 'neutron-star') return 'barren';
  if (teq > 900) {
    return pickWeighted(rng, [
      ['lava', 0.72],
      ['barren', 0.2],
      ['gas-giant', 0.08],
    ]);
  }
  if (aAU < zones.hzIn) {
    return pickWeighted(rng, [
      ['barren', 0.45],
      ['hothouse', 0.3],
      ['desert', 0.25],
    ]);
  }
  if (aAU <= zones.hzOut) {
    return pickWeighted(rng, [
      ['terran', 0.45],
      ['ocean', 0.3],
      ['desert', 0.25],
    ]);
  }
  if (aAU < zones.frost) {
    return pickWeighted(rng, [
      ['desert', 0.45],
      ['barren', 0.35],
      ['ice', 0.2],
    ]);
  }
  if (giantsSoFar === 0) {
    return pickWeighted(rng, [
      ['gas-giant', 0.7],
      ['ice-giant', 0.2],
      ['ice', 0.1],
    ]);
  }
  if (outermost && aAU > 8 * zones.frost) {
    return pickWeighted(rng, [
      ['dwarf', 0.5],
      ['ice-giant', 0.3],
      ['ice', 0.2],
    ]);
  }
  return pickWeighted(rng, [
    ['ice-giant', 0.4],
    ['gas-giant', 0.3],
    ['ice', 0.15],
    ['dwarf', 0.15],
  ]);
}

function randomOrbit(rng: Rng, aKm: number, eMax: number, iStd: number): OrbitSpec {
  return {
    aKm,
    e: Math.min(eMax, Math.abs(rng.normal(0, eMax / 2.5))),
    iRad: Math.abs(rng.normal(0, iStd)),
    nodeRad: rng.range(0, TAU),
    periRad: rng.range(0, TAU),
    meanAnomalyRad: rng.range(0, TAU),
  };
}

const AIR: Readonly<Record<string, readonly Gas[]>> = {
  rockVapour: [
    ['Na', 0.45],
    ['SiO', 0.3],
    ['O₂', 0.25],
  ],
  co2: [
    ['CO₂', 0.95],
    ['N₂', 0.03],
    ['Ar', 0.02],
  ],
  n2co2: [
    ['N₂', 0.8],
    ['CO₂', 0.15],
    ['Ar', 0.05],
  ],
  abiotic: [
    ['N₂', 0.9],
    ['CO₂', 0.08],
    ['Ar', 0.01],
    ['H₂O', 0.01],
  ],
  humid: [
    ['N₂', 0.9],
    ['CO₂', 0.06],
    ['H₂O', 0.03],
    ['Ar', 0.01],
  ],
  venus: [
    ['CO₂', 0.96],
    ['N₂', 0.03],
    ['SO₂', 0.01],
  ],
  titan: [
    ['N₂', 0.95],
    ['CH₄', 0.05],
  ],
  jovian: [
    ['H₂', 0.86],
    ['He', 0.135],
    ['CH₄', 0.004],
    ['NH₃', 0.001],
  ],
  neptunian: [
    ['H₂', 0.8],
    ['He', 0.17],
    ['CH₄', 0.03],
  ],
  microbial: [
    ['N₂', 0.9],
    ['CO₂', 0.06],
    ['CH₄', 0.02],
    ['Ar', 0.01],
    ['H₂O', 0.01],
  ],
  oxygenated: [
    ['N₂', 0.76],
    ['O₂', 0.21],
    ['H₂O', 0.015],
    ['Ar', 0.01],
    ['CO₂', 0.005],
  ],
};

function atmosphereFor(
  type: PlanetType,
  rng: Rng,
): { atm: AtmosphereSpec | null; greenhouseK: number } {
  switch (type) {
    case 'lava':
      return rng.chance(0.5)
        ? {
            atm: { pressureAtm: logRange(rng, 0.001, 0.05), composition: AIR.rockVapour },
            greenhouseK: rng.range(5, 20),
          }
        : { atm: null, greenhouseK: 0 };
    case 'desert': {
      const p = logRange(rng, 0.01, 1.2);
      return {
        atm: { pressureAtm: p, composition: rng.chance(0.6) ? AIR.co2 : AIR.n2co2 },
        greenhouseK: 3 + 15 * p,
      };
    }
    case 'terran': {
      const p = rng.range(0.6, 2.5);
      return {
        atm: { pressureAtm: p, composition: AIR.abiotic },
        greenhouseK: rng.range(15, 40) * p ** 0.3,
      };
    }
    case 'ocean':
      return {
        atm: { pressureAtm: rng.range(1, 5), composition: AIR.humid },
        greenhouseK: rng.range(25, 60),
      };
    case 'hothouse':
      return {
        atm: { pressureAtm: rng.range(20, 95), composition: AIR.venus },
        greenhouseK: rng.range(250, 520),
      };
    case 'ice':
      return rng.chance(0.25)
        ? {
            atm: { pressureAtm: rng.range(0.05, 1.5), composition: AIR.titan },
            greenhouseK: rng.range(2, 10),
          }
        : { atm: null, greenhouseK: 0 };
    case 'gas-giant':
      return { atm: { pressureAtm: 1, composition: AIR.jovian }, greenhouseK: rng.range(30, 70) };
    case 'ice-giant':
      return { atm: { pressureAtm: 1, composition: AIR.neptunian }, greenhouseK: rng.range(5, 30) };
    case 'barren':
    case 'dwarf':
      return { atm: null, greenhouseK: 0 };
  }
}

function spinFor(type: PlanetType, rng: Rng, locked: boolean): SpinSpec {
  if (locked) return { kind: 'locked' };
  if (type === 'hothouse' && rng.chance(0.4))
    return { kind: 'hours', hours: -rng.range(1000, 6000) };
  if (type === 'gas-giant') return { kind: 'hours', hours: rng.range(8, 18) };
  if (type === 'ice-giant') return { kind: 'hours', hours: rng.range(14, 20) };
  if (type === 'dwarf') return { kind: 'hours', hours: rng.range(6, 160) };
  const hours = rng.range(12, 70);
  return { kind: 'hours', hours: rng.chance(0.08) ? -hours : hours };
}

interface SurfaceSpec {
  ocean: number;
  ice: number;
  volcanism: number;
  craters: number;
}

function surfaceFor(type: PlanetType, rng: Rng, surfaceTempK: number): SurfaceSpec {
  const polarIce = clamp((285 - surfaceTempK) / 80, 0.02, 0.7);
  switch (type) {
    case 'lava':
      return {
        ocean: rng.range(0.15, 0.45),
        ice: 0,
        volcanism: rng.range(0.8, 1),
        craters: rng.range(0, 0.1),
      };
    case 'barren':
      return {
        ocean: 0,
        ice: surfaceTempK < 300 ? rng.range(0, 0.03) : 0,
        volcanism: rng.range(0, 0.15),
        craters: rng.range(0.6, 1),
      };
    case 'desert':
      return {
        ocean: rng.range(0, 0.03),
        ice: surfaceTempK < 250 ? rng.range(0.03, 0.15) : rng.range(0, 0.02),
        volcanism: rng.range(0, 0.3),
        craters: rng.range(0.2, 0.6),
      };
    case 'terran':
      return {
        ocean: rng.range(0.35, 0.8),
        ice: polarIce,
        volcanism: rng.range(0.05, 0.4),
        craters: rng.range(0.01, 0.1),
      };
    case 'ocean':
      return {
        ocean: rng.range(0.92, 1),
        ice: polarIce * 0.8,
        volcanism: rng.range(0.05, 0.3),
        craters: rng.range(0, 0.03),
      };
    case 'hothouse':
      return { ocean: 0, ice: 0, volcanism: rng.range(0.3, 0.8), craters: rng.range(0.02, 0.1) };
    case 'ice':
      return {
        ocean: 0,
        ice: rng.range(0.75, 1),
        volcanism: rng.range(0, 0.3),
        craters: rng.range(0.05, 0.5),
      };
    case 'dwarf':
      return {
        ocean: 0,
        ice: rng.range(0.3, 0.9),
        volcanism: rng.range(0, 0.1),
        craters: rng.range(0.3, 0.9),
      };
    case 'gas-giant':
    case 'ice-giant':
      return { ocean: 0, ice: 0, volcanism: 0, craters: 0 };
  }
}

function decideLife(rng: Rng, type: PlanetType, habitability: number, ageGyr: number): LifeLevel {
  if (type !== 'terran' && type !== 'ocean') {
    return type === 'desert' && habitability > 0.5 && rng.chance(0.15) ? 'microbial' : 'none';
  }
  if (habitability < 0.55 || ageGyr < 0.8 || !rng.chance(0.65)) return 'none';
  if (habitability < 0.72 || ageGyr < 2 || !rng.chance(0.55)) return 'microbial';
  if (habitability < 0.8 || ageGyr < 3.5 || !rng.chance(0.2)) return 'vegetation';
  return 'civilization';
}

function proceduralPlanet(
  ctx: SystemContext,
  index: number,
  aAU: number,
  type: PlanetType,
  takenNames: Set<string>,
): PlanetSpec {
  const { star } = ctx;
  const rng = ctx.rng.fork('planet').fork(index).fork('spec');
  const L = star.luminositySolar;
  const locked = aAU < 0.3 * Math.cbrt(star.massSolar); // t_lock ∝ a⁶/M² ⇒ a_lock ∝ M^⅓

  let radiusKm: number;
  let massEarth: number;
  let albedo: number;
  if (type === 'gas-giant') {
    massEarth = logRange(rng, 60, 1600);
    const hot = equilibriumTempK(L, aAU, 0.1) > 900;
    radiusKm = (hot ? rng.range(12.5, 16) : rng.range(7.5, 13.5)) * EARTH_RADIUS_KM;
    const cls = sudarskyClass(equilibriumTempK(L, aAU, 0.34));
    albedo = { I: 0.34, II: 0.6, III: 0.12, IV: 0.05, V: 0.5 }[cls] + rng.range(-0.03, 0.03);
  } else if (type === 'ice-giant') {
    massEarth = rng.range(9, 30);
    radiusKm = rng.range(3.2, 4.6) * EARTH_RADIUS_KM;
    albedo = rng.range(0.28, 0.35);
  } else {
    const t = ROCKY[type] as RockyTemplate;
    const rEarth = rng.range(t.radiusEarth[0], t.radiusEarth[1]);
    radiusKm = rEarth * EARTH_RADIUS_KM;
    massEarth = (rng.range(t.densityGcc[0], t.densityGcc[1]) / EARTH_DENSITY) * rEarth ** 3;
    albedo = rng.range(t.albedo[0], t.albedo[1]);
  }

  const { atm, greenhouseK } = atmosphereFor(type, rng);
  const surfaceTempK = equilibriumTempK(L, aAU, albedo) + (atm ? greenhouseK : 0);
  const surface = surfaceFor(type, rng, surfaceTempK);
  const habitability = habitabilityIndex({
    radiusEarth: radiusKm / EARTH_RADIUS_KM,
    surfaceTempK,
    pressureAtm: atm?.pressureAtm ?? 0,
    giant: isGiantType(type),
  });
  const life = decideLife(rng.fork('life'), type, habitability, star.ageGyr);
  const atmosphere: AtmosphereSpec | null =
    atm && life !== 'none' && (type === 'terran' || type === 'ocean')
      ? { ...atm, composition: life === 'microbial' ? AIR.microbial : AIR.oxygenated }
      : atm;

  const tilt = locked
    ? rng.range(0, 0.05)
    : rng.chance(0.05)
      ? rng.range(1.4, 2.2)
      : Math.min(1.2, Math.abs(rng.normal(0, 0.35)));
  const properName =
    life !== 'none' || habitability >= 0.75 ? uniqueProperName(rng.fork('name'), takenNames) : null;
  const eMax = locked ? 0.02 : type === 'dwarf' ? 0.3 : 0.12;
  const orbit = randomOrbit(rng, aAU * KM_PER_AU, eMax, type === 'dwarf' ? 0.15 : 0.03);

  let rings: Omit<RingSystem, 'seed'> | null = null;
  if (type === 'gas-giant' && rng.chance(0.3)) {
    const inner = radiusKm * rng.range(1.2, 1.5);
    rings = {
      innerRadiusKm: inner,
      outerRadiusKm: inner + radiusKm * rng.range(0.4, 1.2),
      composition: equilibriumTempK(L, aAU, albedo) < 180 ? 'ice' : 'rock',
      opticalDepth: rng.range(0.3, 1.8),
    };
  } else if (type === 'ice-giant' && rng.chance(0.3)) {
    const inner = radiusKm * rng.range(1.5, 2);
    rings = {
      innerRadiusKm: inner,
      outerRadiusKm: inner + radiusKm * rng.range(0.2, 0.6),
      composition: rng.chance(0.6) ? 'dust' : 'ice',
      opticalDepth: rng.range(0.02, 0.15),
    };
  }

  const spec: PlanetSpec = {
    name: properName ?? `${star.name} ${planetLetter(index)}`,
    type,
    orbit,
    radiusKm,
    massEarth,
    spin: spinFor(type, rng, locked),
    axialTiltRad: tilt,
    axialAzimuthRad: rng.range(0, TAU),
    albedo,
    greenhouseK,
    atmosphere,
    oceanCoverage: surface.ocean,
    iceCoverage: surface.ice,
    volcanism: surface.volcanism,
    craterDensity: surface.craters,
    life,
    properName,
    rings,
    moons: [],
  };
  spec.moons = proceduralMoons(ctx, index, spec);
  return spec;
}

type MoonTemplate = readonly [
  rMin: number,
  rMax: number,
  dMin: number,
  dMax: number,
  aMin: number,
  aMax: number,
];

const MOON_TEMPLATES: Readonly<Partial<Record<PlanetType, MoonTemplate>>> = {
  lava: [0.2, 0.32, 3.2, 3.7, 0.5, 0.65],
  ice: [0.12, 0.42, 1.5, 3, 0.5, 0.8],
  barren: [0.1, 0.4, 2.8, 3.6, 0.1, 0.25],
  dwarf: [0.03, 0.12, 1.5, 2.4, 0.3, 0.6],
};

function proceduralMoons(ctx: SystemContext, index: number, planet: PlanetSpec): BodySpec[] {
  const rng = ctx.rng.fork('planet').fork(index).fork('moons');
  const type = planet.type;
  const giant = isGiantType(type);
  const terrestrial = type === 'terran' || type === 'ocean' || type === 'desert';
  let count = 0;
  if (type === 'gas-giant') count = rng.int(2, 5);
  else if (type === 'ice-giant') count = rng.int(1, 3);
  else if (terrestrial && rng.chance(0.35)) count = 1;
  else if (type === 'dwarf' && rng.chance(0.1)) count = 1;

  const hill = hillRadiusKm(
    planet.orbit.aKm,
    planet.orbit.e,
    earthMassKg(planet.massEarth),
    ctx.starMassKg,
  );
  let a = giant
    ? Math.max((planet.rings?.outerRadiusKm ?? 0) * 1.4, planet.radiusKm * rng.range(5, 8))
    : planet.radiusKm * rng.range(20, 60);
  const moons: BodySpec[] = [];
  for (let j = 0; j < count; j++) {
    if (a > 0.3 * hill) break; // beyond this, stellar tides would strip the moon
    const m = rng.fork(j);
    const mType: PlanetType = !giant
      ? pickWeighted(m, [
          ['barren', 0.8],
          ['dwarf', 0.2],
        ])
      : j === 0
        ? pickWeighted(m, [
            ['lava', 0.25], // innermost big moons get tidally heated (Io)
            ['ice', 0.35],
            ['barren', 0.25],
            ['dwarf', 0.15],
          ])
        : pickWeighted(m, [
            ['ice', 0.45],
            ['barren', 0.3],
            ['dwarf', 0.25],
          ]);
    const [rMin, rMax, dMin, dMax, aMin, aMax] = MOON_TEMPLATES[mType] as MoonTemplate;
    let rEarth = m.range(rMin, rMax);
    if (!giant) rEarth = Math.min(rEarth, (planet.radiusKm / EARTH_RADIUS_KM) * 0.3);
    const titan = mType === 'ice' && rEarth > 0.3 && m.chance(0.2);
    const retrograde = m.chance(0.05);
    const orbit = randomOrbit(m, a, 0.03, 0.02);
    moons.push({
      name: `${planet.name} ${romanNumeral(j + 1)}`,
      type: mType,
      orbit: retrograde ? { ...orbit, iRad: Math.PI - orbit.iRad } : orbit,
      radiusKm: rEarth * EARTH_RADIUS_KM,
      massEarth: (m.range(dMin, dMax) / EARTH_DENSITY) * rEarth ** 3,
      spin: { kind: 'locked' },
      axialTiltRad: m.range(0, 0.02),
      axialAzimuthRad: m.range(0, TAU),
      albedo: m.range(aMin, aMax),
      greenhouseK: titan ? m.range(5, 12) : 0,
      atmosphere: titan ? { pressureAtm: m.range(1, 1.6), composition: AIR.titan } : null,
      oceanCoverage: mType === 'lava' || titan ? m.range(0.01, 0.05) : 0,
      iceCoverage:
        mType === 'ice' ? m.range(0.6, 1) : mType === 'dwarf' ? m.range(0.3, 0.8) : m.range(0, 0.1),
      volcanism: mType === 'lava' ? m.range(0.85, 1) : m.range(0, 0.2),
      craterDensity: mType === 'lava' ? 0 : m.range(0.2, 1),
      life: 'none',
    });
    a *= m.range(1.5, 2.1);
  }
  return moons;
}

/** Uniformly random rotation (Shoemake 1992) as an (x, y, z, w) quaternion. */
function randomRotation(rng: Rng): QuatTuple {
  const u1 = rng.next();
  const u2 = rng.next();
  const u3 = rng.next();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return [
    s1 * Math.sin(TAU * u2),
    s1 * Math.cos(TAU * u2),
    s2 * Math.sin(TAU * u3),
    s2 * Math.cos(TAU * u3),
  ];
}

const STAR_LABEL: Readonly<Record<string, string>> = {
  O: 'blue giant',
  B: 'blue-white star',
  A: 'white star',
  F: 'yellow-white star',
  G: 'yellow dwarf',
  K: 'orange dwarf',
  M: 'red dwarf',
  D: 'white dwarf',
  N: 'pulsar',
  X: 'black hole',
};

export function starKindLabel(star: StarDetails): string {
  if (star.kind === 'giant' || star.kind === 'supergiant') {
    const colour =
      star.spectralClass === 'M' ? 'red' : star.spectralClass === 'K' ? 'orange' : 'yellow';
    return `${colour} ${star.kind}`;
  }
  if (star.kind === 'subgiant') return 'subgiant';
  return STAR_LABEL[star.spectralClass] ?? 'star';
}

function systemTags(
  star: StarDetails,
  planets: readonly Planet[],
  belts: readonly AsteroidBelt[],
): string[] {
  const tags = [
    starKindLabel(star),
    `${planets.length} ${planets.length === 1 ? 'planet' : 'planets'}`,
  ];
  if (planets.some((p) => p.life !== 'none')) tags.push('living world');
  else if (planets.some((p) => p.inHabitableZone && !isGiantType(p.type)))
    tags.push('habitable-zone world');
  if (planets.some((p) => p.rings && p.rings.opticalDepth >= 0.2)) tags.push('ringed giant');
  if (belts.some((b) => b.composition !== 'ice')) tags.push('asteroid belt');
  return tags;
}

function systemRating(star: StarDetails, planets: readonly Planet[]): number {
  const best = planets.reduce((m, p) => Math.max(m, p.surveyRating), 1);
  const exotic = star.kind !== 'main-sequence' ? 0.75 : 0;
  const busy = planets.length >= 5 ? 0.5 : 0;
  return clamp(Math.round((0.75 + best * 0.7 + exotic + busy) * 2) / 2, 1, 5);
}

function systemBlurb(star: StarDetails, planets: readonly Planet[], rng: Rng): string {
  const label = starKindLabel(star);
  const n = planets.length;
  const living = planets.find((p) => p.life !== 'none');
  const ringed = planets.find((p) => p.rings && p.rings.opticalDepth >= 0.2);
  const count = n === 0 ? 'no planets at all' : n === 1 ? 'a single planet' : `${n} planets`;
  const opener = rng.pick([
    `${star.name} is a ${label} with ${count}.`,
    `A ${label} attended by ${count}.`,
    `${star.name}: one ${label}, ${count}, and a great deal of empty space.`,
  ]);
  if (living) return `${opener} ${living.name} is the reason to come: it is alive.`;
  if (ringed) return `${opener} The ringed giant ${ringed.name} is worth the detour.`;
  if (star.kind === 'white-dwarf')
    return `${opener} The survivors orbit the cooling ember of a star that has already died once.`;
  if (star.kind === 'neutron-star') {
    return `${opener} The planets are bathed in the lighthouse beam of a spinning, city-sized stellar corpse.`;
  }
  const closer = rng.pick([
    'Quiet, unremarkable and therefore restful.',
    'Nobody has rated it highly, which is its own kind of charm.',
    'A good place to be alone with your thoughts.',
  ]);
  return `${opener} ${closer}`;
}

/** Navigation radius (types.ts): max(1.5 × outermost apoapsis or belt edge, 2000 × stellar radius, 1 AU). */
function systemRadiusKm(
  star: StarDetails,
  planets: readonly Planet[],
  belts: readonly AsteroidBelt[],
): number {
  let outer = 0;
  for (const p of planets)
    outer = Math.max(outer, p.orbit.semiMajorAxisKm * (1 + p.orbit.eccentricity));
  for (const b of belts) outer = Math.max(outer, b.outerRadiusKm);
  return Math.max(1.5 * outer, 2000 * star.radiusKm, KM_PER_AU);
}

/** Wraps planets and belts into a StarSystem with derived zones, radius, prose and rating. */
export function assembleSystem(
  ctx: SystemContext,
  planets: Planet[],
  belts: AsteroidBelt[],
  eclipticToGalactic: QuatTuple,
  prose?: { blurb: string; surveyRating: number; tags: readonly string[] },
): StarSystem {
  const L = ctx.star.luminositySolar;
  return {
    id: ctx.star.id,
    star: ctx.star,
    planets,
    belts,
    habitableZoneKm: habitableZoneKm(L),
    frostLineKm: frostLineKm(L),
    radiusKm: systemRadiusKm(ctx.star, planets, belts),
    eclipticToGalactic,
    blurb: prose?.blurb ?? systemBlurb(ctx.star, planets, ctx.rng.fork('prose')),
    surveyRating: prose?.surveyRating ?? systemRating(ctx.star, planets),
    tags: prose ? [...prose.tags] : systemTags(ctx.star, planets, belts),
  };
}

/**
 * A small, perturbed, physically-consistent system for any non-home mock star:
 * 2–5 planets (1–3 around giants and remnants) on roughly geometric orbits (ratios 1.45–2.2),
 * types by temperature zone, ~45 % of main-sequence systems get a planet nudged into the HZ.
 */
export function buildProceduralSystem(star: StarDetails): StarSystem {
  const ctx = createSystemContext(star);
  const layout = ctx.rng.fork('layout');
  const L = star.luminositySolar;
  const [hzInKm, hzOutKm] = habitableZoneKm(L);
  const zones = {
    hzIn: hzInKm / KM_PER_AU,
    hzOut: hzOutKm / KM_PER_AU,
    frost: frostLineKm(L) / KM_PER_AU,
  };
  const remnant = star.kind === 'white-dwarf' || star.kind === 'neutron-star';
  const evolved = star.kind === 'giant' || star.kind === 'supergiant' || star.kind === 'subgiant';
  const count =
    star.kind === 'black-hole' ? 0 : remnant || evolved ? layout.int(1, 3) : layout.int(2, 5);

  let aAU =
    star.kind === 'neutron-star'
      ? layout.range(0.15, 0.25) // pulsar planets, cf. PSR B1257+12
      : star.kind === 'white-dwarf'
        ? layout.range(1.5, 4) // survivors of the red-giant phase
        : layout.range(0.04, 0.35) * Math.sqrt(L);
  aAU = Math.max(aAU, (4 * star.radiusKm) / KM_PER_AU + 0.01);
  const orbitsAU: number[] = [];
  for (let k = 0; k < count; k++) {
    orbitsAU.push(aAU);
    aAU *= layout.range(1.45, 2.2) * (layout.chance(0.2) ? 1.6 : 1);
  }
  if (star.kind === 'main-sequence' && count > 0 && layout.chance(0.45)) {
    const hzMid = Math.sqrt(zones.hzIn * zones.hzOut);
    let best = 0;
    for (let k = 1; k < count; k++) {
      if (Math.abs(Math.log(orbitsAU[k] / hzMid)) < Math.abs(Math.log(orbitsAU[best] / hzMid)))
        best = k;
    }
    const target = clamp(hzMid * layout.range(0.9, 1.1), zones.hzIn * 1.01, zones.hzOut * 0.99);
    const inner = best > 0 ? orbitsAU[best - 1] : 0;
    const outer = best < count - 1 ? orbitsAU[best + 1] : Number.POSITIVE_INFINITY;
    if (target > inner * 1.3 && target * 1.3 < outer) orbitsAU[best] = target;
  }

  const takenNames = new Set<string>([star.name.toLowerCase()]);
  const planets: Planet[] = [];
  let giants = 0;
  for (let k = 0; k < count; k++) {
    const typeRng = ctx.rng.fork('planet').fork(k).fork('type');
    const teqGuess = equilibriumTempK(L, orbitsAU[k], 0.3);
    const type = chooseType(typeRng, star, orbitsAU[k], teqGuess, zones, giants, k === count - 1);
    if (isGiantType(type)) giants++;
    planets.push(buildPlanet(ctx, proceduralPlanet(ctx, k, orbitsAU[k], type, takenNames), k));
  }

  const belts: AsteroidBelt[] = [];
  const beltRng = ctx.rng.fork('belts');
  if (!remnant && star.kind !== 'black-hole' && beltRng.chance(0.55)) {
    // Main belt: in the widest gap inside ~2× the frost line, else just inside the frost line.
    let centre = zones.frost * 0.85;
    let widest = 1.6;
    for (let k = 1; k < count; k++) {
      const ratio = orbitsAU[k] / orbitsAU[k - 1];
      if (orbitsAU[k] <= zones.frost * 2 && ratio > widest) {
        widest = ratio;
        centre = Math.sqrt(orbitsAU[k] * orbitsAU[k - 1]);
      }
    }
    belts.push({
      innerRadiusKm: centre * 0.82 * KM_PER_AU,
      outerRadiusKm: centre * 1.2 * KM_PER_AU,
      thicknessKm: centre * 0.08 * KM_PER_AU,
      count: beltRng.int(2500, 6000),
      composition: beltRng.chance(0.2) ? 'metal' : 'rock',
      seed: beltRng.fork('main').seed,
    });
  }
  if (count > 0 && star.kind !== 'black-hole' && beltRng.chance(0.35)) {
    const inner = orbitsAU[count - 1] * 1.3;
    belts.push({
      innerRadiusKm: inner * KM_PER_AU,
      outerRadiusKm: inner * 1.8 * KM_PER_AU,
      thicknessKm: inner * 0.12 * KM_PER_AU,
      count: beltRng.int(2000, 4000),
      composition: 'ice',
      seed: beltRng.fork('outer').seed,
    });
  }

  return assembleSystem(ctx, planets, belts, randomRotation(ctx.rng.fork('orientation')));
}
