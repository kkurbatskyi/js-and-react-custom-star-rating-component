/**
 * Identifier grammar (src/core/types.ts, docs/ARCHITECTURE.md §7). Ids are deep-link tokens, so
 * every object has exactly ONE canonical spelling: no leading zeros, no "-0", no '+'.
 *
 *   BlockKey = `${level}.${cx}.${cy}.${cz}`  catalogue level (luminosity band, 0 … CATALOG_LEVELS−1)
 *                                           + integer cell coordinates at that level's cell size
 *   StarId   = `${BlockKey}.${i}`            i = the star's draw order within its cell (≥ 0)
 *   PlanetId = `${StarId}.${letter}`         letter 'b'…'z' by orbital order (index 0 = 'b')
 *   MoonId   = `${PlanetId}.${n}`            n ≥ 1 by orbital order around the planet
 */
import type { BodyId, MoonId, PlanetId, StarId, Vec3Tuple } from '../core/types';
import { CATALOG_LEVELS } from './contracts';

export type ParsedId =
  | { kind: 'star'; starId: StarId; level: number; cell: Vec3Tuple; index: number }
  | {
      kind: 'planet';
      starId: StarId;
      planetId: PlanetId;
      /** 0-based orbital order. */
      planetIndex: number;
    }
  | {
      kind: 'moon';
      starId: StarId;
      planetId: PlanetId;
      moonId: MoonId;
      planetIndex: number;
      /** 0-based orbital order around the planet (the id carries index + 1). */
      moonIndex: number;
    };

/** 'b' … 'z': at most 25 planets per system. */
export const MAX_PLANETS = 25;
export const MAX_MOONS = 99;

const SIGNED_INT = /^(0|-[1-9]\d*|[1-9]\d*)$/;
const UNSIGNED_INT = /^(0|[1-9]\d*)$/;
const LETTER = /^[b-z]$/;
const MOON_NUMBER = /^[1-9]\d?$/;

export function formatBlockKey(level: number, cx: number, cy: number, cz: number): string {
  // `${-0}` is "0", so negative zero cannot leak into an id.
  return `${level}.${cx}.${cy}.${cz}`;
}

export function formatStarId(level: number, cell: Vec3Tuple, index: number): StarId {
  return `${formatBlockKey(level, cell[0], cell[1], cell[2])}.${index}`;
}

export function planetLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PLANETS) {
    throw new RangeError(`planet index out of range: ${index}`);
  }
  return String.fromCharCode(98 + index); // 98 = 'b'
}

export function formatPlanetId(starId: StarId, index: number): PlanetId {
  return `${starId}.${planetLetter(index)}`;
}

/** `index` is the 0-based orbital order; the id carries the 1-based moon number. */
export function formatMoonId(planetId: PlanetId, index: number): MoonId {
  return `${planetId}.${index + 1}`;
}

/** Parse any star, planet or moon id. Returns null for anything non-canonical. */
export function parseId(id: string): ParsedId | null {
  const parts = id.split('.');
  if (parts.length < 5 || parts.length > 7) return null;
  const [level, cx, cy, cz, i, letter, moon] = parts;
  if (!UNSIGNED_INT.test(level) || Number(level) >= CATALOG_LEVELS) return null;
  if (!SIGNED_INT.test(cx) || !SIGNED_INT.test(cy) || !SIGNED_INT.test(cz) || !UNSIGNED_INT.test(i)) return null;
  const starId = `${level}.${cx}.${cy}.${cz}.${i}`;
  if (parts.length === 5) {
    return {
      kind: 'star',
      starId,
      level: Number(level),
      cell: [Number(cx), Number(cy), Number(cz)],
      index: Number(i),
    };
  }
  if (!LETTER.test(letter)) return null;
  const planetIndex = letter.charCodeAt(0) - 98;
  const planetId = `${starId}.${letter}`;
  if (parts.length === 6) return { kind: 'planet', starId, planetId, planetIndex };
  if (!MOON_NUMBER.test(moon)) return null;
  return { kind: 'moon', starId, planetId, moonId: id, planetIndex, moonIndex: Number(moon) - 1 };
}

export function isStarId(id: string): boolean {
  return parseId(id)?.kind === 'star';
}

/** The star that owns any star/planet/moon id, or null when malformed. */
export function starIdOf(id: string): StarId | null {
  return parseId(id)?.starId ?? null;
}

/** The planet a moon orbits (or the planet itself), or null for stars/malformed ids. */
export function planetIdOf(id: BodyId): PlanetId | null {
  const parsed = parseId(id);
  return parsed && parsed.kind !== 'star' ? parsed.planetId : null;
}

/** Split a StarId into its block key and draw index (no validation beyond the last '.'). */
export function splitStarId(id: StarId): { key: string; index: number } | null {
  const dot = id.lastIndexOf('.');
  if (dot <= 0) return null;
  const index = Number(id.slice(dot + 1));
  return Number.isInteger(index) && index >= 0 ? { key: id.slice(0, dot), index } : null;
}
