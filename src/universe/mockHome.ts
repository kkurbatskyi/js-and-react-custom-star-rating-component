/**
 * MOCK home system: Aurelia, a G2V star with seven hand-authored worlds, two belts and nine moons.
 *
 * Only the *inputs* are hand-picked (orbit, size, albedo, air, surface); periods (Kepler III),
 * temperatures (ARCHITECTURE §6.3), densities, gravities, scale heights and habitability are all
 * derived by `buildPlanet`, so the numbers are consistent by construction.
 *
 * Zones for L = 1.05 L☉: HZ 0.977–1.408 AU, frost line 2.77 AU.
 */
import type { AsteroidBelt, QuatTuple, StarDetails, StarSystem } from '../core/types';
import { EARTH_RADIUS_KM, KM_PER_AU } from '../core/units';
import { assembleSystem, type BodySpec, buildPlanet, createSystemContext, type PlanetSpec } from './mockBodies';

export const HOME_STAR_NAME = 'Aurelia';

/** Physical inputs for the home star (the record's position/id/seed come from the catalogue). */
export const HOME_STAR = {
  massSolar: 1.02,
  radiusSolar: 1.012,
  luminositySolar: 1.05,
  spectralType: 'G2V',
  ageGyr: 4.1,
  metallicityFeH: 0.04,
  rotationPeriodDays: 25.1,
  activity: 0.22,
} as const;

const AU = KM_PER_AU;
const RE = EARTH_RADIUS_KM;

const HOME_MOON_DEFAULTS = {
  spin: { kind: 'locked' },
  axialTiltRad: 0.003,
  axialAzimuthRad: 0,
  greenhouseK: 0,
  atmosphere: null,
  oceanCoverage: 0,
  life: 'none',
} as const satisfies Partial<BodySpec>;

