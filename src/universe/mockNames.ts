/**
 * MOCK proper-name generator (syllable grammar). src/gen/names replaces this with the real
 * naming system; the mock only needs names that are pronounceable, deterministic and unique.
 */
import type { Rng } from '../core/types';

const FIRST = [
  'Al', 'Ar', 'Ba', 'Bel', 'Cae', 'Cal', 'Cor', 'Da', 'Del', 'E', 'El', 'Er', 'Fa', 'Gal', 'Ha',
  'Hes', 'I', 'Il', 'Ka', 'Kor', 'La', 'Lu', 'Ma', 'Mar', 'Mi', 'Ne', 'Nor', 'O', 'Or', 'Pa',
  'Pha', 'Rhe', 'Sa', 'Sel', 'Ta', 'Tal', 'Te', 'Ul', 'Va', 'Vel', 'Xa', 'Ze',
] as const;
const MIDDLE = [
  'ba', 'da', 'la', 'le', 'li', 'lo', 'ma', 'na', 'ne', 'ni', 'ra', 're', 'ri', 'ro', 'sa', 'ta',
  'te', 'the', 'va', 'ven', 'ya',
] as const;
const LAST = [
  'bar', 'dor', 'gon', 'ion', 'ira', 'is', 'ith', 'ix', 'lia', 'lon', 'mos', 'nar', 'ne', 'nia',
  'nor', 'on', 'phe', 'ra', 'ria', 'ris', 'ron', 'sa', 'sis', 'thea', 'tis', 'us', 'vara', 'xis',
] as const;

/** A pronounceable two- or three-syllable proper name, e.g. "Velanar", "Caeris". 2–3 draws. */
export function properName(rng: Rng): string {
  const first = rng.pick(FIRST);
  const middle = rng.chance(0.45) ? rng.pick(MIDDLE) : '';
  return first + middle + rng.pick(LAST);
}

/**
 * A proper name not yet in `taken` (which it then joins). Retries use fresh forks, so the result
 * depends only on `rng.seed` and on which names were taken before.
 */
export function uniqueProperName(rng: Rng, taken: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const name = properName(attempt === 0 ? rng : rng.fork(attempt));
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      return name;
    }
  }
  const fallback = `${properName(rng.fork('fallback'))} ${taken.size}`;
  taken.add(fallback.toLowerCase());
  return fallback;
}
