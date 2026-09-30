/**
 * Body picking shared by the planet dev pages: resolve `?body=home.d` (Aurelia's letters, moons as
 * `home.d.1`), a full body id, or `?type=terran&n=2` (the n-th body of that type found near home).
 */
import type { BodyBase, PlanetType, StarSystem } from '../src/core/types';
import { getUniverse } from '../src/universe';

export interface PickedBody {
  body: BodyBase;
  system: StarSystem;
  /** Index of the body in its system's planet list, or -1 for moons. */
  planetIndex: number;
}

const TYPES: readonly PlanetType[] = [
  'lava',
  'barren',
  'desert',
  'terran',
  'ocean',
  'ice',
  'hothouse',
  'gas-giant',
  'ice-giant',
  'dwarf',
];

export function isPlanetType(s: string | null): s is PlanetType {
  return s !== null && (TYPES as readonly string[]).includes(s);
}

function bodyById(id: string): PickedBody | null {
  const u = getUniverse();
  const home = u.homeStarId();
  const resolved = id.startsWith('home.') ? `${home}.${id.slice(5)}` : id;
  const found = u.getBody(resolved);
  if (!found) return null;
  return { body: found.moon ?? found.planet, system: found.system, planetIndex: found.moon ? -1 : found.planet.index };
}

/** All bodies (planets and moons) of the home system and its neighbourhood, home first. */
export function nearbyBodies(limit = 400): PickedBody[] {
  const u = getUniverse();
  const out: PickedBody[] = [];
  const seen = new Set<string>();
  const ids = [u.homeStarId(), ...u.queryStars(u.galaxy.params.homeLy, 60, { limit }).map((r) => r.id)];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const system = u.getSystem(id);
    if (!system) continue;
    for (const planet of system.planets) {
      out.push({ body: planet, system, planetIndex: planet.index });
      for (const moon of planet.moons) out.push({ body: moon, system, planetIndex: -1 });
    }
  }
  return out;
}

/** Resolve the page's URL parameters to a body (default: Halcyon, the terran home world). */
export function pickBody(params: URLSearchParams): PickedBody {
  const id = params.get('body');
  if (id) {
    const b = bodyById(id);
    if (b) return b;
  }
  const type = params.get('type');
  if (isPlanetType(type)) {
    const n = Number(params.get('n') ?? params.get('seed') ?? 0);
    const matches = nearbyBodies().filter((b) => b.body.type === type);
    // Prefer bodies of Aurelia (hand-authored) first, then the neighbourhood.
    const pick = matches[((Math.floor(n) % matches.length) + matches.length) % matches.length];
    if (pick) return pick;
  }
  const fallback = bodyById('home.d');
  if (!fallback) throw new Error('home system has no planet d');
  return fallback;
}
