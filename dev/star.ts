/**
 * Star dev page — StarVisual under the real PostFX pipeline.
 *
 *   ?type=O|B|A|F|G|K|M|K-giant|M-supergiant|white-dwarf|neutron-star|black-hole|smbh   (default G)
 *   ?type=gallery          one of each main look side by side, equal apparent size
 *   ?dist=close|mid|system|far   3.5 R | 40 R | 215 R (1 AU for the Sun) | 3000 R  (default close)
 *   ?r=<n>                 distance in stellar radii (overrides ?dist)
 *   ?lens=0                black holes: do not install the lensing post effect
 *   ?spin=<days/s>         simulation rate (default: the harness's)
 *   ?mode=starfield        draw the SAME star as a starfield sprite (StarfieldVisual, ly units) instead of a
 *                          StarVisual: compare probes of the two at equal ?r= to verify the photometry hand-off
 *
 * Harness parameters (?t=, ?quality=, ?ui=0, ?cam=…) work as usual (dev/README.md).
 */
import * as THREE from 'three';
import type { StarDetails } from '../src/core/types';
import type { IStarVisual } from '../src/render/contracts';
import type { LensingEffect } from '../src/render/star/lensing';
import { StarVisual } from '../src/render/star/StarVisual';
import { StarfieldVisual } from '../src/render/starfield/StarfieldVisual';
import { KM_PER_LY } from '../src/core/units';
import { createHarness } from './harness';
import { makeStar, STAR_TYPES, type StarTypeName } from './starTypes';

const url = new URLSearchParams(location.search);
const typeParam = url.get('type') ?? 'G';
const gallery = typeParam === 'gallery';
const type = (STAR_TYPES as readonly string[]).includes(typeParam) ? (typeParam as StarTypeName) : 'G';
const DIST: Record<string, number> = { close: 3.5, mid: 40, system: 215, far: 3000 };
const distR = Number(url.get('r') ?? DIST[url.get('dist') ?? 'close'] ?? 3.5);

const asStarfield = url.get('mode') === 'starfield';

const GALLERY: StarTypeName[] = ['O', 'A', 'G', 'K', 'M', 'K-giant', 'M-supergiant', 'white-dwarf'];

const focusStar = makeStar(gallery ? 'G' : type);
const focusDistKm = distR * focusStar.radiusKm;
const h = createHarness({
  title: `Star - ${gallery ? 'gallery' : type}`,
  fov: 50,
  near: 1,
  far: 1e12,
  cameraPosition: [0, 0, gallery ? 1 : focusDistKm],
  target: [0, 0, 0],
  gui: true,
  simRate: Number(url.get('spin') ?? 0.5),
  minDistance: gallery ? 0.5 : focusStar.radiusKm * 1.05,
  maxDistance: gallery ? 2 : focusStar.radiusKm * 1e6,
});

interface Item {
  star: StarDetails;
  visual: IStarVisual;
  /** View-space direction angles (rad) and distance factor. */
  angleX: number;
  angleY: number;
  distR: number;
}

const items: Item[] = [];
const build = (t: StarTypeName, ax: number, ay: number, dr: number): void => {
  const star = makeStar(t);
  const visual = new StarVisual(star, h.quality);
  h.scene.add(visual.object);
  items.push({ star, visual, angleX: ax, angleY: ay, distR: dr });
};

if (gallery) {
  const cols = 4;
  GALLERY.forEach((t, i) => {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    build(t, ((cx - (cols - 1) / 2) * 0.235), (0.5 - cy) * 0.36, 10);
  });
} else {
  build(type, 0, 0, distR);
}

const pos = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();

// Starfield mode: one catalogue star with this star's absolute magnitude and colour at the origin.
let starfield: StarfieldVisual | null = null;
const camLy = new THREE.Vector3();
if (asStarfield && !gallery) {
  const st = focusStar;
  const block = {
    key: '0.0.0.0',
    level: 0,
    cell: [0, 0, 0] as const,
    originLy: [0, 0, 0] as const,
    count: 1,
    offsetsLy: new Float32Array([0, 0, 0]),
    absMag: new Float32Array([st.absMag]),
    luminositySolar: new Float32Array([st.luminositySolar]),
    colorRGB: new Float32Array(st.colorRGB),
    kind: new Uint8Array([0]),
  };
  starfield = new StarfieldVisual(h.quality);
  starfield.setBlocks([block], new THREE.Vector3());
  h.scene.add(starfield.object);
  for (const it of items) it.visual.object.visible = false;
}
const lensParam = url.get('lens') !== '0';

// Lensing post effect (black holes): installed lazily so pages without one stay cheap.
let lensEffect: LensingEffect | null = null;
if (lensParam && items.some((i) => i.star.kind === 'black-hole')) {
  void import('../src/render/star/lensing').then((m) => {
    const fx = m.createLensingEffect();
    h.post.setHdrEffects([fx], 'pre-bloom');
    lensEffect = fx;
  });
}

h.onFrame((f) => {
  let near = Number.POSITIVE_INFINITY;
  let far = 0;
  for (const it of items) {
    const R = it.star.radiusKm;
    let d: number;
    if (gallery) {
      // Fixed view-space layout: equal apparent size, spread across the screen.
      d = it.distR * R;
      const cy = Math.cos(it.angleY);
      pos.set(Math.sin(it.angleX) * cy * d, Math.sin(it.angleY) * d, -Math.cos(it.angleX) * cy * d);
      pos.applyQuaternion(h.camera.quaternion);
    } else {
      h.relative(ORIGIN, pos);
      d = pos.length();
    }
    if (starfield) {
      camLy.copy(h.cameraWorldPosition).divideScalar(KM_PER_LY);
      starfield.update(f, {
        cameraLy: camLy,
        hiddenStarId: null,
        hiddenFade: 0,
        selectedId: null,
        hoveredId: null,
        exposure: 1,
      });
      h.camera.near = 1e-12;
      h.camera.far = 1e3;
      h.camera.updateProjectionMatrix();
      return;
    }
    it.visual.update(f, { positionKm: pos, intensity: 1 });
    near = Math.min(near, Math.max(d - 8 * R, 1e-4 * d, 1e-3));
    far = Math.max(far, d + 8 * R);
    if (lensEffect) lensEffect.setState((it.visual as StarVisual).lens);
  }
  h.camera.near = near;
  h.camera.far = far * 1.5;
  h.camera.updateProjectionMatrix();
});

h.gui.add({ type }, 'type', [...STAR_TYPES, 'gallery']).onChange((v: string) => {
  url.set('type', v);
  location.search = url.toString();
});
h.gui.add({ dist: url.get('dist') ?? 'close' }, 'dist', Object.keys(DIST)).onChange((v: string) => {
  url.set('dist', v);
  url.delete('r');
  location.search = url.toString();
});

h.start();
