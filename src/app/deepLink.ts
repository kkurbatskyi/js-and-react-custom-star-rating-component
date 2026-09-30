/**
 * Deep links (docs/ARCHITECTURE.md §7): `location.hash` holds a bare token `[<galaxySeed>~]<id>` — a
 * StarId, PlanetId or MoonId, prefixed with the seed only when it isn't the default. Only
 * `[A-Za-z0-9._~-]` survive the hosting sandbox, and our ids are made of exactly those.
 */
import type { FocusTarget } from '../core/types';
import { DEFAULT_GALAXY_SEED, parseId } from '../universe';

export interface DeepLink {
  /** Galaxy seed from the token, or null when absent (= the current/default seed). */
  seed: number | null;
  target: FocusTarget;
}

const SEED = /^(0|[1-9]\d{0,9})$/;

/** Parse `#token` / `token`; null for anything that is not a valid star/planet/moon token. */
export function parseDeepLink(hash: string): DeepLink | null {
  let token = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    token = decodeURIComponent(token).trim();
  } catch {
    return null;
  }
  if (!token) return null;
  let seed: number | null = null;
  const tilde = token.indexOf('~');
  if (tilde >= 0) {
    const s = token.slice(0, tilde);
    if (!SEED.test(s) || Number(s) > 0xffffffff) return null;
    seed = Number(s);
    token = token.slice(tilde + 1);
  }
  const parsed = parseId(token);
  if (!parsed) return null;
  const target: FocusTarget =
    parsed.kind === 'star'
      ? { kind: 'star', id: parsed.starId }
      : parsed.kind === 'planet'
        ? { kind: 'planet', id: parsed.planetId }
        : { kind: 'moon', id: parsed.moonId };
  return { seed, target };
}

/** The token for a focus ('' for galaxy points, which are not linkable). */
export function formatDeepLink(target: FocusTarget | null, seed: number): string {
  if (!target || target.kind === 'galaxy') return '';
  return seed >>> 0 === DEFAULT_GALAXY_SEED ? target.id : `${seed >>> 0}~${target.id}`;
}

/** Keep `location.hash` in sync without adding history entries; never throws (sandboxed hosts). */
export function writeHash(token: string): void {
  try {
    const current = window.location.hash.replace(/^#/, '');
    if (current === token) return;
    const url = token
      ? `#${token}`
      : `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // history unavailable (sandbox): the link simply is not kept in sync.
  }
}
