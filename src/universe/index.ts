/**
 * The Universe facade (contract: ./contracts.ts) — the ONLY entry point through which the engine
 * and UI read generated data. Deterministic and memoised per galaxy seed.
 *
 * Mock phase: star and system data come from ./mock.ts. The real generators (src/gen/*) will
 * replace the catalogue behind `createMockCatalog`; everything in this file (caching, queries,
 * search, random picks) is written against the `MockCatalog` shape and stays.
 */

import { formatLy } from '../core/format';
import { hash32, hashString } from '../core/hash';
import type {
  BodyId,
  GalaxyModel,
  Planet,
  SearchResult,
  SelectionRef,
  StarBlock,
  StarDetails,
  StarId,
  StarRecord,
  StarSystem,
  Vec3Tuple,
} from '../core/types';
import { LY_PER_PC } from '../core/units';
import { createGalaxyModel } from '../gen/galaxy/model';
import {
  type BlockQuery,
  type BlockQueryResult,
  type BodyLookup,
  cellSizeLy,
  LEVEL_BAND_MAG,
  LEVEL0_BRIGHT_EDGE_MAG,
  type RandomStarKind,
  type StarQueryOptions,
  type Universe,
} from './contracts';
import { parseId, starIdOf } from './ids';
import { createMockCatalog, type MockCatalog } from './mock';
import { planetTypeLabel } from './mockBodies';
import { apparentMag } from './mockPhysics';

export type {
  BlockQuery,
  BlockQueryResult,
  BodyLookup,
  RandomStarKind,
  StarQueryOptions,
  Universe,
} from './contracts';
export {
  formatBlockKey,
  formatMoonId,
  formatPlanetId,
  formatStarId,
  isStarId,
  type ParsedId,
  parseId,
  planetIdOf,
  planetLetter,
  splitStarId,
  starIdOf,
} from './ids';

/** The galaxy everyone starts in (the date this project began, 2026-09-29). */
export const DEFAULT_GALAXY_SEED = 20260929;

const DEFAULT_QUERY_LIMIT = 5000;
const DEFAULT_SEARCH_LIMIT = 10;

const universes = new Map<number, Universe>();

/** The universe for a galaxy seed (uint32). Memoised: the same seed returns the same instance. */
export function getUniverse(seed: number = DEFAULT_GALAXY_SEED): Universe {
  const key = seed >>> 0;
  let universe = universes.get(key);
  if (!universe) {
    universe = new MockUniverse(key);
    universes.set(key, universe);
  }
  return universe;
}

const dist = (a: Vec3Tuple, b: Vec3Tuple): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

interface SearchEntry {
  ref: SelectionRef;
  name: string;
  /** Lower-cased search keys (name, designation, id). */
  keys: readonly string[];
  /** Tie-breaker: distance from home, ly. */
  homeDistLy: number;
}

/** Relevance of `text` for lower-case query `q` (0 = no match). */
function matchScore(text: string, q: string): number {
  if (text === q) return 100;
  if (text.startsWith(q)) return 80 - Math.min(20, text.length - q.length) * 0.5;
  const at = text.indexOf(q);
  if (at < 0) return 0;
  const wordStart = /[\s.+\-–]/.test(text[at - 1] ?? '');
  return (wordStart ? 60 : 40) - Math.min(20, at) * 0.25;
}

const KIND_CODE: Readonly<Record<RandomStarKind, number>> = {
  any: 1,
  habitable: 2,
  ringed: 3,
  giant: 4,
  exotic: 5,
};

class MockUniverse implements Universe {
  readonly seed: number;
  readonly galaxy: GalaxyModel;
  private readonly catalog: MockCatalog;
  private readonly home: StarRecord;
  private readonly remembered = new Set<StarId>();
  private starEntries: SearchEntry[] | null = null;
  private bodyEntries: SearchEntry[] | null = null;
  private readonly candidates = new Map<RandomStarKind, StarId[]>();

  constructor(seed: number) {
    this.seed = seed;
    this.galaxy = createGalaxyModel(seed);
    this.catalog = createMockCatalog(this.galaxy);
    this.home = this.catalog.record(this.catalog.homeId) as StarRecord;
  }

  getRecord(id: StarId): StarRecord | null {
    return this.catalog.record(id);
  }

  getStar(id: StarId): StarDetails | null {
    return parseId(id)?.kind === 'star' ? this.catalog.details(id) : null;
  }

  getSystem(id: StarId): StarSystem | null {
    return parseId(id)?.kind === 'star' ? this.catalog.system(id) : null;
  }

