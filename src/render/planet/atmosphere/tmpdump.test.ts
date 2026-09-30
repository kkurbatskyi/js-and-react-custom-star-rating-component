import { test } from 'vitest';
import { getUniverse } from '../../../universe';

test('dump', async () => {
  const u = getUniverse();
  const sys = u.getSystem(u.homeStarId());
  if (!sys) throw new Error('no sys');
  const rows: unknown[] = [];
  for (const p of sys.planets) {
    for (const b of [p, ...p.moons]) {
      rows.push({
        id: b.id, name: b.name, type: b.type, R: b.radiusKm, g: b.surfaceGravityG, T: b.surfaceTempK, alb: b.albedo,
        atm: b.atmosphere ? { p: b.atmosphere.surfacePressureAtm, H: b.atmosphere.scaleHeightKm, comp: b.atmosphere.composition.map((c) => `${c.gas}:${c.fraction.toFixed(3)}`).join(' ') } : null,
        app: { haze: b.appearance.hazeColor, cc: b.appearance.cloudCoverage, cloud: b.appearance.cloudColor, surf: b.appearance.surfaceColors.slice(0,3) },
        rings: b.rings, ob: b.oblateness, tilt: b.axialTiltRad, rot: b.rotationPeriodHours, sud: b.sudarskyClass, ocean: b.oceanCoverage,
      });
    }
  }
  (await import('node:fs')).writeFileSync('/tmp/claude-0/-home-user-js-and-react-custom-star-rating-component/f69d5007-1b64-52dd-afa2-7f2c4a0cfcfe/scratchpad/bodies.json', JSON.stringify(rows, null, 1));
  console.log('star', JSON.stringify({ T: sys.star.temperatureK, R: sys.star.radiusSolar, L: sys.star.luminositySolar }));
});
