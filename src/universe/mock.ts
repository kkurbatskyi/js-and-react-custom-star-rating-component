/**
 * MOCK universe internals — the only module the facade (./index.ts) pulls data from.
 *
 * Contents:
 *  - Aurelia, the hand-authored home system (./mockHome.ts), in the sector containing
 *    `galaxy.params.homeLy`, at index 0 (it is the most luminous star of its sector by construction).
 *  - ~300 local stars within MOCK_RADIUS_LY of home with solar-neighbourhood class proportions
 *    (M 74 %, K 12 %, G 7 %, F 3 %, A 1 %, plus giants, white dwarfs and one pulsar). Ids, sector
 *    indices (sorted by luminosity) and seeds follow ARCHITECTURE §6 exactly:
 *      sectorSeed = hash32(galaxySeed, sx, sy, sz),  starSeed = hash32(sectorSeed, i).
 *  - The supermassive black hole "0.0.0.0" at the galactic centre (reserved id).
 *  - Every star has a system: the home system, the black hole's (empty) one, or a small
 *    procedurally-perturbed variant (./mockBodies.ts).
 *
 * The real generators (src/gen/stars, src/gen/systems) replace this file's internals; the
 * `MockCatalog` shape is what the facade needs from them.
 */
import { blackbodyRGB, spectralSubtypeOf } from '../core/color';
import { hash32 } from '../core/hash';
import { sampleUnitVector } from '../core/math';
import { createRng, shuffleInPlace } from '../core/rng';
import type {
  GalaxyModel,
  Rng,
  SpectralClass,
  StarDetails,
  StarId,
  StarKind,
  StarRecord,
  StarSystem,
  Vec3Tuple,
} from '../core/types';
import { G_SI, SECONDS_PER_DAY, SECTOR_SIZE_LY, SOLAR_MASS_KG, SOLAR_RADIUS_KM, SPEED_OF_LIGHT_KMS } from '../core/units';
import { formatStarId } from './ids';
import { assembleSystem, buildProceduralSystem, createSystemContext } from './mockBodies';
import { buildHomeSystem, HOME_STAR, HOME_STAR_NAME } from './mockHome';
import { uniqueProperName } from './mockNames';
import {
  absoluteVisualMag,
  effectiveTempK,
  luminosityFromRadiusTemp,
  mainSequenceLuminosity,
  mainSequenceRadius,
} from './mockPhysics';

/** Radius of the mock neighbourhood around home, ly. */
export const MOCK_RADIUS_LY = 80;
/** Nearest allowed neighbour to Aurelia (the Sun's is 4.2 ly). */
const MIN_HOME_DISTANCE_LY = 3.5;
/** Sector (0,0,0) index 0 is reserved for the central supermassive black hole (ARCHITECTURE §6.2). */
export const CORE_BLACK_HOLE_ID: StarId = '0.0.0.0';

export interface MockCatalog {
  /** Every star in the mock universe (home, locals and the core black hole). */
  readonly stars: readonly StarRecord[];
  readonly homeId: StarId;
  record(id: StarId): StarRecord | null;
  details(id: StarId): StarDetails | null;
  system(id: StarId): StarSystem | null;
}

// ───────────────────────────────────────────── Star physics per mock class

type MockClass = 'M' | 'K' | 'G' | 'F' | 'A' | 'KIII' | 'MIII' | 'WD' | 'NS';

/** Solar-neighbourhood proportions (RECONS-like), 300 stars in total. */
const QUOTA: readonly (readonly [MockClass, number])[] = [
  ['M', 222],
  ['K', 36],
  ['G', 20],
  ['F', 9],
  ['A', 3],
  ['KIII', 2],
  ['MIII', 1],
  ['WD', 6],
  ['NS', 1],
];

/** Main-sequence mass ranges chosen so the mass–L–R relations land in the matching class. */
const MS_MASS: Readonly<Record<'M' | 'K' | 'G' | 'F' | 'A', readonly [number, number]>> = {
  M: [0.08, 0.52],
  K: [0.52, 0.86],
  G: [0.86, 1.05],
  F: [1.05, 1.38],
  A: [1.38, 2.2],
};

interface StarPhysics {
  kind: StarKind;
  spectralClass: SpectralClass;
  spectralType: string;
  massSolar: number;
  radiusSolar: number;
  luminositySolar: number;
  temperatureK: number;
  absMag: number;
}

