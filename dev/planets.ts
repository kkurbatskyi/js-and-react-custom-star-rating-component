/**
 * Planet gallery — twelve worlds of every type in one frame (a family portrait), each with its own
 * bake, under the real PostFX pipeline.
 *
 *   ?quality=low|medium|high   bake resolution (256 / 512 / 1024 per cube face); low is quick to iterate
 *   ?sun=<azimuthDeg>,<elevationDeg>   shared light, relative to the camera (default -38,18: from the upper left)
 *   ?labels=0                  hide the captions      ?cols=<n> bodies per row (default 4)
 *   ?count=<n>                 only the first n worlds
 *   ?shells=0                  hide the sky specialist's atmosphere, clouds and rings (surface only)
 *
 * Layout. Every body is placed at its real size but at the distance that gives all of them the same
 * projected radius (rings included), so a 64 000 km giant and a 1 800 km moon fill their cells alike; a
 * long lens keeps perspective distortion low. Depth range is derived from the placed bodies, so the
 * 24-bit depth buffer resolves each planet's shells at any distance. Positions are camera-relative and
 * fixed (orbit controls are off), as the visual contracts require.
 */
import * as THREE from 'three';
import { blackbodyRGB } from '../src/core/color';
import type { PlanetType } from '../src/core/types';
import type { PlanetUniforms } from '../src/render/contracts';
import { PlanetVisual } from '../src/render/planet/PlanetVisual';
import { bodyOrientation } from '../src/sim/orientation';
import { createHarness } from './harness';
import { bodyById, nearbyBodies, type PickedBody, sunAngularRadius } from './planetBodies';

interface CellSpec {
  id?: string;
  type?: PlanetType;
}

const CELLS: readonly CellSpec[] = [
  { id: 'home.b' }, // lava world (tidally locked, magma seas)
  { id: 'home.c' }, // Mercury-like
  { id: 'home.d' }, // Halcyon, terran with vegetation
  { id: 'home.e' }, // Mars-like desert
  { id: 'home.f' }, // ringed class-I giant
  { id: 'home.g' }, // 98-degree ice giant
  { id: 'home.f.1' }, // Io analogue
  { id: 'home.f.2' }, // Europa analogue
  { id: 'home.f.3' }, // Titan analogue
  { id: 'home.h' }, // Pluto-like dwarf
  { type: 'ocean' },
  { type: 'hothouse' },
];

const FOV_DEG = 22;
const params = new URLSearchParams(location.search);
const columns = Math.max(2, Number(params.get('cols') ?? 4));
// ?count=<n> shows only the first n worlds (quick checks on a loaded machine).
const specs = CELLS.slice(0, Math.max(1, Number(params.get('count') ?? CELLS.length)));
const rows = Math.ceil(specs.length / columns);
const showLabels = params.get('labels') !== '0';
const hideShells = params.get('shells') === '0';

const h = createHarness({
  title: 'Planet gallery',
  fov: FOV_DEG,
  cameraPosition: [0, 0, 1000],
  target: [0, 0, 0],
  simRate: 0,
});
h.controls.enabled = false;

interface Cell {
  picked: PickedBody;
  visual: PlanetVisual;
  u: PlanetUniforms;
  q: THREE.Quaternion;
  spin: THREE.Quaternion;
  label: HTMLElement | null;
  /** Ring extent in planet radii (1 without rings): the projected disc is sized to fit it. */
  extent: number;
}

const sunParam = (params.get('sun') ?? '-38,18').split(',').map(Number);
const az = THREE.MathUtils.degToRad(sunParam[0] ?? -38);
const el = THREE.MathUtils.degToRad(sunParam[1] ?? 18);
const sunDir = new THREE.Vector3(
  Math.sin(az) * Math.cos(el),
  Math.sin(el),
  Math.cos(az) * Math.cos(el),
).normalize();

