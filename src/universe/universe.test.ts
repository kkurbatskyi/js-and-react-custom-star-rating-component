import { describe, expect, it } from 'vitest';
import { hash32 } from '../core/hash';
import type { BodyBase, PlanetType, StarSystem } from '../core/types';
import { EARTH_MASS_KG, G_SI, KM_PER_AU, SECONDS_PER_DAY, SOLAR_MASS_KG } from '../core/units';
import { createGalaxyModel } from '../gen/galaxy/model';
import { CATALOG_LEVELS, cellSizeLy, levelForAbsMag, STAR_KINDS } from './contracts';
import { DEFAULT_GALAXY_SEED, getUniverse } from './index';
import { formatStarId, parseId, planetIdOf, starIdOf } from './ids';
import { createMockCatalog, MOCK_RADIUS_LY } from './mock';

const universe = getUniverse();
const homeId = universe.homeStarId();
const homeSystem = universe.getSystem(homeId) as StarSystem;
const homeStar = homeSystem.star;
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Kepler III computed independently of the implementation. */
const keplerDays = (aKm: number, massKg: number) =>
  (2 * Math.PI * Math.sqrt((aKm * 1000) ** 3 / (G_SI * massKg))) / SECONDS_PER_DAY;

/** Recursively assert there are no undefined / NaN / infinite values anywhere in an object. */
function assertComplete(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`${path} is undefined`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} is ${value}`);
  if (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value)) {
    for (const [k, v] of Object.entries(value)) assertComplete(v, `${path}.${k}`);
  }
}

/** Physics & completeness checks every generated body must pass. */
function checkBody(body: BodyBase, centralMassKg: number, starAU: number, L: number): void {
  assertComplete(body, body.id);
  expect(body.orbit.periodDays).toBeCloseTo(
    keplerDays(body.orbit.semiMajorAxisKm, centralMassKg),
    6,
  );
  const teq = 278.6 * L ** 0.25 * starAU ** -0.5 * (1 - body.albedo) ** 0.25;
  expect(body.equilibriumTempK).toBeCloseTo(teq, 9);
  expect(body.surfaceTempK).toBeCloseTo(teq + (body.atmosphere?.greenhouseK ?? 0), 9);
  expect(body.name.length).toBeGreaterThan(0);
  expect(body.blurb.length).toBeGreaterThan(20);
  expect(body.tags.length).toBeGreaterThan(0);
  expect(body.surveyRating * 2).toBe(Math.round(body.surveyRating * 2));
  expect(body.surveyRating).toBeGreaterThanOrEqual(1);
  expect(body.surveyRating).toBeLessThanOrEqual(5);
  expect(body.habitability).toBeGreaterThanOrEqual(0);
  expect(body.habitability).toBeLessThanOrEqual(1);
  expect(body.appearance.surfaceColors.length).toBeGreaterThanOrEqual(2);
  expect(body.appearance.oceanColor === null).toBe(body.oceanCoverage === 0);
  if (body.atmosphere) {
    const sum = body.atmosphere.composition.reduce((s, c) => s + c.fraction, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(body.atmosphere.scaleHeightKm).toBeGreaterThan(0);
  }
  const giant = body.type === 'gas-giant' || body.type === 'ice-giant';
  expect(body.sudarskyClass !== null).toBe(giant);
}

function checkSystem(system: StarSystem): void {
  const starMassKg = system.star.massSolar * SOLAR_MASS_KG;
  const L = system.star.luminositySolar;
  let outer = 0;
  system.planets.forEach((p, i) => {
    expect(p.id).toBe(`${system.id}.${String.fromCharCode(98 + i)}`);
    const aAU = p.orbit.semiMajorAxisKm / KM_PER_AU;
    checkBody(p, starMassKg, aAU, L);
    if (i > 0)
      expect(p.orbit.semiMajorAxisKm).toBeGreaterThan(system.planets[i - 1].orbit.semiMajorAxisKm);
    outer = Math.max(outer, p.orbit.semiMajorAxisKm * (1 + p.orbit.eccentricity));
    p.moons.forEach((m, j) => {
      expect(m.id).toBe(`${p.id}.${j + 1}`);
      expect(m.parentId).toBe(p.id);
      expect(m.rings).toBeNull();
      checkBody(m, p.massEarth * EARTH_MASS_KG, aAU, L);
      expect(universe.getBody(m.id)).toEqual({ system, planet: p, moon: m });
    });
    expect(universe.getBody(p.id)).toEqual({ system, planet: p, moon: null });
  });
  for (const b of system.belts) outer = Math.max(outer, b.outerRadiusKm);
  expect(system.radiusKm).toBeCloseTo(
    Math.max(1.5 * outer, 2000 * system.star.radiusKm, KM_PER_AU),
    3,
  );
  expect(system.blurb.length).toBeGreaterThan(20);
  const q = system.eclipticToGalactic;
  expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 12);
}

describe('ids', () => {
  it('round-trips canonical star, planet and moon ids', () => {
    const id = formatStarId(3, [101, -1, 14], 7);
    expect(id).toBe('3.101.-1.14.7');
    expect(parseId(id)).toEqual({
      kind: 'star',
      starId: id,
      level: 3,
      cell: [101, -1, 14],
      index: 7,
    });
    expect(parseId(`${id}.c`)).toMatchObject({ kind: 'planet', starId: id, planetIndex: 1 });
    expect(parseId(`${id}.c.2`)).toMatchObject({ kind: 'moon', planetId: `${id}.c`, moonIndex: 1 });
    expect(starIdOf(`${id}.c.2`)).toBe(id);
    expect(planetIdOf(`${id}.c.2`)).toBe(`${id}.c`);
  });

  it('rejects non-canonical and malformed ids', () => {
    for (const bad of [
      '',
      '1.2.3.4',
      '01.2.3.4.5',
      '1.-0.3.4.5',
      '1.+2.3.4.5',
      `${CATALOG_LEVELS}.0.0.0.0`,
      '1.2.3.4.-5',
      '1.2.3.4.5.a',
      '1.2.3.4.5.b.0',
      '1.2.3.4.5.b.1.x',
      '1.2.3.4.5 ',
    ]) {
      expect(parseId(bad), bad).toBeNull();
    }
  });
});

describe('catalogue', () => {
  it('is memoised per seed', () => {
    expect(getUniverse()).toBe(universe);
    expect(getUniverse(DEFAULT_GALAXY_SEED)).toBe(universe);
    expect(getUniverse(7)).not.toBe(universe);
  });

  it('puts Aurelia, a G2V star, at the galaxy home as the first star of its cell', () => {
    expect(homeStar).toMatchObject({
      name: 'Aurelia',
      spectralType: 'G2V',
      spectralClass: 'G',
      kind: 'main-sequence',
    });
    expect(homeStar.posLy).toEqual(universe.galaxy.params.homeLy);
    expect(parseId(homeId)).toMatchObject({ kind: 'star', index: 0 });
    expect(homeStar.temperatureK).toBeGreaterThan(5700);
    expect(homeStar.temperatureK).toBeLessThan(5900);
  });

  it('reserves 8.0.0.0.0 for the core black hole', () => {
    expect(universe.coreStarId()).toBe('8.0.0.0.0');
    const core = universe.getStar('8.0.0.0.0');
    expect(core).toMatchObject({
      kind: 'black-hole',
      spectralClass: 'X',
      posLy: [0, 0, 0],
      temperatureK: 0,
    });
    expect(universe.getSystem('8.0.0.0.0')?.planets).toEqual([]);
  });

  it('files every star under the right level, cell, index and seed', () => {
    const catalog = createMockCatalog(universe.galaxy);
    const seen = new Set<string>();
    for (const s of catalog.stars) {
      expect(seen.has(s.id)).toBe(false);
      seen.add(s.id);
      expect(s.level).toBe(levelForAbsMag(s.absMag));
      const size = cellSizeLy(s.level);
      expect(s.cell).toEqual(s.posLy.map((x) => Math.floor(x / size)));
      expect(s.id).toBe(formatStarId(s.level, s.cell, s.index));
      expect(s.seed).toBe(
        hash32(hash32(DEFAULT_GALAXY_SEED, s.level, s.cell[0], s.cell[1], s.cell[2]), s.index),
      );
      expect(Math.max(...s.colorRGB)).toBeCloseTo(1, 6);
      if (s.id !== catalog.coreId)
        expect(dist(s.posLy, homeStar.posLy)).toBeLessThanOrEqual(MOCK_RADIUS_LY);
      const block = catalog.blocks.get(s.id.slice(0, s.id.lastIndexOf('.')));
      expect(block?.absMag[s.index]).toBeCloseTo(s.absMag, 4);
      expect(STAR_KINDS[block?.kind[s.index] ?? -1]).toBe(s.kind);
      expect(universe.getRecord(s.id)).toEqual(s);
    }
    expect(catalog.stars.length).toBe(302);
  });

  it('has solar-neighbourhood class proportions', () => {
    const stars = createMockCatalog(universe.galaxy).stars;
    const frac = (pred: (c: string, k: string) => boolean) =>
      stars.filter((s) => pred(s.spectralClass, s.kind)).length / stars.length;
    const ms = (c: string) => (sc: string, k: string) => sc === c && k === 'main-sequence';
    expect(frac(ms('M'))).toBeGreaterThan(0.68);
    expect(frac(ms('M'))).toBeLessThan(0.8);
    expect(frac(ms('K'))).toBeGreaterThan(0.08);
    expect(frac(ms('K'))).toBeLessThan(0.17);
    expect(frac(ms('G'))).toBeGreaterThan(0.04);
    expect(frac(ms('G'))).toBeLessThan(0.1);
    expect(frac(ms('F'))).toBeGreaterThan(0.01);
    expect(frac(ms('F'))).toBeLessThan(0.05);
    expect(frac((_, k) => k === 'giant')).toBeGreaterThan(0);
    expect(frac((_, k) => k === 'white-dwarf')).toBeGreaterThan(0.01);
  });

  it('returns null for malformed or unknown ids', () => {
    expect(universe.getStar('nonsense')).toBeNull();
    expect(universe.getStar('0.0.0.0.99999')).toBeNull();
    expect(universe.getRecord('1.2.3')).toBeNull();
    expect(universe.getSystem('0.0.0.0.99999')).toBeNull();
    expect(universe.getBody(`${homeId}.z`)).toBeNull();
    expect(universe.getBody(`${homeId}.d.9`)).toBeNull();
    expect(universe.getBody(homeId)).toBeNull();
  });

  it('is deterministic across independent builds', () => {
    const a = createMockCatalog(createGalaxyModel(DEFAULT_GALAXY_SEED));
    const b = createMockCatalog(createGalaxyModel(DEFAULT_GALAXY_SEED));
    expect(b.stars).toEqual(a.stars);
    const someId = a.stars[40].id;
    expect(JSON.stringify(b.system(someId))).toBe(JSON.stringify(a.system(someId)));
  });
});

describe('home system', () => {
  it('has the seven hand-authored worlds in orbital order', () => {
    const types: PlanetType[] = [
      'lava',
      'barren',
      'terran',
      'desert',
      'gas-giant',
      'ice-giant',
      'dwarf',
    ];
    expect(homeSystem.planets.map((p) => p.type)).toEqual(types);
    expect(homeSystem.belts).toHaveLength(2);
  });

  it('has a living, temperate Halcyon with one moon', () => {
    const halcyon = homeSystem.planets[2];
    expect(halcyon).toMatchObject({
      name: 'Halcyon',
      properName: 'Halcyon',
      life: 'vegetation',
      inHabitableZone: true,
    });
    expect(halcyon.moons.map((m) => m.name)).toEqual(['Lanthorn']);
    expect(halcyon.surfaceTempK).toBeGreaterThan(280);
    expect(halcyon.surfaceTempK).toBeLessThan(295);
    expect(halcyon.habitability).toBeGreaterThan(0.9);
    expect(halcyon.atmosphere?.composition[0].gas).toBe('N₂');
  });

  it('has a ringed class-I gas giant with four moons and a faintly ringed ice giant with two', () => {
    const [f, g] = [homeSystem.planets[4], homeSystem.planets[5]];
    expect(f.rings?.composition).toBe('ice');
    expect(f.moons).toHaveLength(4);
    expect(f.sudarskyClass).toBe('I');
    expect(f.oblateness).toBeGreaterThan(0.05);
    expect(g.rings?.opticalDepth).toBeLessThan(0.1);
    expect(g.moons).toHaveLength(2);
    expect(g.moons[0].orbit.inclinationRad).toBeGreaterThan(Math.PI / 2); // retrograde Triton analogue
  });

  it('obeys Kepler, the T_eq formula and fills every field', () => {
    checkSystem(homeSystem);
  });

  it('gives the lava world a glow and the living world clouds and a blue sky', () => {
    expect(homeSystem.planets[0].appearance.lavaGlow).toBeGreaterThan(0.5);
    const halcyon = homeSystem.planets[2].appearance;
    expect(halcyon.cloudCoverage).toBeGreaterThan(0.3);
    expect(halcyon.hazeColor?.[2]).toBe(1);
  });
});

describe('procedural systems', () => {
  const locals = createMockCatalog(universe.galaxy).stars.filter(
    (s) => s.id !== universe.coreStarId(),
  );

  it('give every local star a valid, visitable system', () => {
    for (const s of locals) {
      const system = universe.getSystem(s.id) as StarSystem;
      expect(system.planets.length, s.id).toBeGreaterThan(0);
      checkSystem(system);
    }
  });

  it('cover every planet type somewhere in the neighbourhood', () => {
    const types = new Set<PlanetType>();
    for (const s of locals)
      for (const p of universe.getSystem(s.id)?.planets ?? []) types.add(p.type);
    expect([...types].sort()).toEqual(
      [
        'barren',
        'desert',
        'dwarf',
        'gas-giant',
        'hothouse',
        'ice',
        'ice-giant',
        'lava',
        'ocean',
        'terran',
      ].sort(),
    );
  });
});

describe('queries', () => {
  it('queryBlocks returns the cells around the observer, level by level', () => {
    const { blocks, pending } = universe.queryBlocks({
      observerLy: homeStar.posLy,
      magnitudeLimit: 6.5,
    });
    expect(pending).toBe(0);
    const homeKey = homeId.slice(0, homeId.lastIndexOf('.'));
    expect(blocks.some((b) => b.key === homeKey)).toBe(true);
    for (let i = 1; i < blocks.length; i++)
      expect(blocks[i].level).toBeGreaterThanOrEqual(blocks[i - 1].level);
    const all = universe.queryBlocks({ observerLy: homeStar.posLy, magnitudeLimit: 40 }).blocks;
    expect(all.reduce((n, b) => n + b.count, 0)).toBe(302);
  });

  it('queryStars filters by radius and magnitude, brightest-apparent first', () => {
    const centre = homeStar.posLy;
    const stars = universe.queryStars(centre, 25);
    expect(stars.length).toBeGreaterThan(3);
    expect(stars[0].id).toBe(homeId); // at distance ~0 nothing outshines the home star
    for (const s of stars) expect(dist(s.posLy, centre)).toBeLessThanOrEqual(25);
    expect(universe.queryStars(centre, 25, { limit: 2 })).toHaveLength(2);
    const bright = universe.queryStars(centre, 80, {
      magnitudeLimit: 4,
      observerLy: [centre[0] + 0.5, centre[1], centre[2]],
    });
    expect(bright.length).toBeLessThan(universe.queryStars(centre, 80).length);
  });

  it('nearestStar finds the closest star within range', () => {
    const p = homeStar.posLy;
    expect(universe.nearestStar([p[0] + 0.1, p[1], p[2]], 1)?.id).toBe(homeId);
    expect(universe.nearestStar([p[0] + 1e5, p[1], p[2]], 10)).toBeNull();
  });
});

describe('search', () => {
  it('finds stars by name prefix, case-insensitively', () => {
    expect(universe.search('aurel')[0]).toMatchObject({
      ref: { kind: 'star', id: homeId },
      name: 'Aurelia',
    });
    expect(universe.search('AURELIA')[0].subtitle).toContain('G2V');
    expect(universe.search('   ')).toEqual([]);
  });

  it('finds home planets and moons, exact ids and designations', () => {
    expect(universe.search('halcyon')[0].ref).toEqual({ kind: 'planet', id: `${homeId}.d` });
    expect(universe.search('lanthorn')[0].ref).toEqual({ kind: 'moon', id: `${homeId}.d.1` });
    expect(universe.search(homeId)[0]).toMatchObject({
      ref: { kind: 'star', id: homeId },
      score: 1000,
    });
    const other = universe.queryStars(homeStar.posLy, 30)[3];
    expect(universe.search(other.designation)[0].ref.id).toBe(other.id);
    expect(universe.search('lia').length).toBeGreaterThan(0); // substring
  });

  it('remember() makes a system searchable', () => {
    const star = universe
      .queryStars(homeStar.posLy, 60)
      .find((s) => s.id !== homeId && s.name !== s.designation);
    const planet = star ? universe.getSystem(star.id)?.planets[0] : undefined;
    if (!planet) throw new Error('fixture');
    universe.remember(planet.id);
    expect(universe.search(planet.name, 50).some((r) => r.ref.id === planet.id)).toBe(true);
  });
});

describe('randomStarId', () => {
  it('is deterministic and respects the requested kind', () => {
    for (const seed of [1, 2, 3, 42, 2026]) {
      expect(universe.randomStarId('any', seed)).toBe(universe.randomStarId('any', seed));
      const giant = universe.getStar(universe.randomStarId('giant', seed));
      expect(giant?.kind).toBe('giant');
      const exotic = universe.getStar(universe.randomStarId('exotic', seed));
      expect(['white-dwarf', 'neutron-star', 'black-hole']).toContain(exotic?.kind);
      const habitable = universe.getSystem(universe.randomStarId('habitable', seed));
      expect(habitable?.planets.some((p) => p.life !== 'none' || p.habitability >= 0.6)).toBe(true);
      const ringed = universe.getSystem(universe.randomStarId('ringed', seed));
      expect(ringed?.planets.some((p) => p.rings !== null)).toBe(true);
    }
  });
});