const logRange = (rng: Rng, min: number, max: number): number =>
  Math.exp(rng.range(Math.log(min), Math.log(max)));

function normalStar(
  kind: StarKind,
  massSolar: number,
  radiusSolar: number,
  luminositySolar: number,
  luminosityClass: string,
): StarPhysics {
  const temperatureK = effectiveTempK(luminositySolar, radiusSolar);
  const { letter, subclass } = spectralSubtypeOf(temperatureK);
  return {
    kind,
    spectralClass: letter,
    spectralType: `${letter}${subclass}${luminosityClass}`,
    massSolar,
    radiusSolar,
    luminositySolar,
    temperatureK,
    absMag: absoluteVisualMag(luminositySolar, temperatureK),
  };
}

function physicsFor(cls: MockClass, rng: Rng): StarPhysics {
  switch (cls) {
    case 'M':
    case 'K':
    case 'G':
    case 'F':
    case 'A': {
      const [lo, hi] = MS_MASS[cls];
      // Log-uniform inside the M range approximates the rising low-mass IMF.
      const mass = cls === 'M' ? logRange(rng, lo, hi) : rng.range(lo, hi);
      const L = mainSequenceLuminosity(mass) * (1 + rng.normal(0, 0.04));
      const R = mainSequenceRadius(mass) * (1 + rng.normal(0, 0.03));
      return normalStar('main-sequence', mass, R, L, 'V');
    }
    case 'KIII': {
      const R = rng.range(9, 22);
      return normalStar('giant', rng.range(1.1, 2), R, luminosityFromRadiusTemp(R, rng.range(4100, 4700)), 'III');
    }
    case 'MIII': {
      const R = rng.range(40, 90);
      return normalStar('giant', rng.range(1, 1.6), R, luminosityFromRadiusTemp(R, rng.range(3300, 3700)), 'III');
    }
    case 'WD': {
      const mass = rng.range(0.5, 0.75);
      const R = 0.0126 * (mass / 0.6) ** (-1 / 3); // Nauenberg-like R ∝ M^−⅓
      const T = logRange(rng, 5500, 25_000);
      const L = luminosityFromRadiusTemp(R, T);
      return {
        kind: 'white-dwarf',
        spectralClass: 'D',
        spectralType: `DA${Math.max(1, Math.round(50_400 / T))}`, // temperature index θ = 50400/T
        massSolar: mass,
        radiusSolar: R,
        luminositySolar: L,
        temperatureK: T,
        absMag: absoluteVisualMag(L, T),
      };
    }
    case 'NS': {
      const R = 12 / SOLAR_RADIUS_KM;
      const T = logRange(rng, 3e5, 1e6);
      const L = luminosityFromRadiusTemp(R, T);
      return {
        kind: 'neutron-star',
        spectralClass: 'N',
        spectralType: 'NS',
        massSolar: rng.range(1.3, 1.6),
        radiusSolar: R,
        luminositySolar: L,
        temperatureK: T,
        absMag: absoluteVisualMag(L, T),
      };
    }
  }
}

function sectorOf(pos: Vec3Tuple): [number, number, number] {
  return [
    Math.floor(pos[0] / SECTOR_SIZE_LY),
    Math.floor(pos[1] / SECTOR_SIZE_LY),
    Math.floor(pos[2] / SECTOR_SIZE_LY),
  ];
}

const signed = (n: number): string => (n < 0 ? `${n}` : `+${n}`);

/** Catalogue designation, e.g. "SDR 812+0-3 7" (unambiguous with negative coordinates). */
export function designationOf(sector: Vec3Tuple, index: number): string {
  return `SDR ${sector[0]}${signed(sector[1])}${signed(sector[2])} ${index}`;
}

// ───────────────────────────────────────────── Catalogue

interface Draft {
  pos: Vec3Tuple;
  phys: StarPhysics;
  cls: MockClass | 'home';
  order: number;
}