const PLANETS: readonly PlanetSpec[] = [
  {
    name: 'Aurelia b',
    properName: null,
    type: 'lava',
    orbit: { aKm: 0.055 * AU, e: 0.004, iRad: 0.021, nodeRad: 1.21, periRad: 0.37, meanAnomalyRad: 2.9 },
    radiusKm: 1.42 * RE,
    massEarth: 3.3,
    spin: { kind: 'locked' },
    axialTiltRad: 0.002,
    axialAzimuthRad: 0.4,
    albedo: 0.12,
    greenhouseK: 25,
    atmosphere: { pressureAtm: 0.018, composition: [['Na', 0.42], ['SiO', 0.33], ['O₂', 0.25]] },
    oceanCoverage: 0.3, // magma seas
    iceCoverage: 0,
    volcanism: 1,
    craterDensity: 0.02,
    life: 'none',
    rings: null,
    moons: [],
    blurb:
      'A dayside hot enough to melt rock and a nightside that is merely very hot. Magma seas face ' +
      'Aurelia forever, glowing a sullen orange through a haze of vaporised sodium. Bring shoes you do not love.',
    surveyRating: 3.5,
    tags: ['lava world', 'tidally locked', 'super-Earth', 'magma seas'],
  },
  {
    name: 'Aurelia c',
    properName: null,
    type: 'barren',
    orbit: { aKm: 0.42 * AU, e: 0.17, iRad: 0.08, nodeRad: 0.52, periRad: 1.9, meanAnomalyRad: 0.6 },
    radiusKm: 0.41 * RE,
    massEarth: 0.062,
    spin: { kind: 'resonance', spinsPerOrbit: 1.5 },
    axialTiltRad: 0.01,
    axialAzimuthRad: 2.2,
    albedo: 0.11,
    greenhouseK: 0,
    atmosphere: null,
    oceanCoverage: 0,
    iceCoverage: 0.01, // water ice in permanently shadowed polar craters
    volcanism: 0.05,
    craterDensity: 0.95,
    life: 'none',
    rings: null,
    moons: [],
    blurb:
      'A scorched, cratered cinder that spins three times for every two laps of its star, the most ' +
      'tedious waltz in astronomy. Water ice hides in permanently shadowed polar craters, the only cool thing about it.',
    surveyRating: 2.5,
    tags: ['barren world', 'airless', '3:2 spin–orbit resonance', 'polar crater ice'],
  },
  {
    name: 'Halcyon',
    properName: 'Halcyon',
    type: 'terran',
    orbit: { aKm: 1.04 * AU, e: 0.021, iRad: 0.004, nodeRad: 2.6, periRad: 4.1, meanAnomalyRad: 1.35 },
    radiusKm: 1.03 * RE,
    massEarth: 1.09,
    spin: { kind: 'hours', hours: 26.4 },
    axialTiltRad: 0.4,
    axialAzimuthRad: 1.1,
    albedo: 0.3,
    greenhouseK: 35,
    atmosphere: {
      pressureAtm: 1.08,
      composition: [['N₂', 0.772], ['O₂', 0.207], ['H₂O', 0.011], ['Ar', 0.0093], ['CO₂', 0.0007]],
    },
    oceanCoverage: 0.68,
    iceCoverage: 0.06,
    volcanism: 0.2,
    craterDensity: 0.03,
    life: 'vegetation',
    rings: null,
    moons: [
      {
        ...HOME_MOON_DEFAULTS,
        name: 'Lanthorn',
        type: 'barren',
        orbit: { aKm: 395_000, e: 0.048, iRad: 0.09, nodeRad: 0.3, periRad: 2.2, meanAnomalyRad: 4 },
        radiusKm: 1790,
        massEarth: 0.0135,
        albedo: 0.12,
        iceCoverage: 0.005,
        volcanism: 0.02,
        craterDensity: 0.9,
      },
    ],
    blurb:
      'Blue oceans, green continents, weather: Halcyon has everything except anyone to complain about it. ' +
      'Its forests are ancient, photosynthetic and entirely unbothered by visitors.',
    surveyRating: 5,
    tags: ['terran world', 'habitable zone', 'living world', 'vegetation', 'oceans'],
  },
  {
    name: 'Aurelia e',
    properName: null,
    type: 'desert',
    orbit: { aKm: 1.58 * AU, e: 0.064, iRad: 0.031, nodeRad: 0.9, periRad: 5.2, meanAnomalyRad: 3.3 },
    radiusKm: 0.61 * RE,
    massEarth: 0.16,
    spin: { kind: 'hours', hours: 25.2 },
    axialTiltRad: 0.44,
    axialAzimuthRad: 3.7,
    albedo: 0.25,
    greenhouseK: 7,
    atmosphere: { pressureAtm: 0.09, composition: [['CO₂', 0.94], ['N₂', 0.035], ['Ar', 0.025]] },
    oceanCoverage: 0,
    iceCoverage: 0.07,
    volcanism: 0.08,
    craterDensity: 0.45,
    life: 'none',
    rings: null,
    moons: [],
    blurb:
      'Rust-red dunes the size of mountain ranges, a sky the colour of weak tea, and polar caps of ' +
      'frozen carbon dioxide that come and go with the seasons. Excellent for long walks, provided you bring the air.',
    surveyRating: 3.5,
    tags: ['desert world', 'dune seas', 'polar caps', 'thin CO₂ atmosphere'],
  },
  {
    name: 'Aurelia f',
    properName: null,
    type: 'gas-giant',
    orbit: { aKm: 5.6 * AU, e: 0.047, iRad: 0.022, nodeRad: 1.75, periRad: 0.25, meanAnomalyRad: 5.8 },
    radiusKm: 64_000,
    massEarth: 185,
    spin: { kind: 'hours', hours: 10.2 },
    axialTiltRad: 0.47,
    axialAzimuthRad: 2.4,
    albedo: 0.34,
    greenhouseK: 52, // internal heat: T(1 bar) ≈ 159 K
    atmosphere: { pressureAtm: 1, composition: [['H₂', 0.862], ['He', 0.132], ['CH₄', 0.0045], ['NH₃', 0.0015]] },
    oceanCoverage: 0,
    iceCoverage: 0,
    volcanism: 0,
    craterDensity: 0,
    life: 'none',
    // Inside the ice Roche limit (≈ 2.5 R for ρ = 1.0 g/cm³), like Saturn's.
    rings: { innerRadiusKm: 79_400, outerRadiusKm: 144_000, composition: 'ice', opticalDepth: 1.3 },
    moons: [
      {
        ...HOME_MOON_DEFAULTS,
        name: 'Aurelia f I',
        type: 'lava', // Io analogue: cold sulfur crust, glowing lava lakes from tidal heating
        orbit: { aKm: 410_000, e: 0.004, iRad: 0.001, nodeRad: 0.8, periRad: 1.1, meanAnomalyRad: 0.2 },
        radiusKm: 1830,
        massEarth: 0.0152,
        albedo: 0.62,
        oceanCoverage: 0.02,
        iceCoverage: 0.05,
        volcanism: 1,
        craterDensity: 0,
      },
      {
        ...HOME_MOON_DEFAULTS,
        name: 'Aurelia f II',
        type: 'ice', // Europa analogue
        orbit: { aKm: 655_000, e: 0.009, iRad: 0.008, nodeRad: 2.9, periRad: 0.4, meanAnomalyRad: 3.1 },
        radiusKm: 1570,
        massEarth: 0.0081,
        albedo: 0.67,
        iceCoverage: 1,
        volcanism: 0.15,
        craterDensity: 0.05,
      },
      {
        ...HOME_MOON_DEFAULTS,
        name: 'Aurelia f III',
        type: 'ice', // Titan analogue: thick nitrogen haze, ethane lakes
        orbit: { aKm: 1_240_000, e: 0.029, iRad: 0.006, nodeRad: 4.4, periRad: 5.9, meanAnomalyRad: 1.7 },
        radiusKm: 2590,
        massEarth: 0.0232,
        albedo: 0.22,
        greenhouseK: 9,
        atmosphere: { pressureAtm: 1.45, composition: [['N₂', 0.95], ['CH₄', 0.049], ['H₂', 0.001]] },
        oceanCoverage: 0.03,
        iceCoverage: 0.6,
        volcanism: 0.05,
        craterDensity: 0.1,
      },
      {
        ...HOME_MOON_DEFAULTS,
        name: 'Aurelia f IV',
        type: 'barren', // Callisto analogue
        orbit: { aKm: 2_150_000, e: 0.007, iRad: 0.004, nodeRad: 5.1, periRad: 2.6, meanAnomalyRad: 4.9 },
        radiusKm: 2380,
        massEarth: 0.0185,
        albedo: 0.2,
        iceCoverage: 0.25,
        volcanism: 0,
        craterDensity: 1,
      },
    ],
    blurb:
      'A banded butterscotch giant wearing the finest rings for a hundred light-years. Its four large ' +
      'moons include a volcanic hellscape, an ice-shelled ocean and a hazy orange world with lakes of ' +
      'ethane: a whole solar system in miniature, with better lighting.',
    surveyRating: 5,
    tags: ['gas giant', 'ringed', 'Sudarsky class I', '4 moons'],
  },
  {
    name: 'Aurelia g',
    properName: null,
    type: 'ice-giant',
    orbit: { aKm: 13.8 * AU, e: 0.012, iRad: 0.013, nodeRad: 3.9, periRad: 1.3, meanAnomalyRad: 0.9 },
    radiusKm: 24_700,
    massEarth: 15.8,
    spin: { kind: 'hours', hours: 17.2 },
    axialTiltRad: 1.71, // 98°: it orbits lying on its side
    axialAzimuthRad: 5.3,
    albedo: 0.3,
    greenhouseK: 7,
    atmosphere: { pressureAtm: 1, composition: [['H₂', 0.812], ['He', 0.16], ['CH₄', 0.028]] },
    oceanCoverage: 0,
    iceCoverage: 0,
    volcanism: 0,
    craterDensity: 0,
    life: 'none',
    rings: { innerRadiusKm: 40_750, outerRadiusKm: 50_600, composition: 'dust', opticalDepth: 0.06 },
    moons: [
      {
        ...HOME_MOON_DEFAULTS,
        name: 'Aurelia g I',
        type: 'ice', // Triton analogue on a retrograde orbit (i = 157°): a captured wanderer
        orbit: { aKm: 355_000, e: 0.0001, iRad: 2.74, nodeRad: 1.4, periRad: 0.7, meanAnomalyRad: 2.2 },
        radiusKm: 1355,
        massEarth: 0.00359,
        albedo: 0.76,
        iceCoverage: 0.95,
        volcanism: 0.2,
        craterDensity: 0.1,
      },
      {
        ...HOME_MOON_DEFAULTS,
        name: 'Aurelia g II',
        type: 'dwarf',
        orbit: { aKm: 640_000, e: 0.15, iRad: 0.35, nodeRad: 3.3, periRad: 4.4, meanAnomalyRad: 5.5 },
        radiusKm: 610,
        massEarth: 0.00028,
        albedo: 0.35,
        iceCoverage: 0.4,
        volcanism: 0,
        craterDensity: 0.85,
      },
    ],
    blurb:
      'A pale cyan ice giant that rolls around Aurelia on its side, so each pole gets a quarter-century ' +
      'of daylight followed by a quarter-century of night. Its largest moon orbits the wrong way round, ' +
      'which tells you everything about how it got there.',
    surveyRating: 4,
    tags: ['ice giant', 'faint rings', 'extreme axial tilt', 'retrograde moon'],
  },
  {
    name: 'Aurelia h',
    properName: null,
    type: 'dwarf',
    orbit: { aKm: 38.5 * AU, e: 0.22, iRad: 0.29, nodeRad: 1.9, periRad: 3.8, meanAnomalyRad: 0.2 },
    radiusKm: 1160,
    massEarth: 0.0021,
    spin: { kind: 'hours', hours: 153 },
    axialTiltRad: 2.1,
    axialAzimuthRad: 0.6,
    albedo: 0.52,
    greenhouseK: 0,
    atmosphere: null,
    oceanCoverage: 0,
    iceCoverage: 0.85,
    volcanism: 0.05,
    craterDensity: 0.4,
    life: 'none',
    rings: null,
    moons: [],
    blurb:
      'A small, heart-marked iceball on a lazy, tilted orbit that takes nearly a quarter of a millennium. ' +
      'Temperatures hover around −235 °C; Aurelia is just a very bright star in a black sky.',
    surveyRating: 3,
    tags: ['dwarf planet', 'eccentric orbit', 'nitrogen ice'],
  },
];

