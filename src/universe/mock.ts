/**
 * MOCK universe internals — the only module the facade (./index.ts) pulls data from.
 *
 * Contents:
 *  - Aurelia, the hand-authored home system (./mockHome.ts), at `galaxy.params.homeLy`; it is the
 *    first star drawn in its catalogue cell, so its id ends in ".0".
 *  - ~300 local stars within MOCK_RADIUS_LY of home with solar-neighbourhood class proportions
 *    (M 74 %, K 12 %, G 7 %, F 3 %, A 1 %, plus giants, white dwarfs and one pulsar).
 *  - The supermassive black hole "8.0.0.0.0" at the galactic centre (reserved id).
 *  - Every star has a system: the home system, the black hole's (empty) one, or a small
 *    procedurally-perturbed variant (./mockBodies.ts).
 *
 * Catalogue layout follows src/universe/contracts.ts exactly: level = levelForAbsMag(M),
 * cell = ⌊pos / cellSizeLy(level)⌋, index = draw order within the cell, and seeds follow the
 * ARCHITECTURE §6 hierarchy with the level folded in:
 *   cellSeed = hash32(galaxySeed, level, cx, cy, cz),  starSeed = hash32(cellSeed, index).
 * Stars are also served as `StarBlock`s (one per occupied cell).
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
  StarBlock,
  StarDetails,
  StarId,
  StarKind,
  StarRecord,
  StarSystem,
  Vec3Tuple,
} from '../core/types';
import {
  G_SI,
  SECONDS_PER_DAY,
  SOLAR_MASS_KG,
  SOLAR_RADIUS_KM,
  SPEED_OF_LIGHT_KMS,
} from '../core/units';
import { CATALOG_LEVELS, cellSizeLy, levelForAbsMag, STAR_KINDS } from './contracts';
import { formatBlockKey, formatStarId } from './ids';
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
/** The galactic-core supermassive black hole: top level, cell (0,0,0), first star (types.ts). */
export const CORE_BLACK_HOLE_ID: StarId = `${CATALOG_LEVELS - 1}.0.0.0.0`;
const CORE_BLACK_HOLE_NAME = 'Ouroboros';