export function createMockCatalog(galaxy: GalaxyModel): MockCatalog {
  const galaxySeed = galaxy.params.seed >>> 0;
  const home = galaxy.params.homeLy;
  const homeSector = sectorOf(home);
  const homeKey = homeSector.join('.');
  const homeL = HOME_STAR.luminositySolar;
  const homeT = effectiveTempK(homeL, HOME_STAR.radiusSolar);

  const drafts: Draft[] = [
    {
      pos: [home[0], home[1], home[2]],
      cls: 'home',
      order: 0,
      phys: {
        kind: 'main-sequence',
        spectralClass: 'G',
        spectralType: HOME_STAR.spectralType,
        massSolar: HOME_STAR.massSolar,
        radiusSolar: HOME_STAR.radiusSolar,
        luminositySolar: homeL,
        temperatureK: homeT,
        absMag: absoluteVisualMag(homeL, homeT),
      },
    },
  ];

  const rng = createRng(galaxySeed).fork('mock-neighbourhood');
  const classes: MockClass[] = QUOTA.flatMap(([cls, n]) => Array.from({ length: n }, () => cls));
  shuffleInPlace(rng, classes);
  const dir: [number, number, number] = [0, 0, 0];
  for (const cls of classes) {
    const phys = physicsFor(cls, rng);
    let pos: Vec3Tuple = home;
    for (let attempt = 0; attempt < 100; attempt++) {
      sampleUnitVector(rng, dir);
      const r = MOCK_RADIUS_LY * Math.cbrt(rng.next());
      pos = [home[0] + dir[0] * r, home[1] + dir[1] * r, home[2] + dir[2] * r];
      // Keep Aurelia the brightest star of its own sector so it stays index 0.
      const clash = sectorOf(pos).join('.') === homeKey && phys.luminositySolar >= homeL;
      if (r >= MIN_HOME_DISTANCE_LY && !clash) break;
    }
    drafts.push({ pos, phys, cls, order: drafts.length });
  }

  // Group by sector, sort each by luminosity (descending) → index.
  const bySector = new Map<string, Draft[]>();
  for (const d of drafts) {
    const key = sectorOf(d.pos).join('.');
    const list = bySector.get(key);
    if (list) list.push(d);
    else bySector.set(key, [d]);
  }

  const takenNames = new Set<string>([HOME_STAR_NAME.toLowerCase(), 'ouroboros']);
  const records: StarRecord[] = [];
  let homeId = '';
  for (const list of bySector.values()) {
    list.sort((a, b) => b.phys.luminositySolar - a.phys.luminositySolar || a.order - b.order);
    list.forEach((d, index) => {
      const sector = sectorOf(d.pos);
      const id = formatStarId(sector[0], sector[1], sector[2], index);
      const seed = hash32(hash32(galaxySeed, sector[0], sector[1], sector[2]), index);
      const designation = designationOf(sector, index);
      let name = designation;
      if (d.cls === 'home') {
        name = HOME_STAR_NAME;
        homeId = id;
      } else {
        const nameRng = createRng(seed).fork('name');
        const notable = d.cls !== 'M' || d.phys.absMag < 9 || nameRng.chance(0.2);
        if (notable) name = uniqueProperName(nameRng, takenNames);
      }
      records.push({ id, sector, index, posLy: d.pos, seed, ...d.phys, colorRGB: blackbodyRGB(d.phys.temperatureK), name, designation });
    });
  }
  if (!homeId.endsWith('.0')) throw new Error(`mock catalogue: home star is not index 0 (${homeId})`);

  // The supermassive black hole at the galactic centre. r_s = 2GM/c².
  const bhMass = 4.1e6;
  const bhRadiusKm = (2 * G_SI * bhMass * SOLAR_MASS_KG) / (SPEED_OF_LIGHT_KMS * 1000) ** 2 / 1000;
  records.push({
    id: CORE_BLACK_HOLE_ID,
    sector: [0, 0, 0],
    index: 0,
    posLy: [0, 0, 0],
    seed: hash32(hash32(galaxySeed, 0, 0, 0), 0),
    kind: 'black-hole',
    spectralClass: 'X',
    spectralType: 'SMBH',
    massSolar: bhMass,
    radiusSolar: bhRadiusKm / SOLAR_RADIUS_KM,
    luminositySolar: 3000, // the hot accretion flow, not the hole
    temperatureK: 0,
    absMag: 2.5,
    colorRGB: blackbodyRGB(4200), // warm glow of the accretion disk
    name: 'Ouroboros',
    designation: designationOf([0, 0, 0], 0),
  });

  const byId = new Map(records.map((r) => [r.id, r]));
  const detailCache = new Map<StarId, StarDetails>();
  const systemCache = new Map<StarId, StarSystem>();

  function details(id: StarId): StarDetails | null {
    const cached = detailCache.get(id);
    if (cached) return cached;
    const rec = byId.get(id);
    if (!rec) return null;
    const d = id === homeId ? homeDetails(rec) : starDetails(rec);
    detailCache.set(id, d);
    return d;
  }

  function system(id: StarId): StarSystem | null {
    const cached = systemCache.get(id);
    if (cached) return cached;
    const star = details(id);
    if (!star) return null;
    let sys: StarSystem;
    if (id === homeId) sys = buildHomeSystem(star);
    else if (id === CORE_BLACK_HOLE_ID) sys = coreSystem(star, galaxy.params.name);
    else sys = buildProceduralSystem(star);
    systemCache.set(id, sys);
    return sys;
  }

  return {
    stars: records,
    homeId,
    record: (id) => byId.get(id) ?? null,
    details,
    system,
  };
}

