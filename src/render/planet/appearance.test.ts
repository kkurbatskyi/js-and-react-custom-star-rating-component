import { describe, expect, it } from 'vitest';
import type { BodyBase, RGB } from '../../core/types';
import { getUniverse } from '../../universe';
import {
  annualInsolation,
  atmosphereOptics,
  CLIMATE_LUT_SIZE,
  CONTINENT_SIGMA,
  deriveLook,
  iceThresholdK,
  insolationProfile,
  NO_SEA,
  probit,
  type RockyLook,
  seaLevelForCoverage,
  temperatureProfile,
  vegetationColorForStar,
} from './appearance';

const home = (): {
  bodies: Map<string, BodyBase>;
  system: ReturnType<ReturnType<typeof getUniverse>['getSystem']>;
} => {
  const u = getUniverse();
  const system = u.getSystem(u.homeStarId());
  const bodies = new Map<string, BodyBase>();
  for (const p of system?.planets ?? []) {
    bodies.set(p.id.split('.').pop() ?? p.id, p);
    for (const m of p.moons) bodies.set(m.id.split('.').slice(-2).join('.'), m);
  }
  return { bodies, system };
};

const lum = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('probit / sea level', () => {
  it('inverts the normal CDF at known quantiles', () => {
    expect(probit(0.5)).toBeCloseTo(0, 9);
    expect(probit(0.8413447)).toBeCloseTo(1, 4);
    expect(probit(0.975)).toBeCloseTo(1.959964, 4);
    expect(probit(0.001)).toBeCloseTo(-3.090232, 4);
  });

  it('puts the sea higher for more ocean, and no sea for a dry world', () => {
    expect(seaLevelForCoverage(0)).toBe(NO_SEA);
    const levels = [0.1, 0.3, 0.5, 0.7, 0.9].map(seaLevelForCoverage);
    for (let i = 1; i < levels.length; i++)
      expect(levels[i] as number).toBeGreaterThan(levels[i - 1] as number);
    expect(seaLevelForCoverage(0.5)).toBeCloseTo(0, 9);
    expect(seaLevelForCoverage(0.84)).toBeCloseTo(CONTINENT_SIGMA * probit(0.84), 9);
  });
});

describe('vegetation colour by stellar spectrum', () => {
  it('is dark purple-black for M dwarfs, red-brown for K, green for G, blue-green for F, yellowish for A', () => {
    const m = vegetationColorForStar(3200);
    const k = vegetationColorForStar(4400);
    const g = vegetationColorForStar(5800);
    const f = vegetationColorForStar(6800);
    const a = vegetationColorForStar(8000);
    expect(m[2]).toBeGreaterThan(m[1]); // purple: blue above green
    expect(lum(m)).toBeLessThan(lum(g));
    expect(k[0]).toBeGreaterThan(k[1]); // red-brown
    expect(g[1]).toBeGreaterThan(g[0] * 1.5);
    expect(g[1]).toBeGreaterThan(g[2] * 1.5);
    expect(f[2]).toBeGreaterThan(g[2]); // bluer than G
    expect(f[1]).toBeGreaterThan(f[0]);
    expect(a[0]).toBeGreaterThan(f[0]); // yellowing
  });

  it('clamps outside the table', () => {
    expect(vegetationColorForStar(500)).toEqual(vegetationColorForStar(1000));
    expect(vegetationColorForStar(50000)).toEqual(vegetationColorForStar(20000));
  });
});

describe('climate', () => {
  const globalMean = (values: readonly number[], locked: boolean): number => {
    const n = values.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const w = locked
        ? Math.sin((i / (n - 1)) * Math.PI)
        : Math.cos((i / (n - 1)) * (Math.PI / 2));
      num += (values[i] ?? 0) * w;
      den += w;
    }
    return num / den;
  };

  it('normalises insolation to a global mean of 1', () => {
    for (const eps of [0, 0.4, 1.0, 1.71]) {
      expect(globalMean(insolationProfile(eps, false), false)).toBeCloseTo(1, 6);
    }
    expect(globalMean(insolationProfile(0, true), true)).toBeCloseTo(1, 6);
  });

  it('is warm at the equator for small tilts and warm at the poles for a tipped-over world', () => {
    expect(annualInsolation(0, 0.05)).toBeGreaterThan(annualInsolation(1.4, 0.05) * 2);
    expect(annualInsolation(Math.PI / 2, 1.71)).toBeGreaterThan(annualInsolation(0, 1.71));
  });

  it('temperature table reproduces the mean surface temperature', () => {
    const body = {
      surfaceTempK: 288,
      axialTiltRad: 0.4,
      atmosphere: { surfacePressureAtm: 1 },
    } as Pick<BodyBase, 'surfaceTempK' | 'axialTiltRad' | 'atmosphere'>;
    const t = temperatureProfile(body, false);
    expect(t).toHaveLength(CLIMATE_LUT_SIZE);
    expect(globalMean(t, false)).toBeCloseTo(288, 3);
    expect(t[0] as number).toBeGreaterThan(t[CLIMATE_LUT_SIZE - 1] as number); // equator warmer than pole
    const airless = temperatureProfile({ ...body, atmosphere: null }, false);
    expect(globalMean(airless, false)).toBeCloseTo(288, 3);
  });

  it('ice threshold covers the requested area fraction', () => {
    const profile = temperatureProfile(
      { surfaceTempK: 288, axialTiltRad: 0.4, atmosphere: { surfacePressureAtm: 1 } } as never,
      false,
    );
    for (const cover of [0.05, 0.2, 0.5]) {
      const threshold = iceThresholdK(profile, false, cover);
      // Area below the threshold, integrating the table linearly over latitude.
      const steps = 4000;
      let below = 0;
      let total = 0;
      for (let i = 0; i < steps; i++) {
        const lat = ((i + 0.5) / steps) * (Math.PI / 2);
        const x = (lat / (Math.PI / 2)) * (CLIMATE_LUT_SIZE - 1);
        const j = Math.min(CLIMATE_LUT_SIZE - 2, Math.floor(x));
        const t =
          (profile[j] as number) + ((profile[j + 1] as number) - (profile[j] as number)) * (x - j);
        const w = Math.cos(lat);
        total += w;
        if (t < threshold) below += w;
      }
      expect(below / total).toBeGreaterThan(cover - 0.06);
      expect(below / total).toBeLessThan(cover + 0.09);
    }
    expect(iceThresholdK(profile, false, 0)).toBeLessThan(0);
  });
});

