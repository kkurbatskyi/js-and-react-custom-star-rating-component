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
  StarDetails,
  StarId,
  StarRecord,
  StarSystem,
  Vec3Tuple,
} from '../core/types';

export interface StarQueryOptions {
  /** Hard cap on returned stars (brightest-apparent first). Default 20000. */
  limit?: number;
  /**
   * Magnitude-limited selection: when set together with `observerLy`, a star is included only if
   * its apparent magnitude seen from observerLy is < magnitudeLimit. Stars within
   * `completeRadiusLy` of the observer are always included.
   */
  magnitudeLimit?: number;
  observerLy?: Vec3Tuple;
  completeRadiusLy?: number;
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
  /** Full details for a star id, or null if the id is malformed / does not exist. */
  getStar(id: StarId): StarDetails | null;
  /** Generated (and cached) planetary system for a star. */
  getSystem(id: StarId): StarSystem | null;
  /** Resolve a planet or moon id. */
  getBody(id: BodyId): BodyLookup | null;
  /** Stars within radiusLy of centerLy (see StarQueryOptions for magnitude limiting). */
  queryStars(centerLy: Vec3Tuple, radiusLy: number, opts?: StarQueryOptions): StarRecord[];
  /** Nearest star to a point within maxRadiusLy, or null. */
  nearestStar(posLy: Vec3Tuple, maxRadiusLy: number): StarRecord | null;
  /** The curated starting system near GalaxyParams.homeLy. */
  homeStarId(): StarId;
  /** A deterministic "random" star of the given kind for a given seed (for "Surprise me"). */
  randomStarId(kind: RandomStarKind, seed: number): StarId;
  /** Fuzzy search over known stars/planets (visited, remembered, notable) + exact ids/designations. */
  search(query: string, limit?: number): SearchResult[];
  /** Make an id searchable (visited, bookmarked, rated). */
  remember(id: StarId): void;
}