  getBody(id: BodyId): BodyLookup | null {
    const parsed = parseId(id);
    if (!parsed || parsed.kind === 'star') return null;
    const system = this.catalog.system(parsed.starId);
    const planet = system?.planets[parsed.planetIndex];
    if (!system || !planet) return null;
    if (parsed.kind === 'planet') return { system, planet, moon: null };
    const moon = planet.moons[parsed.moonIndex];
    return moon ? { system, planet, moon } : null;
  }

  /**
   * Cells of every catalogue level that can hold a star brighter than `magnitudeLimit` as seen from
   * the observer: a level's brightest member (band edge M_b) is visible out to
   * d = 10 pc · 10^((m_lim − M_b)/5), so we return the cells whose box intersects that sphere
   * (≈ 3×3×3 per level by construction of the cell sizes). The mock has no generation to slice.
   */
  queryBlocks(q: BlockQuery): BlockQueryResult {
    const [ox, oy, oz] = q.observerLy;
    const blocks: StarBlock[] = [];
    for (const block of this.catalog.blocks.values()) {
      const brightEdge = LEVEL0_BRIGHT_EDGE_MAG - block.level * LEVEL_BAND_MAG;
      const reachLy = 10 * LY_PER_PC * 10 ** ((q.magnitudeLimit - brightEdge) / 5);
      const size = cellSizeLy(block.level);
      // Distance from the observer to the cell's box (0 inside).
      let d2 = 0;
      const o = [ox, oy, oz];
      for (let a = 0; a < 3; a++) {
        const lo = block.cell[a] * size;
        const v = o[a] < lo ? lo - o[a] : o[a] > lo + size ? o[a] - lo - size : 0;
        d2 += v * v;
      }
      if (d2 <= reachLy * reachLy) blocks.push(block);
    }
    blocks.sort((a, b) => a.level - b.level || (a.key < b.key ? -1 : 1));
    return { blocks, pending: 0 };
  }

  queryStars(centerLy: Vec3Tuple, radiusLy: number, opts: StarQueryOptions = {}): StarRecord[] {
    const limit = opts.limit ?? DEFAULT_QUERY_LIMIT;
    const observer = opts.observerLy ?? centerLy;
    const hits: { star: StarRecord; mag: number }[] = [];
    for (const star of this.catalog.stars) {
      if (dist(star.posLy, centerLy) > radiusLy) continue;
      const mag = apparentMag(star.absMag, dist(star.posLy, observer));
      if (opts.magnitudeLimit !== undefined && mag >= opts.magnitudeLimit) continue;
      hits.push({ star, mag });
    }
    hits.sort((a, b) => a.mag - b.mag); // brightest-apparent first
    const out: StarRecord[] = [];
    for (let i = 0; i < hits.length && i < limit; i++) out.push(hits[i].star);
    return out;
  }

  nearestStar(posLy: Vec3Tuple, maxRadiusLy: number): StarRecord | null {
    let best: StarRecord | null = null;
    let bestD = maxRadiusLy;
    for (const star of this.catalog.stars) {
      const d = dist(star.posLy, posLy);
      if (d <= bestD) {
        best = star;
        bestD = d;
      }
    }
    return best;
  }

  homeStarId(): StarId {
    return this.catalog.homeId;
  }

  coreStarId(): StarId {
    return this.catalog.coreId;
  }

  randomStarId(kind: RandomStarKind, seed: number): StarId {
    let pool = this.candidatesFor(kind);
    if (pool.length === 0) pool = this.candidatesFor('any');
    return pool[hash32(seed, KIND_CODE[kind]) % pool.length];
  }

