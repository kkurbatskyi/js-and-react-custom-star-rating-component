import { describe, expect, it } from 'vitest';
import { deriveAtmosphere, extinctionAt, rayleighColumn } from './params';
import { jovian, makeBody, marsLike } from './testBody';

describe('deriveAtmosphere', () => {
  it('returns null for airless bodies, negligible pressure and bodies without a haze colour', () => {
    expect(deriveAtmosphere(makeBody({ atmosphere: null }))).toBeNull();
    const thin = makeBody();
    if (thin.atmosphere) thin.atmosphere = { ...thin.atmosphere, surfacePressureAtm: 0.001 };
    expect(deriveAtmosphere(thin)).toBeNull();
    const noHaze = makeBody();
    noHaze.appearance = { ...noHaze.appearance, hazeColor: null };
    expect(deriveAtmosphere(noHaze)).toBeNull();
  });

  it('gives an Earth-like world Earth’s zenith Rayleigh optical depth (blue >> red)', () => {
    const p = deriveAtmosphere(makeBody());
    expect(p?.kind).toBe('terran');
    if (!p) return;
    const [r, g, b] = p.zenithTau;
    // Rayleigh (0.046, 0.108, 0.265) + a clear-sky aerosol (~0.08) + ozone absorption.
    expect(r).toBeGreaterThan(0.04);
    expect(r).toBeLessThan(0.2);
    expect(g).toBeGreaterThan(0.1);
    expect(g).toBeLessThan(0.3);
    expect(b).toBeGreaterThan(0.25);
    expect(b).toBeLessThan(0.45);
    expect(b / r).toBeGreaterThan(2);
    // The shell is a fraction of a percent to a few percent of the radius.
    expect(p.topKm).toBeGreaterThan(50);
    expect(p.topKm).toBeLessThan(120);
  });

  it('adds an ozone layer only on oxygen worlds, with the Chappuis band (green > red >> blue)', () => {
    const earth = deriveAtmosphere(makeBody());
    const mars = deriveAtmosphere(marsLike());
    expect(earth?.absorber.beta[1]).toBeGreaterThan(0);
    expect(earth?.absorber.beta[1] ?? 0).toBeGreaterThan(earth?.absorber.beta[0] ?? 1);
    expect(earth?.absorber.beta[0] ?? 0).toBeGreaterThan((earth?.absorber.beta[2] ?? 1) * 4);
    expect(mars?.absorber.beta).toEqual([0, 0, 0]);
  });

  it('classifies dusty, hazy, dense and giant atmospheres', () => {
    expect(deriveAtmosphere(marsLike())?.kind).toBe('dusty');
    const titan = makeBody({
      type: 'ice',
      radiusKm: 2575,
      surfaceGravityG: 0.14,
      atmosphere: {
        surfacePressureAtm: 1.45,
        composition: [
          { gas: 'N₂', fraction: 0.95 },
          { gas: 'CH₄', fraction: 0.05 },
        ],
        scaleHeightKm: 26,
        greenhouseK: 20,
      },
      appearance: { ...makeBody().appearance, hazeColor: [1, 0.58, 0.25], cloudCoverage: 0.15 },
    });
    const hazy = deriveAtmosphere(titan);
    expect(hazy?.kind).toBe('hazy');
    // Orange haze: the blue channel is absorbed far more than the red one.
    expect(hazy?.zenithTau[2] ?? 0).toBeGreaterThan((hazy?.zenithTau[0] ?? 1) * 2);
    expect(hazy?.topKm ?? 0).toBeGreaterThan(150);

    const venus = makeBody({
      type: 'hothouse',
      atmosphere: {
        surfacePressureAtm: 90,
        composition: [{ gas: 'CO₂', fraction: 0.96 }],
        scaleHeightKm: 16,
        greenhouseK: 400,
      },
      appearance: { ...makeBody().appearance, cloudCoverage: 1, hazeColor: [0.9, 0.8, 0.5] },
    });
    expect(deriveAtmosphere(venus)?.kind).toBe('dense');

    const giant = deriveAtmosphere(jovian());
    expect(giant?.kind).toBe('gas-giant');
    // The real 31 km scale height would be sub-pixel: the shell is inflated to a visible fraction of R.
    expect(giant?.rayleigh.heightKm ?? 0).toBeGreaterThan(100);
    expect((giant?.topKm ?? 0) / 64000).toBeGreaterThan(0.01);
  });

  it('gives ice giants a methane (red) absorber: a cyan limb', () => {
    const ice = deriveAtmosphere(
      makeBody({
        type: 'ice-giant',
        radiusKm: 24700,
        surfaceGravityG: 1.05,
        life: 'none',
        atmosphere: {
          surfacePressureAtm: 1,
          composition: [
            { gas: 'H₂', fraction: 0.81 },
            { gas: 'He', fraction: 0.16 },
            { gas: 'CH₄', fraction: 0.028 },
          ],
          scaleHeightKm: 22,
          greenhouseK: 0,
        },
        appearance: { ...makeBody().appearance, hazeColor: [0.42, 0.78, 1] },
      }),
    );
    expect(ice?.kind).toBe('ice-giant');
    expect(ice?.absorber.beta[0] ?? 0).toBeGreaterThan((ice?.absorber.beta[2] ?? 1) * 10);
  });

  it('caps the Rayleigh column of very dense atmospheres and scales with pressure/gravity', () => {
    const light = makeBody({ surfaceGravityG: 0.5 });
    expect(rayleighColumn(light)).toBeCloseTo(2, 1);
    const p = deriveAtmosphere(
      makeBody({
        atmosphere: {
          surfacePressureAtm: 90,
          composition: [{ gas: 'N₂', fraction: 1 }],
          scaleHeightKm: 8,
          greenhouseK: 0,
        },
      }),
    );
    expect(p?.zenithTau[2] ?? 0).toBeLessThan(6); // bounded by the visual cap, not 90 x Earth
  });

  it('extinctionAt decays with altitude', () => {
    const p = deriveAtmosphere(makeBody());
    if (!p) throw new Error('no atmosphere');
    const low = extinctionAt(p, 0);
    const high = extinctionAt(p, 40);
    expect(high[2]).toBeLessThan(low[2]);
  });
});
