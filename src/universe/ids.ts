/**
 * Identifier grammar (src/core/types.ts, docs/ARCHITECTURE.md §7). Ids are deep-link tokens, so
 * every object has exactly ONE canonical spelling: no leading zeros, no "-0", no '+'.
 *
 *   StarId   = `${sx}.${sy}.${sz}.${i}`   integer sector coordinates (may be negative), index ≥ 0
 *   PlanetId = `${StarId}.${letter}`      letter 'b'…'z' by orbital order (index 0 = 'b')
 *   MoonId   = `${PlanetId}.${n}`         n ≥ 1 by orbital order around the planet
 */
import type { BodyId, MoonId, PlanetId, StarId, Vec3Tuple } from '../core/types';

export type ParsedId =
  | { kind: 'star'; starId: StarId; sector: Vec3Tuple; index: number }
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

export function formatStarId(sx: number, sy: number, sz: number, index: number): StarId {
  // `${-0}` is "0", so negative zero cannot leak into an id.
  return `${sx}.${sy}.${sz}.${index}`;
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
  if (parts.length < 4 || parts.length > 6) return null;
  const [a, b, c, d, letter, moon] = parts;
  if (!SIGNED_INT.test(a) || !SIGNED_INT.test(b) || !SIGNED_INT.test(c) || !UNSIGNED_INT.test(d)) {
    return null;
  }
  const starId = `${a}.${b}.${c}.${d}`;
  if (parts.length === 4) {
    return { kind: 'star', starId, sector: [Number(a), Number(b), Number(c)], index: Number(d) };
  }
  if (!LETTER.test(letter)) return null;
  const planetIndex = letter.charCodeAt(0) - 98;
  const planetId = `${starId}.${letter}`;
  if (parts.length === 5) return { kind: 'planet', starId, planetId, planetIndex };
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
