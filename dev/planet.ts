/**
 * Planet dev page — one world under the real PostFX pipeline.
 *
 *   ?body=home.d          Aurelia's bodies by letter (b c d e f g h; moons home.d.1, home.f.3, ...) or a full id
 *   ?type=terran&n=1      the n-th body of a type near home
 *   ?view=far|mid|close|terminator|crescent|surface   camera preset (surface: &alt=<km>)
 *   ?sun=<azimuthDeg>,<elevationDeg>   sun relative to the camera (0,0 = behind the camera)
 *   ?spin=<deg>           rotation about the spin axis     ?lite=1   the cheap 'lite' visual
 *   ?compare=1&px=30      lite (left) and full (right) side by side at a projected radius of px pixels
 *   ?debug=albedo|normal|height   surface debug views      ?moon=1   add the first moon as an eclipse caster
 */
import * as THREE from 'three';
import { blackbodyRGB } from '../src/core/color';
import type { BodyBase } from '../src/core/types';
import type { PlanetUniforms } from '../src/render/contracts';
import { PlanetVisual } from '../src/render/planet/PlanetVisual';
import { bodyOrientation } from '../src/sim/orientation';
import { createHarness } from './harness';
import { pickBody } from './planetBodies';

const params = new URLSearchParams(location.search);
const picked = pickBody(params);
const { system } = picked;
// ?nightlights=0.8 forces a civilisation's night lights on the picked world (none nearby to pick from).
const forcedLights = params.get('nightlights');
const body: BodyBase = forcedLights
  ? {
      ...picked.body,
      life: 'civilization',
      appearance: { ...picked.body.appearance, nightLights: Number(forcedLights) },
    }
  : picked.body;
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
const compare = params.get('compare') === '1';
// Compare mode uses a long lens so the two bodies (either side of centre) are seen from nearly the same angle.
const FOV_DEG = compare ? 9 : 34;
/** Camera distance (in radii) at which the body's projected radius is `px` pixels. */
const distForPixelRadius = (px: number): number => {
  const pxPerTan = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2));
  return Math.sqrt(1 + (pxPerTan / px) ** 2); // 1 / sin(theta), tan(theta) = px / pxPerTan
};
const distR = compare
  ? distForPixelRadius(Number(params.get('px') ?? 30))
  : view === 'surface'
    ? 1 + alt / R
    : preset.dist;
const latRad = THREE.MathUtils.degToRad(compare ? 0 : preset.lat);
const camDir = new THREE.Vector3(0, Math.sin(latRad), Math.cos(latRad));

