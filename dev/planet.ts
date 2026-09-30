/**
 * Planet dev page — one world under the real PostFX pipeline.
 *
 *   ?body=home.d          Aurelia's bodies by letter (b c d e f g h; moons home.d.1, home.f.3, ...) or a full id
 *   ?type=terran&n=1      the n-th body of a type near home
 *   ?view=far|mid|close|terminator|crescent|surface   camera preset (surface: &alt=<km>)
 *   ?sun=<azimuthDeg>,<elevationDeg>   sun relative to the camera (0,0 = behind the camera)
 *   ?spin=<deg>           rotation about the spin axis     ?lite=1   the cheap 'lite' visual
 *   ?debug=albedo|normal|height   surface debug views      ?moon=1   add the first moon as an eclipse caster
 */
import * as THREE from 'three';
import { blackbodyRGB } from '../src/core/color';
import { bodyOrientation } from '../src/sim/orientation';
import type { PlanetUniforms } from '../src/render/contracts';
import { PlanetVisual } from '../src/render/planet/PlanetVisual';
import { createHarness } from './harness';
import { pickBody } from './planetBodies';

const params = new URLSearchParams(location.search);
const picked = pickBody(params);
const { body, system } = picked;
const R = body.radiusKm;

const view = params.get('view') ?? 'mid';
const VIEWS: Record<string, { dist: number; az: number; el: number; lat: number }> = {
  far: { dist: 7, az: 40, el: 18, lat: 8 },
  mid: { dist: 3.2, az: 38, el: 16, lat: 10 },
  close: { dist: 1.3, az: 40, el: 20, lat: 25 },
  terminator: { dist: 3.2, az: 100, el: 4, lat: 12 },
  crescent: { dist: 3.6, az: 148, el: 8, lat: 14 },
  surface: { dist: 1.03, az: 60, el: 25, lat: 30 },
};
const preset = VIEWS[view] ?? VIEWS.mid;
if (!preset) throw new Error('no view preset');
const alt = Number(params.get('alt') ?? R * 0.03);
const distR = view === 'surface' ? 1 + alt / R : preset.dist;
const latRad = THREE.MathUtils.degToRad(preset.lat);
const camDir = new THREE.Vector3(0, Math.sin(latRad), Math.cos(latRad));

const h = createHarness({
  title: `${body.name} · ${body.type}`,
  fov: 34,
  near: R * 1e-4,
  far: R * 400,
  cameraPosition: camDir.clone().multiplyScalar(R * distR),
  target: view === 'surface' ? [0, R * 0.28, R * 0.55] : [0, 0, 0],
  minDistance: R * 1.001,
  maxDistance: R * 80,
  simRate: 0,
});

const detail = params.get('lite') === '1' ? 'lite' : 'full';
const visual = new PlanetVisual(body, { system }, h.quality, detail);
h.scene.add(visual.object);
window.__PLANET__ = visual;
if (params.get('shells') === '0') {
  // Judge the surface on its own: hide atmosphere, clouds and rings (the sky specialist's parts).
  for (const child of visual.object.children) if (child.name !== 'surface') child.visible = false;
}

const sunParam = (params.get('sun') ?? '').split(',').map(Number);
const ctl = {
  sunAz: Number.isFinite(sunParam[0]) && params.has('sun') ? (sunParam[0] as number) : preset.az,
  sunEl: Number.isFinite(sunParam[1]) && params.has('sun') ? (sunParam[1] as number) : preset.el,
  spin: Number(params.get('spin') ?? 0),
  intensity: 1,
  sunIntensity: 1,
  debug: params.get('debug') === 'albedo' ? 1 : params.get('debug') === 'normal' ? 2 : params.get('debug') === 'height' ? 3 : 0,
};
h.gui.add(ctl, 'sunAz', -180, 180, 1).name('sun azimuth');
h.gui.add(ctl, 'sunEl', -80, 80, 1).name('sun elevation');
h.gui.add(ctl, 'spin', 0, 360, 1).name('spin (deg)');
h.gui.add(ctl, 'sunIntensity', 0.4, 2, 0.01).name('sun intensity');
h.gui.add(ctl, 'intensity', 0, 1.5, 0.01).name('fade / intensity');
h.gui.add(ctl, 'debug', { shaded: 0, albedo: 1, normal: 2, height: 3 }).onChange((v: number) => visual.setDebug(v));
visual.setDebug(ctl.debug);

