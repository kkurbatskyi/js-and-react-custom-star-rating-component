/**
 * Guard against accidentally offensive generated names.
 *
 * Names are assembled from syllable pools, so the risk is an unlucky join ("…ass" + "ia"). Three tiers:
 *  - `ANYWHERE`: strings that are never acceptable inside a name;
 *  - `EDGE`: short strings that are only a problem at the start or end of a word (Cassiopea is fine);
 *  - `WHOLE`: only a problem as a complete word (Titan is fine, "Tit" is not).
 * Matching ignores case, spaces, apostrophes and hyphens.
 */
const ANYWHERE: readonly string[] = [
  'fuck', 'shit', 'cunt', 'cock', 'dick', 'twat', 'wank', 'piss', 'slut', 'whore', 'bitch',
  'bastard', 'nigg', 'fagg', 'coon', 'spic', 'kike', 'chink', 'gook', 'dyke', 'tranny', 'retard',
  'rape', 'nazi', 'hitler', 'porn', 'penis', 'vagina', 'anus', 'nipple', 'boner', 'jizz', 'turd',
  'crap', 'damn', 'hell', 'skank', 'pedo', 'molest', 'lynch', 'paki', 'wetback', 'negro', 'queer',
  'homo', 'sperm', 'semen', 'orgy', 'rectum', 'scrotum', 'vulva', 'clit', 'butt', 'fart', 'poop',
  'kkk', 'isis', 'jihad', 'heil', 'cuck', 'incest', 'tard', 'spaz', 'cripple', 'gimp', 'raghead',
];

const EDGE: readonly string[] = ['ass', 'cum', 'fag', 'arse', 'fap', 'poo', 'pee', 'sex', 'god'];

const WHOLE: readonly string[] = ['tit', 'tits', 'gay', 'hoe', 'ho', 'bum', 'nip', 'nig', 'pig', 'die', 'kill'];

/** Lower-case letters only. */
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');

/** True when `name` contains a blocked string (see the tiers above). */
export function isBlockedName(name: string): boolean {
  const flat = squash(name);
  for (const bad of ANYWHERE) if (flat.includes(bad)) return true;
  for (const word of name.toLowerCase().split(/[^a-z]+/)) {
    if (!word) continue;
    for (const bad of EDGE) if (word.startsWith(bad) || word.endsWith(bad)) return true;
    for (const bad of WHOLE) if (word === bad) return true;
  }
  return false;
}