const pool = nearbyBodies();
const cells: Cell[] = [];
for (const spec of specs) {
  const picked = spec.id ? bodyById(spec.id) : pool.find((b) => b.body.type === spec.type);
  if (!picked) continue;
  const { body, system } = picked;
  const visual = new PlanetVisual(body, { system }, h.quality, 'full');
  h.scene.add(visual.object);
  const i = cells.length;
  const label = showLabels ? document.createElement('div') : null;
  if (label) {
    label.style.cssText =
      'position:fixed;z-index:5;transform:translateX(-50%);pointer-events:none;text-align:center;' +
      'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;' +
      'color:rgba(226,232,240,.78);text-shadow:0 1px 3px #000;white-space:nowrap';
    label.innerHTML = `${body.name}<br><span style="opacity:.55;text-transform:uppercase;letter-spacing:.14em;font-size:9px">${body.type}</span>`;
    document.body.append(label);
  }
  cells.push({
    picked,
    visual,
    u: {
      positionKm: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      sunDirection: sunDir,
      sunColor: new THREE.Color().setRGB(...blackbodyRGB(system.star.temperatureK)),
      sunAngularRadiusRad: Math.max(sunAngularRadius(picked), 0.002),
      sunIntensity: 1,
      intensity: 1,
    },
    q: new THREE.Quaternion(),
    spin: new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad((i * 67) % 360),
    ),
    label,
    // Rings are part of the picture only when the shells are shown: size the disc to fit them.
    extent: hideShells
      ? 1
      : Math.min(2.4, body.rings ? body.rings.outerRadiusKm / body.radiusKm : 1),
  });
}

/** Place every body in its cell (camera-relative, fixed) and fit the depth range around them. */
function layout(): void {
  const aspect = window.innerWidth / window.innerHeight;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2));
  const cell = Math.min((2 * tanHalf) / rows, (2 * tanHalf * aspect) / columns);
  let near = Number.POSITIVE_INFINITY;
  let far = 0;
  cells.forEach((c, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const cx = (col - (columns - 1) / 2) * cell;
    const cy = ((rows - 1) / 2 - row) * cell;
    const r = (0.5 * cell * 0.8) / c.extent; // projected radius of the planet disc, in tan space
    const radius = c.picked.body.radiusKm;
    const d = radius * Math.sqrt(1 + 1 / (r * r));
    c.u.positionKm.set(cx, cy, -1).normalize().multiplyScalar(d);
    near = Math.min(near, d - 2 * radius * c.extent);
    far = Math.max(far, d + 2 * radius * c.extent);
    if (c.label) {
      c.label.style.left = `${(0.5 + cx / (2 * tanHalf * aspect)) * 100}%`;
      c.label.style.top = `${(0.5 - (cy - r * 1.06) / (2 * tanHalf)) * 100}%`;
    }
  });
  h.camera.near = Math.max(1, near * 0.9);
  h.camera.far = far * 1.1;
  h.camera.updateProjectionMatrix();
}
layout();
window.addEventListener('resize', layout);

h.onFrame((f) => {
  for (const c of cells) {
    bodyOrientation(c.picked.body, f.simDays, c.q);
    c.q.multiply(c.spin);
    c.u.orientation.copy(c.q);
    c.visual.update(f, c.u);
    // The sky specialist's shells re-enable themselves in update(): hide them again for surface-only shots.
    if (hideShells) {
      for (const child of c.visual.object.children)
        if (child.name !== 'surface') child.visible = false;
    }
  }
});

// Advance every bake a slice per frame until all are ready (`?budget=<ms>` per frame, default 250).
const budgetMs = Number(params.get('budget') ?? 250);
void h.prepare(
  {
    prepare: (renderer, budget) => {
      const pending = cells.filter((c) => !c.visual.ready);
      const share = Math.max(2, budget / Math.max(1, pending.length));
      let done = true;
      for (const c of pending) if (!c.visual.prepare(renderer, share)) done = false;
      return done;
    },
  },
  budgetMs,
);
h.start();