  search(query: string, limit = DEFAULT_SEARCH_LIMIT): SearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q || limit <= 0) return [];
    const scored: { entry: SearchEntry; score: number }[] = [];
    const exact = parseId(q);
    const exactRef = exact ? this.refForParsedId(q) : null;
    for (const entry of [...this.getStarEntries(), ...this.getBodyEntries()]) {
      if (exactRef && entry.ref.id === exactRef.id) continue; // added below with top score
      let score = 0;
      for (let k = 0; k < entry.keys.length; k++) {
        score = Math.max(score, matchScore(entry.keys[k], q) - (k > 0 ? 5 : 0));
      }
      if (score <= 0) continue;
      const starId = starIdOf(entry.ref.id);
      if (starId && this.remembered.has(starId)) score += 3;
      if (entry.ref.id === this.home.id) score += 2;
      scored.push({ entry, score });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.homeDistLy - b.entry.homeDistLy ||
        a.entry.name.localeCompare(b.entry.name),
    );
    const results: SearchResult[] = [];
    if (exactRef) results.push(this.toResult(exactRef, 1000));
    for (const { entry, score } of scored) {
      if (results.length >= limit) break;
      results.push(this.toResult(entry.ref, score));
    }
    return results.slice(0, limit);
  }

  remember(id: StarId | BodyId): void {
    const starId = starIdOf(id);
    if (!starId || !this.catalog.record(starId) || this.remembered.has(starId)) return;
    this.remembered.add(starId);
    this.bodyEntries = null; // its planets become searchable
  }

  // ───────────────────────────────────────── internals

  private refForParsedId(id: string): SelectionRef | null {
    const parsed = parseId(id);
    if (!parsed) return null;
    if (parsed.kind === 'star') return this.catalog.record(id) ? { kind: 'star', id } : null;
    const body = this.getBody(id);
    if (!body) return null;
    return body.moon ? { kind: 'moon', id: body.moon.id } : { kind: 'planet', id: body.planet.id };
  }

  private getStarEntries(): SearchEntry[] {
    this.starEntries ??= this.catalog.stars.map((s) => ({
      ref: { kind: 'star', id: s.id },
      name: s.name,
      keys: [s.name.toLowerCase(), s.designation.toLowerCase(), s.id],
      homeDistLy: dist(s.posLy, this.home.posLy),
    }));
    return this.starEntries;
  }

  /** Planets and moons of the home system and of every remembered system. */
  private getBodyEntries(): SearchEntry[] {
    if (this.bodyEntries) return this.bodyEntries;
    const entries: SearchEntry[] = [];
    for (const starId of [this.home.id, ...this.remembered]) {
      const system = this.catalog.system(starId);
      if (!system) continue;
      const homeDistLy = dist(system.star.posLy, this.home.posLy);
      for (const planet of system.planets) {
        entries.push({
          ref: { kind: 'planet', id: planet.id },
          name: planet.name,
          keys: [planet.name.toLowerCase(), planet.id],
          homeDistLy,
        });
        for (const moon of planet.moons) {
          entries.push({
            ref: { kind: 'moon', id: moon.id },
            name: moon.name,
            keys: [moon.name.toLowerCase(), moon.id],
            homeDistLy,
          });
        }
      }
    }
    this.bodyEntries = entries;
    return entries;
  }

  private toResult(ref: SelectionRef, score: number): SearchResult {
    if (ref.kind === 'star') {
      const star = this.catalog.record(ref.id) as StarRecord;
      const system = this.catalog.system(ref.id);
      const n = system?.planets.length ?? 0;
      const d = dist(star.posLy, this.home.posLy);
      const where = ref.id === this.home.id ? 'home system' : `${formatLy(d)} from home`;
      return {
        ref,
        name: star.name,
        subtitle: `${star.spectralType} · ${n} ${n === 1 ? 'planet' : 'planets'} · ${where}`,
        score,
      };
    }
    const body = this.getBody(ref.id) as BodyLookup;
    if (body.moon) {
      return {
        ref,
        name: body.moon.name,
        subtitle: `Moon of ${body.planet.name} · ${body.system.star.name}`,
        score,
      };
    }
    const label = planetTypeLabel(body.planet.type);
    return {
      ref,
      name: body.planet.name,
      subtitle: `${label[0].toUpperCase()}${label.slice(1)} · ${body.system.star.name}`,
      score,
    };
  }

  private candidatesFor(kind: RandomStarKind): StarId[] {
    const cached = this.candidates.get(kind);
    if (cached) return cached;
    const local = this.catalog.stars.filter((s) => s.id !== this.catalog.coreId);
    const planetsOf = (id: StarId): readonly Planet[] => this.catalog.system(id)?.planets ?? [];
    let pool: StarRecord[];
    switch (kind) {
      case 'any':
        pool = local;
        break;
      case 'habitable':
        pool = local.filter((s) =>
          planetsOf(s.id).some((p) => p.life !== 'none' || p.habitability >= 0.6),
        );
        break;
      case 'ringed':
        pool = local.filter((s) => planetsOf(s.id).some((p) => p.rings !== null));
        break;
      case 'giant':
        pool = local.filter(
          (s) => s.kind === 'giant' || s.kind === 'supergiant' || s.kind === 'subgiant',
        );
        break;
      case 'exotic':
        pool = this.catalog.stars.filter(
          (s) => s.kind === 'white-dwarf' || s.kind === 'neutron-star' || s.kind === 'black-hole',
        );
        break;
    }
    // Sort by id hash so the order is independent of catalogue construction order.
    const ids = pool
      .map((s) => s.id)
      .sort((a, b) => hashString(a) - hashString(b) || (a < b ? -1 : 1));
    this.candidates.set(kind, ids);
    return ids;
  }
}