const h = createHarness({
  title: `${body.name} · ${body.type}`,
  fov: FOV_DEG,
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
// Compare mode: the same world as a 'lite' visual, drawn to the left of the full one.
const twin = compare ? new PlanetVisual(body, { system }, h.quality, 'lite') : null;
if (twin) h.scene.add(twin.object);
// Hold the screenshot until every visual is drawable: lite ones report `ready` at once but finish their
// tiny bake and shader compile from update() a few frames later.
for (const v of twin ? [visual, twin] : [visual]) {
  void h.waitFor(
    new Promise<void>((resolve) => {
      const off = h.onFrame(() => {
        if (v.drawable) {
          off();
          resolve();
        }
      });
    }),
  );
}
const COMPARE_OFFSET_R = 1.6;
window.__PLANET__ = visual;
/** ?shells=0 judges the surface on its own: hides atmosphere, clouds and rings (the sky specialist's parts). */
const hideShells = params.get('shells') === '0';
/** The shells re-enable themselves in update(), so hide them again after every update. */
function applyShellVisibility(): void {
  if (!hideShells) return;
  for (const child of visual.object.children) if (child.name !== 'surface') child.visible = false;
}

const DEBUG_VIEWS: Record<string, number> = {
  albedo: 1,
  normal: 2,
  height: 3,
  shadow: 4,
  diffuse: 5,
};
const sunParam = (params.get('sun') ?? '').split(',').map(Number);
const ctl = {
  sunAz: Number.isFinite(sunParam[0]) && params.has('sun') ? (sunParam[0] as number) : preset.az,
  sunEl: Number.isFinite(sunParam[1]) && params.has('sun') ? (sunParam[1] as number) : preset.el,
  spin: Number(params.get('spin') ?? 0),
  intensity: 1,
  sunIntensity: 1,
  debug: DEBUG_VIEWS[params.get('debug') ?? ''] ?? 0,
};
h.gui.add(ctl, 'sunAz', -180, 180, 1).name('sun azimuth');
h.gui.add(ctl, 'sunEl', -80, 80, 1).name('sun elevation');
h.gui.add(ctl, 'spin', 0, 360, 1).name('spin (deg)');
h.gui.add(ctl, 'sunIntensity', 0.4, 2, 0.01).name('sun intensity');
h.gui.add(ctl, 'intensity', 0, 1.5, 0.01).name('fade / intensity');
h.gui.add(ctl, 'debug', { shaded: 0, ...DEBUG_VIEWS }).onChange((v: number) => visual.setDebug(v));
visual.setDebug(ctl.debug);

const star = system.star;
const sunColor = new THREE.Color().setRGB(...blackbodyRGB(star.temperatureK));
// Distance to the star: a planet's own orbit, or (for a moon) its parent planet's.
const parentPlanet =
  picked.planetIndex >= 0
    ? body
    : system.planets.find((p) => p.moons.some((m) => m.id === body.id));
const starDistanceKm = Math.max(
  parentPlanet?.orbit.semiMajorAxisKm ?? body.orbit.semiMajorAxisKm,
  1,
);
const sunAngular = Math.atan((star.radiusSolar * 695_700) / starDistanceKm);

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

const twinPos = new THREE.Vector3();
const twinUniforms: PlanetUniforms = { ...u, positionKm: new THREE.Vector3() };

const moon =
  'moons' in body && Array.isArray((body as { moons?: unknown[] }).moons)
    ? (body as unknown as { moons: { radiusKm: number }[] }).moons[0]
    : undefined;
const occluderPos = new THREE.Vector3();
if (params.get('moon') === '1' && moon) {
  u.occluders = [{ positionKm: occluderPos, radiusKm: moon.radiusKm }];
}

const origin = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const RING_EXTENT = Math.min(2.4, body.rings ? body.rings.outerRadiusKm / R : 1);

h.onFrame((f) => {
  h.relative(origin, rel);
  // Tight depth range around the body, like the engine's per-slice near/far: the 24-bit depth buffer must
  // resolve a planet's shells (surface, clouds, atmosphere) a fraction of a percent of R apart.
  const dist = h.cameraWorldPosition.length();
  h.camera.near = Math.max(R * 1e-4, (dist - 3 * R * RING_EXTENT) * 0.5);
  h.camera.far = dist + 4 * R * RING_EXTENT + (twin ? 2 * COMPARE_OFFSET_R * R : 0);
  h.camera.updateProjectionMatrix();
  bodyOrientation(body, f.simDays, q);
  spinQ.setFromAxisAngle(yAxis, THREE.MathUtils.degToRad(ctl.spin));
  q.multiply(spinQ);
  // Sun direction relative to the camera axis: (0, 0) = behind the camera, +azimuth swings it to the right.
  camAxis.copy(h.cameraWorldPosition).normalize();
  const az = THREE.MathUtils.degToRad(ctl.sunAz);
  const el = THREE.MathUtils.degToRad(ctl.sunEl);
  right.crossVectors(worldUp, camAxis).normalize();
  up.crossVectors(camAxis, right).normalize();
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
    occluderPos
      .copy(sunDir)
      .multiplyScalar(R * 4)
      .addScaledVector(right, R * 0.35)
      .addScaledVector(up, R * -0.1);
  }
  if (twin) {
    // The full visual sits right of centre, the lite one left; both share sun, orientation and time.
    const scratch = twinPos;
    scratch.set(COMPARE_OFFSET_R * R, 0, 0);
    h.relative(scratch, rel);
    visual.update(f, u);
    applyShellVisibility();
    scratch.set(-COMPARE_OFFSET_R * R, 0, 0);
    h.relative(scratch, twinUniforms.positionKm);
    twinUniforms.sunIntensity = u.sunIntensity;
    twinUniforms.intensity = u.intensity;
    twinUniforms.sunAngularRadiusRad = u.sunAngularRadiusRad;
    twin.update(f, twinUniforms);
  } else {
    visual.update(f, u);
    applyShellVisibility();
  }
});

/** Area-weighted coverage of the baked surface: ocean (height below sea level) and ice, read back from the cubes. */
function coverage(): {
  ocean: number;
  ice: number;
  lava: number;
  target: { ocean: number; ice: number };
} | null {
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
        ice += w * Math.max(0, 0.5 - a) * 2;
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

// Time-slicing statistics of the bake (calls, longest call, total): window.__PREP__.
// ?budget=<ms> sets the per-frame bake budget (default 250: dev pages favour fast screenshots; use 8 to test smoothness).
const prep = { calls: 0, maxMs: 0, totalMs: 0, budgetMs: Number(params.get('budget') ?? 250) };
window.__PREP__ = prep;
const bake = { prepare: visual.prepare.bind(visual) };
void h.prepare(
  {
    prepare: (renderer, budgetMs) => {
      const t0 = performance.now();
      const done = bake.prepare(renderer, budgetMs);
      const dt = performance.now() - t0;
      prep.calls++;
      prep.totalMs += dt;
      prep.maxMs = Math.max(prep.maxMs, dt);
      return done;
    },
  },
  prep.budgetMs,
);
h.start();

declare global {
  interface Window {
    __PLANET__?: PlanetVisual;
    __COVERAGE__?: () => ReturnType<typeof coverage>;
    __PREP__?: { calls: number; maxMs: number; totalMs: number; budgetMs: number };
  }
}
