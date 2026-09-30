import { describe, expect, it } from 'vitest';
import { jovian, makeBody, marsLike } from '../atmosphere/testBody';
import { deriveClouds, MAX_VORTICES, zonalEnvelope, zonalEnvelopeMean } from './params';

describe('deriveClouds', () => {
  it('draws no layer for giants, airless bodies, clear skies or negligible pressure', () => {
    expect(deriveClouds(jovian())).toBeNull();
    expect(deriveClouds(makeBody({ atmosphere: null }))).toBeNull();
    const clear = makeBody();
    clear.appearance = { ...clear.appearance, cloudCoverage: 0.005 };
    expect(deriveClouds(clear)).toBeNull();
    const thin = makeBody();
    if (thin.atmosphere) thin.atmosphere = { ...thin.atmosphere, surfacePressureAtm: 0.01 };
    expect(deriveClouds(thin)).toBeNull();
  });

  it('picks the style from the climate', () => {
    expect(deriveClouds(makeBody())?.style).toBe('cumulus');
    expect(deriveClouds(marsLike())?.style).toBe('wisp');
    const venus = makeBody({ type: 'hothouse' });
    venus.appearance = { ...venus.appearance, cloudCoverage: 1 };
    expect(deriveClouds(venus)?.style).toBe('overcast');
  });

  it('places cyclones deterministically, with the sign of the hemisphere', () => {
    const a = deriveClouds(makeBody({ seed: 42 }));
    const b = deriveClouds(makeBody({ seed: 42 }));
    const c = deriveClouds(makeBody({ seed: 43 }));
    expect(a?.vortices).toEqual(b?.vortices);
    expect(a?.vortices).not.toEqual(c?.vortices);
    expect(a?.vortices.length ?? 0).toBeGreaterThan(0);
    expect(a?.vortices.length ?? 99).toBeLessThanOrEqual(MAX_VORTICES);
    for (const v of a?.vortices ?? []) {
      expect(Math.sign(v.strength)).toBe(Math.sign(v.lat));
      expect(Math.abs(v.lat)).toBeLessThan(Math.PI / 2);
    }
    // No cyclones on wisps or overcast.
    expect(deriveClouds(marsLike())?.vortices).toEqual([]);
  });

  it('keeps the shell above the terrain and thins the sunlight above it', () => {
    const p = deriveClouds(makeBody());
    expect(p?.heightFraction ?? 0).toBeGreaterThanOrEqual(0.0025);
    expect(p?.heightFraction ?? 1).toBeLessThanOrEqual(0.012);
    // Blue is extinguished most: the terminator reddens.
    const tau = p?.sunTau ?? [1, 1, 1];
    expect(tau[2]).toBeGreaterThan(tau[0]);
    expect(tau[2]).toBeGreaterThan(0);
  });
});

describe('zonal envelope', () => {
  it('peaks at the equator and dips in the subtropics', () => {
    expect(zonalEnvelope(0)).toBeGreaterThan(zonalEnvelope(0.42));
    expect(zonalEnvelope(0.75)).toBeGreaterThan(zonalEnvelope(0.42));
    expect(zonalEnvelope(-0.3)).toBeCloseTo(zonalEnvelope(0.3), 12);
  });

  it('has a mean near 1 so the global cover follows appearance.cloudCoverage', () => {
    const m = zonalEnvelopeMean();
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThan(1.3);
  });
});
