/**
 * View-model helpers: turn ids from the store into the objects the cards display, and turn
 * physical fields into words. Pure functions over the Universe facade — no React, no store.
 */
import { formatLy } from '../../core/format';
import type {
  FocusTarget,
  Moon,
  Planet,
  PlanetType,
  SelectionRef,
  StarDetails,
  StarSystem,
  Vec3Tuple,
} from '../../core/types';
import type { Universe } from '../../universe/contracts';

export type ObjectModel =
  | { kind: 'star'; id: string; star: StarDetails; system: StarSystem | null }
  | { kind: 'planet'; id: string; planet: Planet; system: StarSystem; star: StarDetails }
  | { kind: 'moon'; id: string; moon: Moon; planet: Planet; system: StarSystem; star: StarDetails };

/** Resolve a selection to everything a card needs, or null when the id is not (or no longer) valid. */
export function resolveObject(universe: Universe, ref: SelectionRef): ObjectModel | null {
  if (ref.kind === 'star') {
    const star = universe.getStar(ref.id);
    return star ? { kind: 'star', id: ref.id, star, system: universe.getSystem(ref.id) } : null;
  }
  const lookup = universe.getBody(ref.id);
  if (!lookup) return null;
  const { system, planet, moon } = lookup;
  if (ref.kind === 'moon') {
    return moon ? { kind: 'moon', id: ref.id, moon, planet, system, star: system.star } : null;
  }
  return moon ? null : { kind: 'planet', id: ref.id, planet, system, star: system.star };
}

export const objectName = (m: ObjectModel): string =>
  m.kind === 'star' ? m.star.name : m.kind === 'planet' ? m.planet.name : m.moon.name;

/** The body itself for planets/moons, null for stars. */
export const bodyOf = (m: ObjectModel): Planet | Moon | null =>
  m.kind === 'planet' ? m.planet : m.kind === 'moon' ? m.moon : null;

/** The surveyor's rating (1–5 in halves) if there is one. */
export const surveyRatingOf = (m: ObjectModel): number | null =>
  m.kind === 'star' ? (m.system?.surveyRating ?? null) : (bodyOf(m)?.surveyRating ?? null);

export function selectionForTarget(target: FocusTarget | null): SelectionRef | null {
  if (!target || target.kind === 'galaxy') return null;
  return { kind: target.kind, id: target.id };
}

export function targetForSelection(ref: SelectionRef): FocusTarget {
  switch (ref.kind) {
    case 'star':
      return { kind: 'star', id: ref.id };
    case 'planet':
      return { kind: 'planet', id: ref.id };
    case 'moon':
      return { kind: 'moon', id: ref.id };
  }
}

// ───────────────────────────────────────────────────────────── words

const PLANET_TYPE_LABEL: Readonly<Record<PlanetType, string>> = {
  lava: 'Lava world',
  barren: 'Barren world',
  desert: 'Desert world',
  terran: 'Terran world',
  ocean: 'Ocean world',
  ice: 'Ice world',
  hothouse: 'Hothouse world',
  'gas-giant': 'Gas giant',
  'ice-giant': 'Ice giant',
  dwarf: 'Dwarf planet',
};

const MOON_TYPE_LABEL: Readonly<Record<PlanetType, string>> = {
  lava: 'Volcanic moon',
  barren: 'Cratered moon',
  desert: 'Desert moon',
  terran: 'Living moon',
  ocean: 'Ocean moon',
  ice: 'Ice moon',
  hothouse: 'Hothouse moon',
  'gas-giant': 'Gas giant',
  'ice-giant': 'Ice giant',
  dwarf: 'Small moon',
};

export function planetTypeLabel(type: PlanetType, isMoon = false): string {
  return (isMoon ? MOON_TYPE_LABEL : PLANET_TYPE_LABEL)[type];
}

