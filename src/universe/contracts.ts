/**
 * The Universe facade: the single entry point the engine and UI use to read generated data.
 * Implemented in src/universe/index.ts (deterministic, cached).
 */
import type {
  BodyId,
  GalaxyModel,
  Moon,
  Planet,
  SearchResult,
  StarBlock,
  StarDetails,
  StarId,
  StarKind,
  StarRecord,
  StarSystem,
  Vec3Tuple,
} from '../core/types';

// ───────────────────────────────────────────── Stratified star catalogue
//
// Stars live in luminosity bands ("levels"). Level ℓ uses cubic cells of BASE_CELL_LY·2^ℓ ly, sized so a
// band's stars stay visible (m ≈ 6.5) out to about one cell — a magnitude-limited view therefore only
// touches ~3×3×3 cells per level instead of millions of small sectors. Level 0 holds everything fainter
// than M = 5.0 (most stars), each next level a 1.5-mag brighter band, the last level everything brighter.

/**
 * Bump when generation output changes in any way; persisted user data (ratings, bookmarks) is keyed
 * by it. Once released, changing stellarDensity / the catalogue / system generation REQUIRES a bump.
 */
export const GEN_VERSION = 1;

export const CATALOG_LEVELS = 9;
export const BASE_CELL_LY = 32;
/** Absolute magnitude upper (bright) edge of level 0's band; each level is 1.5 mag brighter. */
export const LEVEL0_BRIGHT_EDGE_MAG = 5.0;
export const LEVEL_BAND_MAG = 1.5;

/** Index → StarKind for StarBlock.kind. */
export const STAR_KINDS: readonly StarKind[] = [
  'main-sequence',
  'subgiant',
  'giant',
  'supergiant',
  'white-dwarf',
  'neutron-star',
  'black-hole',
];

export function cellSizeLy(level: number): number {
  return BASE_CELL_LY * 2 ** level;
}

/** Catalogue level whose band contains absolute magnitude `absMag`. */
export function levelForAbsMag(absMag: number): number {
  if (absMag > LEVEL0_BRIGHT_EDGE_MAG) return 0;
  const l = 1 + Math.floor((LEVEL0_BRIGHT_EDGE_MAG - absMag) / LEVEL_BAND_MAG);
  return Math.min(CATALOG_LEVELS - 1, l);
}

/** [brightEdge, faintEdge) of a level's band in absolute magnitude (±Infinity at the open ends). */
export function levelBand(level: number): readonly [number, number] {
  const faint = level === 0 ? Number.POSITIVE_INFINITY : LEVEL0_BRIGHT_EDGE_MAG - (level - 1) * LEVEL_BAND_MAG;
  const bright =
    level >= CATALOG_LEVELS - 1 ? Number.NEGATIVE_INFINITY : LEVEL0_BRIGHT_EDGE_MAG - level * LEVEL_BAND_MAG;
  return [bright, faint];
}

// ───────────────────────────────────────────── Queries

export interface StarQueryOptions {
  /** Hard cap on returned stars (brightest-apparent first). Default 5000. */
  limit?: number;
  /** Only stars brighter than this apparent magnitude as seen from `observerLy` (default: the query centre). */
  magnitudeLimit?: number;
  observerLy?: Vec3Tuple;
}

export interface BlockQuery {
  /** Where the viewer is (galactic ly). */
  observerLy: Vec3Tuple;
  /** Apparent-magnitude limit for the view (≈ 6.5–8). */
  magnitudeLimit: number;
  /** Max milliseconds to spend generating missing cells in this call (time-slicing). Default 4. */
  budgetMs?: number;
}

export interface BlockQueryResult {
  /** Blocks (cached or freshly generated) needed for the view; stable object identity while cached. */
  blocks: StarBlock[];
  /** Cells still to generate — call again next frame while > 0. */
  pending: number;
}

export type RandomStarKind = 'any' | 'habitable' | 'ringed' | 'giant' | 'exotic';

export interface BodyLookup {
  system: StarSystem;
  planet: Planet;
  /** Non-null when the id names a moon. */
  moon: Moon | null;
}

export interface Universe {
  readonly seed: number;
  readonly galaxy: GalaxyModel;
  /** Lightweight record for a star id (lazy — built from its block), or null if malformed/nonexistent. */
  getRecord(id: StarId): StarRecord | null;
  /** Full details for a star id, or null. */
  getStar(id: StarId): StarDetails | null;
  /** Generated (and cached) planetary system for a star. */
  getSystem(id: StarId): StarSystem | null;
  /** Resolve a planet or moon id. */
  getBody(id: BodyId): BodyLookup | null;
  /** Magnitude-limited, time-sliced catalogue cells around an observer (for the starfield). */
  queryBlocks(q: BlockQuery): BlockQueryResult;
  /** Small-radius star query returning records (search, "nearby stars" lists). Keep radius ≲ 50 ly. */
  queryStars(centerLy: Vec3Tuple, radiusLy: number, opts?: StarQueryOptions): StarRecord[];
  /** Nearest star to a point within maxRadiusLy (≲ 50 ly), or null. */
  nearestStar(posLy: Vec3Tuple, maxRadiusLy: number): StarRecord | null;
  /** The curated starting system near GalaxyParams.homeLy. */
  homeStarId(): StarId;
  /** The galactic-core supermassive black hole. */
  coreStarId(): StarId;
  /** A deterministic "random" star of the given kind for a given seed (for "Surprise me"). */
  randomStarId(kind: RandomStarKind, seed: number): StarId;
  /** Fuzzy search over known stars/planets (visited, remembered, notable) + exact ids/designations. */
  search(query: string, limit?: number): SearchResult[];
  /** Make a star or body searchable (visited, bookmarked, rated). */
  remember(id: StarId | BodyId): void;
}
