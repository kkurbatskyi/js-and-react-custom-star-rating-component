/**
 * Galaxy dev page — GalaxyVisual under the real PostFX pipeline.
 *
 *   ?view=overview|faceon|edgeon|above-home|inside-core|inside-plane   camera preset
 *   ?seed=<n>          galaxy seed (default: the app's)
 *   ?near=<ly>         particle near-fade distance (default 2500, as the app)
 *   ?validate=1        compare the GPU map bake with the CPU model → window.__GALAXY_CHECK__
 *   ?look=k:v,k:v      override numeric `GalaxyLook` fields (A/B screenshots without code edits)
 *   ?probe=u,v;u,v     HDR volume radiance + distance at screen uvs → window.__GALAXY_PROBE__
 *
 * Harness parameters (?t=, ?quality=, ?ui=0, ?cam=/&target=, …) work as usual (dev/README.md).
 */
import * as THREE from 'three';
import { createGalaxyModel } from '../src/gen/galaxy/model';
import { GalaxyVisual } from '../src/render/galaxy/GalaxyVisual';
import { createHarness, type Vec3Like } from './harness';

declare global {
  interface Window {
    __GALAXY_CHECK__?: { arm: number; dust: number } | null;
    /** `?probe=u,v;u,v…` → HDR volume radiance + distance (kly) at those screen uvs (y up). */
    __GALAXY_PROBE__?: Record<string, [number, number, number, number]>;
  }
}

const DEFAULT_SEED = 20260929; // src/universe DEFAULT_GALAXY_SEED

type ViewName = 'overview' | 'faceon' | 'edgeon' | 'above-home' | 'inside-core' | 'inside-plane';
interface Preset {
  cam: Vec3Like;
  target: Vec3Like;
  fov: number;
}

const url = new URLSearchParams(location.search);
const seed = Number(url.get('seed') ?? DEFAULT_SEED) >>> 0;
const model = createGalaxyModel(seed);
const { homeLy } = model.params;
const home = new THREE.Vector3(homeLy[0], homeLy[1], homeLy[2]);
const toCore = new THREE.Vector3(-home.x, 0, -home.z).normalize();
/** In-plane direction perpendicular to the core direction. */
const along = new THREE.Vector3(-toCore.z, 0, toCore.x);

function spherical(distance: number, elevationDeg: number, azimuthRad: number): Vec3Like {
  const e = THREE.MathUtils.degToRad(elevationDeg);
  return [
    distance * Math.cos(e) * Math.cos(azimuthRad),
    distance * Math.sin(e),
    distance * Math.cos(e) * Math.sin(azimuthRad),
  ];
}
const at = (base: THREE.Vector3, dir: THREE.Vector3, d: number, up = 0): Vec3Like => [
  base.x + dir.x * d,
  base.y + dir.y * d + up,
  base.z + dir.z * d,
];

const PRESETS: Record<ViewName, Preset> = {
  overview: { cam: spherical(110_000, 35, 0.9), target: [0, 0, 0], fov: 50 },
  faceon: { cam: [0, 125_000, 1], target: [0, 0, 0], fov: 50 },
  edgeon: { cam: spherical(100_000, 0.2, 2.2), target: [0, 0, 0], fov: 50 },
  'above-home': { cam: at(home, toCore, -2500, 5000), target: at(home, toCore, 9000), fov: 60 },
  'inside-core': { cam: [home.x, home.y, home.z], target: at(home, toCore, 10), fov: 70 },
  'inside-plane': { cam: [home.x, home.y, home.z], target: at(home, along, 10), fov: 70 },
};
const viewParam = url.get('view') as ViewName | null;
const view: ViewName = viewParam && viewParam in PRESETS ? viewParam : 'overview';
const preset = PRESETS[view];

const h = createHarness({
  title: `Galaxy · ${model.params.name} · ${view}`,
  fov: preset.fov,
  near: 1,
  far: 1e7,
  cameraPosition: preset.cam,
  target: preset.target,
  quality: 'medium',
});

const visual = new GalaxyVisual(model, h.quality);
for (const pair of (url.get('look') ?? '').split(',')) {
  const [key, value] = pair.split(':');
  const look = visual.look as unknown as Record<string, unknown>;
  if (key && value !== undefined && typeof look[key] === 'number') look[key] = Number(value);
}
if (url.has('look')) visual.rebuildParticles();
h.scene.add(visual.object);