const star = system.star;
const sunColor = new THREE.Color().setRGB(...blackbodyRGB(star.temperatureK));
const sunAngular = Math.atan(star.radiusSolar * 695_700 / (Math.max(body.orbit.semiMajorAxisKm, 1) * (picked.planetIndex >= 0 ? 1 : 1)));

const q = new THREE.Quaternion();
const spinQ = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);
const rel = new THREE.Vector3();
const sunDir = new THREE.Vector3();
const camAxis = new THREE.Vector3();
const u: PlanetUniforms = {
  positionKm: rel,
  orientation: q,
  sunDirection: sunDir,
  sunColor,
  sunAngularRadiusRad: 0.0047,
  sunIntensity: 1,
  intensity: 1,
};

const moon = 'moons' in body && Array.isArray((body as { moons?: unknown[] }).moons) ? (body as unknown as { moons: { radiusKm: number }[] }).moons[0] : undefined;
const occluderPos = new THREE.Vector3();
if (params.get('moon') === '1' && moon) {
  u.occluders = [{ positionKm: occluderPos, radiusKm: moon.radiusKm }];
}

h.onFrame((f) => {
  h.relative(new THREE.Vector3(0, 0, 0), rel);
  bodyOrientation(body, f.simDays, q);
  spinQ.setFromAxisAngle(yAxis, THREE.MathUtils.degToRad(ctl.spin));
  q.multiply(spinQ);
  // Sun direction relative to the camera axis: (0, 0) = behind the camera, +azimuth swings it to the right.
  camAxis.copy(h.cameraWorldPosition).normalize();
  const az = THREE.MathUtils.degToRad(ctl.sunAz);
  const el = THREE.MathUtils.degToRad(ctl.sunEl);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), camAxis).normalize();
  const up = new THREE.Vector3().crossVectors(camAxis, right).normalize();
  sunDir
    .copy(camAxis)
    .multiplyScalar(Math.cos(az) * Math.cos(el))
    .addScaledVector(right, Math.sin(az) * Math.cos(el))
    .addScaledVector(up, Math.sin(el))
    .normalize();
  u.sunIntensity = ctl.sunIntensity;
  u.intensity = ctl.intensity;
  u.sunAngularRadiusRad = Math.max(sunAngular, 0.002);
  if (u.occluders) {
    // Park the moon between the sun and the planet's limb, so the eclipse shadow falls on the disc.
    occluderPos.copy(sunDir).multiplyScalar(R * 4).addScaledVector(right, R * 0.35).addScaledVector(up, R * -0.1);
  }
  visual.update(f, u);
});

/** Area-weighted coverage of the baked surface: ocean (height below sea level) and ice, read back from the cubes. */
function coverage(): { ocean: number; ice: number; lava: number; target: { ocean: number; ice: number } } | null {
  const cubes = visual.bakedCubes();
  if (!cubes) return null;
  const n = cubes.relief.width;
  const relief = new Uint8Array(n * n * 4);
  const albedo = new Uint8Array(n * n * 4);
  let wSum = 0;
  let ocean = 0;
  let ice = 0;
  let lava = 0;
  for (let face = 0; face < 6; face++) {
    h.renderer.readRenderTargetPixels(cubes.relief, 0, 0, n, n, relief, face);
    h.renderer.readRenderTargetPixels(cubes.albedo, 0, 0, n, n, albedo, face);
    for (let j = 0; j < n; j++) {
      const v = (2 * (j + 0.5)) / n - 1;
      for (let i = 0; i < n; i++) {
        const u = (2 * (i + 0.5)) / n - 1;
        const w = (1 + u * u + v * v) ** -1.5;
        const k = (j * n + i) * 4;
        wSum += w;
        if (((relief[k + 3] ?? 0) / 255) * 2 - 0.75 < 0) ocean += w;
        const a = (albedo[k + 3] ?? 128) / 255;
        if (a < 0.45) ice += w;
        if (a > 0.6) lava += w;
      }
    }
  }
  return {
    ocean: ocean / wSum,
    ice: ice / wSum,
    lava: lava / wSum,
    target: { ocean: body.oceanCoverage, ice: body.iceCoverage },
  };
}
window.__COVERAGE__ = coverage;

void h.prepare(visual, 10);
h.start();

declare global {
  interface Window {
    __PLANET__?: PlanetVisual;
    __COVERAGE__?: () => ReturnType<typeof coverage>;
  }
}