export interface MockCatalog {
  /** Every star in the mock universe (home, locals and the core black hole). */
  readonly stars: readonly StarRecord[];
  /** One block per occupied catalogue cell, keyed by `${level}.${cx}.${cy}.${cz}`. */
  readonly blocks: ReadonlyMap<string, StarBlock>;
  readonly homeId: StarId;
  readonly coreId: StarId;
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
      return normalStar(
        'giant',
        rng.range(1.1, 2),
        R,
        luminosityFromRadiusTemp(R, rng.range(4100, 4700)),
        'III',
      );
    }
    case 'MIII': {
      const R = rng.range(40, 90);
      return normalStar(
        'giant',
        rng.range(1, 1.6),
        R,
        luminosityFromRadiusTemp(R, rng.range(3300, 3700)),
        'III',
      );
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

/** The supermassive black hole: r_s = 2GM/c²; the "star" we see is its hot accretion flow. */
function coreBlackHolePhysics(): StarPhysics {
  const massSolar = 4.1e6;
  const radiusKm = (2 * G_SI * massSolar * SOLAR_MASS_KG) / (SPEED_OF_LIGHT_KMS * 1000) ** 2 / 1000;
  return {
    kind: 'black-hole',
    spectralClass: 'X',
    spectralType: 'SMBH',
    massSolar,
    radiusSolar: radiusKm / SOLAR_RADIUS_KM,
    luminositySolar: 3e5, // a modestly active nucleus
    temperatureK: 0,
    absMag: -9, // bright enough for the top catalogue band
  };
}

const signed = (n: number): string => (n < 0 ? `${n}` : `+${n}`);

/** Catalogue designation, e.g. "SDR 1/406+0-3/12" (level / cell / draw index; unambiguous signs). */
export function designationOf(level: number, cell: Vec3Tuple, index: number): string {
  return `SDR ${level}/${cell[0]}${signed(cell[1])}${signed(cell[2])}/${index}`;
}

// ───────────────────────────────────────────── Catalogue

interface Draft {
  pos: Vec3Tuple;
  phys: StarPhysics;
  cls: MockClass | 'home' | 'core';
}

export function createMockCatalog(galaxy: GalaxyModel): MockCatalog {
  const galaxySeed = galaxy.params.seed >>> 0;
  const home = galaxy.params.homeLy;
  const homeL = HOME_STAR.luminositySolar;
  const homeT = effectiveTempK(homeL, HOME_STAR.radiusSolar);

  // Draw order: the core black hole and home come first in their cells (index 0).
  const drafts: Draft[] = [
    { pos: [0, 0, 0], cls: 'core', phys: coreBlackHolePhysics() },
    {
      pos: [home[0], home[1], home[2]],
      cls: 'home',
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
    let r = 0;
    while (r < MIN_HOME_DISTANCE_LY) r = MOCK_RADIUS_LY * Math.cbrt(rng.next()); // uniform in the ball
    sampleUnitVector(rng, dir);
    drafts.push({
      pos: [home[0] + dir[0] * r, home[1] + dir[1] * r, home[2] + dir[2] * r],
      phys,
      cls,
    });
  }

  const takenNames = new Set<string>([
    HOME_STAR_NAME.toLowerCase(),
    CORE_BLACK_HOLE_NAME.toLowerCase(),
  ]);
  const records: StarRecord[] = [];
  const cellCounts = new Map<string, number>();
  for (const d of drafts) {
    const level = levelForAbsMag(d.phys.absMag);
    const size = cellSizeLy(level);
    const cell: Vec3Tuple = [
      Math.floor(d.pos[0] / size),
      Math.floor(d.pos[1] / size),
      Math.floor(d.pos[2] / size),
    ];
    const key = formatBlockKey(level, cell[0], cell[1], cell[2]);
    const index = cellCounts.get(key) ?? 0;
    cellCounts.set(key, index + 1);
    const seed = hash32(hash32(galaxySeed, level, cell[0], cell[1], cell[2]), index);
    const designation = designationOf(level, cell, index);
    let name = designation;
    if (d.cls === 'home') name = HOME_STAR_NAME;
    else if (d.cls === 'core') name = CORE_BLACK_HOLE_NAME;
    else {
      const nameRng = createRng(seed).fork('name');
      const notable = d.cls !== 'M' || d.phys.absMag < 9 || nameRng.chance(0.2);
      if (notable) name = uniqueProperName(nameRng, takenNames);
    }
    records.push({
      id: formatStarId(level, cell, index),
      level,
      cell,
      index,
      posLy: d.pos,
      seed,
      ...d.phys,
      // The core's disk glows warm; everything else is its photosphere's blackbody colour.
      colorRGB: blackbodyRGB(d.cls === 'core' ? 4200 : d.phys.temperatureK),
      name,
      designation,
    });
  }
  const coreId = records[0].id;
  const homeId = records[1].id;
  if (coreId !== CORE_BLACK_HOLE_ID)
    throw new Error(`mock catalogue: core black hole got ${coreId}`);

  const byId = new Map(records.map((r) => [r.id, r]));
  const blocks = buildBlocks(records);
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
    else if (id === coreId) sys = coreSystem(star, galaxy.params.name);
    else sys = buildProceduralSystem(star);
    systemCache.set(id, sys);
    return sys;
  }

  return {
    stars: records,
    blocks,
    homeId,
    coreId,
    record: (id) => byId.get(id) ?? null,
    details,
    system,
  };
}

/** Group records (already in draw order) into struct-of-arrays blocks, one per cell. */
function buildBlocks(records: readonly StarRecord[]): Map<string, StarBlock> {
  const groups = new Map<string, StarRecord[]>();
  for (const r of records) {
    const key = formatBlockKey(r.level, r.cell[0], r.cell[1], r.cell[2]);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const blocks = new Map<string, StarBlock>();
  for (const [key, list] of groups) {
    const { level, cell } = list[0];
    const size = cellSizeLy(level);
    const originLy: Vec3Tuple = [
      (cell[0] + 0.5) * size,
      (cell[1] + 0.5) * size,
      (cell[2] + 0.5) * size,
    ];
    const n = list.length;
    const block: StarBlock = {
      key,
      level,
      cell,
      originLy,
      count: n,
      offsetsLy: new Float32Array(n * 3),
      absMag: new Float32Array(n),
      luminositySolar: new Float32Array(n),
      colorRGB: new Float32Array(n * 3),
      kind: new Uint8Array(n),
    };
    for (const r of list) {
      const i = r.index; // == position in `list`: records were emitted in draw order
      for (let c = 0; c < 3; c++) {
        block.offsetsLy[i * 3 + c] = r.posLy[c] - originLy[c];
        block.colorRGB[i * 3 + c] = r.colorRGB[c];
      }
      block.absMag[i] = r.absMag;
      block.luminositySolar[i] = r.luminositySolar;
      block.kind[i] = STAR_KINDS.indexOf(r.kind);
    }
    blocks.set(key, block);
  }
  return blocks;
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

/** [ageMin, ageMax] Gyr and [rotMin, rotMax] days per main-sequence class. */
const MS_AGE_ROTATION: Readonly<Record<string, readonly [number, number, number, number]>> = {
  M: [0.5, 10, 0.5, 100],
  K: [1, 10, 10, 45],
  G: [1, 9, 15, 35],
  F: [0.8, 4, 2, 10],
  A: [0.1, 0.9, 0.5, 2],
};

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
      return {
        ...base,
        ageGyr: rng.range(1, 10),
        rotationPeriodDays: logRange(rng, 0.02, 2),
        activity: 0,
      };
    case 'giant':
    case 'supergiant':
    case 'subgiant':
      return {
        ...base,
        ageGyr: rng.range(1.5, 9),
        rotationPeriodDays: rng.range(100, 700),
        activity: rng.range(0.02, 0.1),
      };
    case 'main-sequence': {
      const [a0, a1, r0, r1] = MS_AGE_ROTATION[rec.spectralClass] ?? [0.1, 1, 1, 5];
      const ageGyr = rng.range(a0, a1);
      const young = ageGyr < 2;
      let activity: number;
      if (rec.spectralClass === 'M') activity = young ? rng.range(0.6, 1) : rng.range(0.15, 0.5);
      else activity = rng.range(0.03, young ? 0.5 : 0.3);
      return { ...base, ageGyr, rotationPeriodDays: logRange(rng, r0, r1), activity };
    }
  }
}

function coreSystem(star: StarDetails, galaxyName: string): StarSystem {
  return assembleSystem(createSystemContext(star), [], [], [0, 0, 0, 1], {
    blurb:
      `Four million suns' worth of nothing, wrapped in a disk of gas heated to glowing. Everything in ` +
      `${galaxyName} turns around ${CORE_BLACK_HOLE_NAME}; nothing that fell in has ever filed a review.`,
    surveyRating: 5,
    tags: ['supermassive black hole', 'galactic centre', 'accretion disk'],
  });
}