const options = {
  cameraLy: h.cameraWorldPosition,
  nearFadeLy: Number(url.get('near') ?? 2500),
  intensity: 1,
};

// ── GUI ──────────────────────────────────────────────────────────────────────
const look = visual.look;
const gui = h.gui;
gui
  .add({ view }, 'view', Object.keys(PRESETS))
  .name('view (reload)')
  .onChange((v: string) => {
    const next = new URLSearchParams(location.search);
    next.set('view', v);
    next.delete('cam');
    next.delete('target');
    location.search = next.toString();
  });
gui.add(options, 'intensity', 0, 2, 0.01);
gui.add(options, 'nearFadeLy', 0, 10_000, 10).name('near fade (ly)');
const light = gui.addFolder('Light');
light.add(look, 'brightness', 0.01, 1, 0.005);
light
  .add(look, 'coreGamma', 0.3, 1, 0.01)
  .name('core γ (rebuild)')
  .onFinishChange(() => visual.rebuildParticles());
light
  .add(look, 'coreKnee', 0.2, 10, 0.05)
  .name('core knee (rebuild)')
  .onFinishChange(() => visual.rebuildParticles());
light.add(look, 'mottling', 0, 1, 0.01);
light.add(look, 'armMottling', 0, 1, 0.01).name('arm mottling');
light.add(look, 'beading', 0, 4, 0.01);
light.add(look, 'hiiGlow', 0, 1, 0.01).name('HII glow');
light.add(look, 'particleGain', 0, 4, 0.01).name('particle gain');
light.add(look, 'clusterGain', 0, 6, 0.01).name('cluster gain');
light.add(look, 'hiiGain', 0, 6, 0.01).name('HII knot gain');
light.add(look, 'minSigmaPx', 0.3, 2, 0.01).name('min σ (px)');
light.add(look, 'maxSigmaPx', 2, 64, 0.5).name('max σ (px)');
const dust = gui.addFolder('Dust');
dust.add(look, 'dustOpacity', 0, 6, 0.01).name('lane τ (face-on)');
dust.add(look, 'dustThickness', 0.5, 3, 0.01).name('thickness × model');
dust.add(look, 'dustDetail', 0, 4, 0.01).name('clumping');
dust.add(look, 'nearDust', 0, 1.5, 0.01).name('near clouds');
dust.add(look.reddening, '0', 0.3, 1.5, 0.01).name('κ red / green');
dust.add(look.reddening, '2', 0.5, 2.5, 0.01).name('κ blue / green');
const colour = gui.addFolder('Colour (rebuilds particles)');
for (const key of ['bulgeK', 'diskK', 'thickK', 'youngK', 'innerYoungK'] as const) {
  colour.add(look, key, 2500, 30_000, 50).onFinishChange(() => visual.rebuildParticles());
}
colour.add(look, 'saturation', 0.5, 2, 0.01).onFinishChange(() => visual.rebuildParticles());
colour.close();

// Exposure: follow the visual's hint (a stand-in for engine auto-exposure) unless ?exposure=.
const autoExposure = { enabled: !url.has('exposure') };
gui.add(autoExposure, 'enabled').name('exposure hint');
h.onFrame((frame) => {
  if (autoExposure.enabled) h.post.setExposure(visual.exposureHint(h.cameraWorldPosition));
  visual.update(frame, options);
});

if (url.get('validate') === '1') {
  void h.waitFor(
    h.frames(2).then(() => {
      window.__GALAXY_CHECK__ = null;
      const off = h.onFrame((frame) => {
        window.__GALAXY_CHECK__ = visual.validateMap(frame);
        off();
      });
      return h.frames(1);
    }),
  );
}
const probeParam = url.get('probe');
if (probeParam) {
  void h.waitFor(
    h.frames(10).then(() => {
      const off = h.onFrame((frame) => {
        const out: Record<string, [number, number, number, number]> = {};
        for (const pair of probeParam.split(';')) {
          const [u, v] = pair.split(',').map(Number);
          out[pair] = visual.probeVolume(frame, u ?? 0.5, v ?? 0.5);
        }
        window.__GALAXY_PROBE__ = out;
        off();
      });
      return h.frames(1);
    }),
  );
}
// Let the temporal accumulation of the volume pass converge before screenshots.
void h.waitFor(h.frames(12));
h.start();
