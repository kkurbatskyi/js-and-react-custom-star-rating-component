import { describe, expect, it } from 'vitest';
import { halcyon, homeId, homeSystem, lanthorn, universe } from '../testing';
import {
  buildCrumbs,
  habitabilityLabel,
  homeDistanceLabel,
  objectName,
  planetTypeLabel,
  ratingWord,
  resolveObject,
  selectionForTarget,
  starClassLabel,
  surveyRatingOf,
  targetForSelection,
} from './model';

describe('resolveObject', () => {
  it('resolves stars, planets and moons', () => {
    const star = resolveObject(universe, { kind: 'star', id: homeId });
    expect(star?.kind).toBe('star');
    expect(star && objectName(star)).toBe('Aurelia');

    const planet = resolveObject(universe, { kind: 'planet', id: halcyon.id });
    expect(planet?.kind).toBe('planet');
    expect(planet && objectName(planet)).toBe('Halcyon');

    const moon = resolveObject(universe, { kind: 'moon', id: lanthorn.id });
    expect(moon?.kind).toBe('moon');
    expect(moon && objectName(moon)).toBe('Lanthorn');
  });

  it('returns null for ids that do not exist or do not match their kind', () => {
    expect(resolveObject(universe, { kind: 'star', id: 'nonsense' })).toBeNull();
    expect(resolveObject(universe, { kind: 'planet', id: `${homeId}.z` })).toBeNull();
    expect(resolveObject(universe, { kind: 'planet', id: lanthorn.id })).toBeNull();
    expect(resolveObject(universe, { kind: 'moon', id: halcyon.id })).toBeNull();
  });

  it('exposes the surveyor’s rating of whichever object it is', () => {
    const star = resolveObject(universe, { kind: 'star', id: homeId });
    expect(star && surveyRatingOf(star)).toBe(homeSystem.surveyRating);
    const planet = resolveObject(universe, { kind: 'planet', id: halcyon.id });
    expect(planet && surveyRatingOf(planet)).toBe(halcyon.surveyRating);
  });
});

describe('buildCrumbs', () => {
  const labels = (t: Parameters<typeof buildCrumbs>[0]) =>
    buildCrumbs(t, universe).map((c) => c.label);

  it('names the galaxy alone for a free point', () => {
    expect(labels({ kind: 'galaxy', centerLy: [10, 0, 5] })).toEqual([universe.galaxy.params.name]);
  });
  it('walks galaxy › star › planet › moon', () => {
    expect(labels({ kind: 'star', id: homeId })).toEqual([universe.galaxy.params.name, 'Aurelia']);
    expect(labels({ kind: 'planet', id: halcyon.id })).toEqual([
      universe.galaxy.params.name,
      'Aurelia',
      'Halcyon',
    ]);
    expect(labels({ kind: 'moon', id: lanthorn.id })).toEqual([
      universe.galaxy.params.name,
      'Aurelia',
      'Halcyon',
      'Lanthorn',
    ]);
  });
  it('makes every crumb a way back to that level', () => {
    const crumbs = buildCrumbs({ kind: 'moon', id: lanthorn.id }, universe);
    expect(crumbs.map((c) => c.target.kind)).toEqual(['galaxy', 'star', 'planet', 'moon']);
    expect(crumbs[0]?.target).toEqual({ kind: 'galaxy', centerLy: [0, 0, 0] });
  });
  it('falls back to the id for something unknown', () => {
    expect(labels({ kind: 'planet', id: 'bogus.id' }).at(-1)).toBe('bogus.id');
  });
});

describe('selection ↔ focus', () => {
  it('maps in both directions', () => {
    expect(selectionForTarget({ kind: 'galaxy', centerLy: [0, 0, 0] })).toBeNull();
    expect(selectionForTarget(null)).toBeNull();
    expect(selectionForTarget({ kind: 'planet', id: 'x' })).toEqual({ kind: 'planet', id: 'x' });
    expect(targetForSelection({ kind: 'moon', id: 'y' })).toEqual({ kind: 'moon', id: 'y' });
  });
});

describe('words', () => {
  it('labels planet types and moons', () => {
    expect(planetTypeLabel('terran')).toBe('Terran world');
    expect(planetTypeLabel('gas-giant')).toBe('Gas giant');
    expect(planetTypeLabel('ice', true)).toBe('Ice moon');
  });
  it('labels stars by kind and class', () => {
    expect(starClassLabel({ kind: 'main-sequence', spectralClass: 'G' })).toBe('Yellow dwarf');
    expect(starClassLabel({ kind: 'main-sequence', spectralClass: 'M' })).toBe('Red dwarf');
    expect(starClassLabel({ kind: 'giant', spectralClass: 'K' })).toBe('Orange giant');
    expect(starClassLabel({ kind: 'supergiant', spectralClass: 'B' })).toBe(
      'Blue-white supergiant',
    );
    expect(starClassLabel({ kind: 'black-hole', spectralClass: 'X' })).toBe('Black hole');
  });
  it('grades habitability and ratings', () => {
    expect(habitabilityLabel(1)).toBe('Earth-like');
    expect(habitabilityLabel(0.65)).toBe('Temperate');
    expect(habitabilityLabel(0.4)).toBe('Marginal');
    expect(habitabilityLabel(0.01)).toBe('Hostile');
    expect(ratingWord(0)).toBe('Not yet rated');
    expect(ratingWord(5)).toBe('Unmissable');
    expect(ratingWord(9)).toBe('Unmissable');
  });
  it('says "home system" for the home star and a distance elsewhere', () => {
    const home = universe.getRecord(homeId);
    expect(home && homeDistanceLabel(universe, home.posLy)).toBe('home system');
    const other = universe
      .queryStars(universe.galaxy.params.homeLy, 30, { limit: 5 })
      .find((s) => s.id !== homeId);
    expect(other && homeDistanceLabel(universe, other.posLy)).toMatch(/ly from home$/);
  });
});