/** Hamilton product a ⊗ b of (x, y, z, w) quaternions (apply b, then a). */
function quatMul(a: QuatTuple, b: QuatTuple): QuatTuple {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Ecliptic tilted 60.2° to the galactic plane (like the Solar System's), then yawed. */
const HOME_ECLIPTIC_TO_GALACTIC: QuatTuple = quatMul(
  [0, Math.sin(1.1 / 2), 0, Math.cos(1.1 / 2)],
  [Math.sin((60.2 * Math.PI) / 180 / 2), 0, 0, Math.cos((60.2 * Math.PI) / 180 / 2)],
);

export function buildHomeSystem(star: StarDetails): StarSystem {
  const ctx = createSystemContext(star);
  const planets = PLANETS.map((spec, index) => buildPlanet(ctx, spec, index));
  const beltRng = ctx.rng.fork('belts');
  const belts: AsteroidBelt[] = [
    {
      innerRadiusKm: 2.2 * AU,
      outerRadiusKm: 3.3 * AU,
      thicknessKm: 0.25 * AU,
      count: 5000,
      composition: 'rock',
      seed: beltRng.fork('main').seed,
    },
    {
      innerRadiusKm: 30 * AU,
      outerRadiusKm: 48 * AU,
      thicknessKm: 5 * AU,
      count: 3500,
      composition: 'ice',
      seed: beltRng.fork('outer').seed,
    },
  ];
  return assembleSystem(ctx, planets, belts, HOME_ECLIPTIC_TO_GALACTIC, {
    blurb:
      'Aurelia is a calm, middle-aged yellow dwarf that did everything right: seven worlds, two belts, ' +
      'a living planet in the temperate zone and a ringed giant to show the neighbours. Start here. Everyone does.',
    surveyRating: 5,
    tags: ['home system', 'yellow dwarf', '7 planets', 'living world', 'ringed giant', 'asteroid belt'],
  });
}