function homeDetails(rec: StarRecord): StarDetails {
  return {
    ...rec,
    radiusKm: rec.radiusSolar * SOLAR_RADIUS_KM,
    ageGyr: HOME_STAR.ageGyr,
    metallicityFeH: HOME_STAR.metallicityFeH,
    rotationPeriodDays: HOME_STAR.rotationPeriodDays,
    activity: HOME_STAR.activity,
  };
}

function starDetails(rec: StarRecord): StarDetails {
  const rng = createRng(rec.seed).fork('details');
  const base = {
    ...rec,
    radiusKm: rec.radiusSolar * SOLAR_RADIUS_KM,
    metallicityFeH: Math.max(-1, Math.min(0.5, rng.normal(-0.05, 0.2))),
  };
  switch (rec.kind) {
    case 'black-hole':
      return { ...base, ageGyr: 12.5, rotationPeriodDays: 0.011, activity: 0.3, accretion: 0.8 };
    case 'neutron-star': {
      const pulsarPeriodSec = logRange(rng, 0.005, 1.5);
      return {
        ...base,
        ageGyr: logRange(rng, 0.001, 0.2),
        rotationPeriodDays: pulsarPeriodSec / SECONDS_PER_DAY,
        activity: 0,
        pulsarPeriodSec,
      };
    }
    case 'white-dwarf':
      return { ...base, ageGyr: rng.range(1, 10), rotationPeriodDays: logRange(rng, 0.02, 2), activity: 0 };
    case 'giant':
    case 'supergiant':
    case 'subgiant':
      return { ...base, ageGyr: rng.range(1.5, 9), rotationPeriodDays: rng.range(100, 700), activity: rng.range(0.02, 0.1) };
    case 'main-sequence': {
      const range: Readonly<Record<string, readonly [number, number, number, number]>> = {
        // [ageMin, ageMax, rotMin, rotMax]
        M: [0.5, 10, 0.5, 100],
        K: [1, 10, 10, 45],
        G: [1, 9, 15, 35],
        F: [0.8, 4, 2, 10],
        A: [0.1, 0.9, 0.5, 2],
      };
      const [a0, a1, r0, r1] = range[rec.spectralClass] ?? [0.1, 1, 1, 5];
      const ageGyr = rng.range(a0, a1);
      const young = ageGyr < 2;
      const activity =
        rec.spectralClass === 'M'
          ? young
            ? rng.range(0.6, 1)
            : rng.range(0.15, 0.5)
          : rng.range(0.03, young ? 0.5 : 0.3);
      return { ...base, ageGyr, rotationPeriodDays: logRange(rng, r0, r1), activity };
    }
  }
}

function coreSystem(star: StarDetails, galaxyName: string): StarSystem {
  const ctx = createSystemContext(star);
  return assembleSystem(ctx, [], [], [0, 0, 0, 1], {
    blurb:
      `Four million suns' worth of nothing, wrapped in a disk of gas heated to glowing. Everything in ` +
      `${galaxyName} turns around Ouroboros; nothing that falls in has ever filed a review.`,
    surveyRating: 5,
    tags: ['supermassive black hole', 'galactic centre', 'accretion disk'],
  });
}