describe('atmosphere optics', () => {
  it('reddens sunlight (blue extinguished most) for a Rayleigh atmosphere and is empty for vacuum', () => {
    const { bodies } = home();
    const halcyon = bodies.get('d') as BodyBase;
    const o = atmosphereOptics(halcyon);
    expect(o.sunTau[2]).toBeGreaterThan(o.sunTau[1]);
    expect(o.sunTau[1]).toBeGreaterThan(o.sunTau[0]);
    expect(o.ambient).toBeGreaterThan(0);
    const barren = atmosphereOptics(bodies.get('c') as BodyBase);
    expect(barren.pressureAtm).toBe(0);
    expect(barren.sunTau).toEqual([0, 0, 0]);
  });
});

describe('deriveLook', () => {
  it('is deterministic and covers every home-system world', () => {
    const { bodies, system } = home();
    expect(bodies.size).toBeGreaterThanOrEqual(10);
    for (const [, body] of bodies) {
      const a = deriveLook(body, system);
      const b = deriveLook(body, system);
      expect(a).toEqual(b);
      expect(a.family).toBe(
        body.type === 'gas-giant' || body.type === 'ice-giant' ? 'giant' : 'rocky',
      );
    }
  });

  it('reproduces the requested ocean coverage and adapts vegetation to the star', () => {
    const { bodies, system } = home();
    const halcyon = bodies.get('d') as BodyBase;
    const look = deriveLook(halcyon, system) as RockyLook;
    expect(look.style).toBe('biome');
    expect(look.terrain.sea).toBeCloseTo(seaLevelForCoverage(halcyon.oceanCoverage), 9);
    expect(look.colors.vegAmount).toBe(1);
    expect(look.ocean?.liquid).toBe('water');
    // Same world around a red dwarf: the (Earth-green) hint becomes dark purple-black.
    const dwarfSystem = system ? { ...system, star: { ...system.star, temperatureK: 3200 } } : null;
    const red = deriveLook(halcyon, dwarfSystem) as RockyLook;
    expect(red.colors.vegetation[2]).toBeGreaterThan(red.colors.vegetation[1]);
    expect(lum(red.colors.vegetation)).toBeLessThan(lum(look.colors.vegetation) * 1.2);
  });

  it('chooses styles, liquids and emissives by world type', () => {
    const { bodies, system } = home();
    const lava = deriveLook(bodies.get('b') as BodyBase, system) as RockyLook;
    expect(lava.style).toBe('volcanic');
    expect(lava.emissive.kind).toBe('lava');
    expect(lava.ocean?.liquid).toBe('magma');
    expect(lava.climate.locked).toBe(true); // tidally locked planet: eyeball climate
    const moon = deriveLook(bodies.get('d.1') as BodyBase, system) as RockyLook;
    expect(moon.style).toBe('regolith');
    expect(moon.airlessBrdf).toBe(true);
    expect(moon.ocean).toBeNull();
    const titan = deriveLook(bodies.get('f.3') as BodyBase, system) as RockyLook;
    expect(titan.ocean?.liquid).toBe('hydrocarbon');
  });

  it('derives band structure, storms and rings-independent parameters for giants', () => {
    const { bodies, system } = home();
    const gas = deriveLook(bodies.get('f') as BodyBase, system);
    const ice = deriveLook(bodies.get('g') as BodyBase, system);
    if (gas.family !== 'giant' || ice.family !== 'giant') throw new Error('expected giants');
    expect(gas.contrast).toBeGreaterThan(ice.contrast * 2);
    expect(gas.colors.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < gas.colors.length; i++) {
      expect(lum(gas.colors[i] as RGB)).toBeGreaterThanOrEqual(lum(gas.colors[i - 1] as RGB));
    }
    expect(ice.streaks).toBeGreaterThan(0);
    expect(gas.glow.strength).toBe(0); // 159 K: no thermal glow
  });
});