/** Plain-language class of a star, from its physical kind and spectral class. */
export function starClassLabel(star: Pick<StarDetails, 'kind' | 'spectralClass'>): string {
  switch (star.kind) {
    case 'black-hole':
      return 'Black hole';
    case 'neutron-star':
      return 'Neutron star';
    case 'white-dwarf':
      return 'White dwarf';
    case 'giant':
    case 'subgiant':
    case 'supergiant': {
      const hue: Partial<Record<StarDetails['spectralClass'], string>> = {
        O: 'Blue',
        B: 'Blue-white',
        A: 'White',
        F: 'Yellow-white',
        G: 'Yellow',
        K: 'Orange',
        M: 'Red',
      };
      const colour = hue[star.spectralClass];
      return colour ? `${colour} ${star.kind}` : star.kind.replace(/^./, (c) => c.toUpperCase());
    }
    case 'main-sequence': {
      const label: Partial<Record<StarDetails['spectralClass'], string>> = {
        O: 'Blue O-type star',
        B: 'Blue-white B-type star',
        A: 'White A-type star',
        F: 'Yellow-white F-type star',
        G: 'Yellow dwarf',
        K: 'Orange dwarf',
        M: 'Red dwarf',
      };
      return label[star.spectralClass] ?? 'Main-sequence star';
    }
  }
}

export function habitabilityLabel(h: number): string {
  if (h >= 0.85) return 'Earth-like';
  if (h >= 0.6) return 'Temperate';
  if (h >= 0.3) return 'Marginal';
  if (h >= 0.1) return 'Harsh';
  return 'Hostile';
}

export const LIFE_LABEL = {
  none: 'No signs of life',
  microbial: 'Microbial life',
  vegetation: 'Vegetation',
  civilization: 'Civilisation',
} as const;

/** The guidebook's verdicts, 1–5. */
export const RATING_WORDS: readonly string[] = [
  'Not yet rated',
  'Skip it',
  'Mostly harmless',
  'Worth a stop',
  'Recommended',
  'Unmissable',
];

export function ratingWord(stars: number): string {
  return RATING_WORDS[Math.max(0, Math.min(5, Math.round(stars)))] ?? RATING_WORDS[0]!;
}

// ───────────────────────────────────────────────────────────── geometry

const dist3 = (a: Vec3Tuple, b: Vec3Tuple): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const distanceLy = dist3;

/** "41.3 ly from home", "home system", "beside home" for a star position. */
export function homeDistanceLabel(universe: Universe, posLy: Vec3Tuple): string {
  const d = dist3(posLy, universe.galaxy.params.homeLy);
  return d < 0.05 ? 'home system' : `${formatLy(d)} from home`;
}

/** Distance from the galactic centre in light-years (x–z plane only, like the minimap). */
export const radiusFromCentreLy = (posLy: Vec3Tuple): number => Math.hypot(posLy[0], posLy[2]);

// ───────────────────────────────────────────────────────────── breadcrumbs

export interface Crumb {
  key: string;
  label: string;
  /** Where clicking the crumb goes. */
  target: FocusTarget;
  kind: 'galaxy' | FocusTarget['kind'];
}

const GALACTIC_CENTRE: Vec3Tuple = [0, 0, 0];

/** Galaxy › Star › Planet › Moon for a focus (or flight destination). */
export function buildCrumbs(target: FocusTarget, universe: Universe): Crumb[] {
  const crumbs: Crumb[] = [
    {
      key: 'galaxy',
      label: universe.galaxy.params.name,
      target: { kind: 'galaxy', centerLy: GALACTIC_CENTRE },
      kind: 'galaxy',
    },
  ];
  if (target.kind === 'galaxy') return crumbs;
  if (target.kind === 'star') {
    const star = universe.getRecord(target.id);
    crumbs.push({
      key: target.id,
      label: star?.name ?? target.id,
      target: { kind: 'star', id: target.id },
      kind: 'star',
    });
    return crumbs;
  }
  const lookup = universe.getBody(target.id);
  if (!lookup) {
    crumbs.push({ key: target.id, label: target.id, target, kind: target.kind });
    return crumbs;
  }
  const { system, planet, moon } = lookup;
  crumbs.push({
    key: system.id,
    label: system.star.name,
    target: { kind: 'star', id: system.id },
    kind: 'star',
  });
  crumbs.push({
    key: planet.id,
    label: planet.name,
    target: { kind: 'planet', id: planet.id },
    kind: 'planet',
  });
  if (moon && target.kind === 'moon') {
    crumbs.push({
      key: moon.id,
      label: moon.name,
      target: { kind: 'moon', id: moon.id },
      kind: 'moon',
    });
  }
  return crumbs;
}
