import { describe, expect, it } from 'vitest';
import { blackbodyRGB } from '../../core/color';
import type { SpectralClass, StarDetails, StarKind } from '../../core/types';
import { starLook } from './starLook';

function star(
  kind: StarKind,
  cls: SpectralClass,
  tempK: number,
  extra: Partial<StarDetails> = {},
): StarDetails {
  return {
    id: '0.0.0.0.0',
    level: 0,
    cell: [0, 0, 0],
    index: 0,
    posLy: [0, 0, 0],
    seed: 1234,
    kind,
    spectralClass: cls,
    spectralType: 'X',
    massSolar: 1,
    radiusSolar: 1,
    luminositySolar: 1,
    temperatureK: tempK,
    absMag: 4.83,
    colorRGB: blackbodyRGB(tempK || 5000),
    name: 'Test',
    designation: 'TEST',
    radiusKm: 695_700,
    ageGyr: 4,
    metallicityFeH: 0,
    rotationPeriodDays: 25,
    activity: 0.3,
    ...extra,
  };
}

describe('starLook', () => {
  it('hot O/B stars are smooth and blinding; G stars convect', () => {
    const o = starLook(star('main-sequence', 'O', 38000));
    const g = starLook(star('main-sequence', 'G', 5772));
    expect(o.convection).toBe(0);
    expect(o.activity).toBe(0);
    expect(o.prominences).toBe(0);
    expect(g.convection).toBeGreaterThan(0.9);
    expect(o.brightness).toBeGreaterThan(g.brightness);
    expect(o.closeBrightness).toBeGreaterThan(g.closeBrightness);
    expect(g.streamers).toBeGreaterThan(o.streamers);
  });

  it('keeps radiance inside the ARCHITECTURE HDR budget (6-40) and the resolved exposure below it', () => {
    for (const t of [2600, 3200, 4500, 5772, 7500, 12000, 38000]) {
      const l = starLook(star('main-sequence', 'G', t));
      expect(l.brightness).toBeGreaterThanOrEqual(6);
      expect(l.brightness).toBeLessThanOrEqual(40);
      expect(l.closeBrightness).toBeLessThan(l.brightness);
      expect(l.closeBrightness).toBeGreaterThan(0.15);
    }
  });

  it('brightness is monotonic in temperature', () => {
    let prev = 0;
    for (const t of [2800, 3500, 4200, 5000, 5800, 7000, 9000, 15000, 30000]) {
      const b = starLook(star('main-sequence', 'G', t)).brightness;
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('M dwarfs: big spots anywhere, flares when active; quiet ones do not flare', () => {
    const active = starLook(star('main-sequence', 'M', 3200, { activity: 0.9 }));
    const quiet = starLook(star('main-sequence', 'M', 3200, { activity: 0.1 }));
    expect(active.spotAnywhere).toBe(1);
    expect(active.flarePeriodSec).toBeGreaterThan(0);
    expect(active.flareStrength).toBeGreaterThan(0.5);
    expect(quiet.flarePeriodSec).toBe(0);
    expect(active.activity).toBeGreaterThan(quiet.activity);
    expect(active.activity).toBeLessThanOrEqual(1);
  });

  it('giants have few, huge cells, a soft limb and a wide glow; supergiants even more so', () => {
    const dwarf = starLook(star('main-sequence', 'K', 4500));
    const giant = starLook(star('giant', 'K', 4300));
    const sg = starLook(star('supergiant', 'M', 3500));
    expect(giant.granuleScale).toBeLessThan(dwarf.granuleScale / 3);
    expect(sg.granuleScale).toBeLessThan(giant.granuleScale);
    expect(giant.limbSoft).toBeGreaterThan(0);
    expect(sg.limbSoft).toBeGreaterThan(giant.limbSoft);
    expect(giant.haloGain).toBeGreaterThan(dwarf.haloGain);
    expect(giant.prominences).toBe(0);
  });

  it('white dwarfs and neutron stars are smooth; black holes select the hole archetype', () => {
    expect(starLook(star('white-dwarf', 'D', 14000)).convection).toBe(0);
    expect(starLook(star('neutron-star', 'N', 600000)).archetype).toBe('neutron');
    const bh = starLook(star('black-hole', 'X', 0, { colorRGB: [1, 0.6, 0.3] }));
    expect(bh.archetype).toBe('hole');
    expect(bh.tempK).toBeGreaterThan(0); // never a zero temperature reaching a shader
  });

  it('boosts chroma by 1.25 and keeps the brightest channel at 1', () => {
    const l = starLook(star('main-sequence', 'K', 4500));
    const raw = blackbodyRGB(4500);
    expect(Math.max(...l.color)).toBeCloseTo(1, 5);
    const spread = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(l.color)).toBeGreaterThan(spread(raw));
  });

  it('is deterministic and clamps hostile inputs', () => {
    const a = starLook(star('main-sequence', 'G', 5772, { activity: 7, rotationPeriodDays: 0 }));
    const b = starLook(star('main-sequence', 'G', 5772, { activity: 7, rotationPeriodDays: 0 }));
    expect(a).toEqual(b);
    expect(a.activity).toBeLessThanOrEqual(1);
    expect(a.rotationDays).toBeGreaterThan(0);
  });
});
