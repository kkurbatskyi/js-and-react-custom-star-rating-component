/**
 * Starfield dev page — StarfieldVisual under the real PostFX pipeline.
 *
 *   ?n=20000            synthetic catalogue size (default 20000), split into 32 ly cells (StarBlocks)
 *   ?src=universe       use getUniverse().queryBlocks() around the galaxy's home point instead
 *   ?fly=<ly/s>         fly-through speed along a gentle curve (default 3, 0 = hover); the field
 *                       rebases its float32 origin every 50 ly like the app's StarfieldLayer
 *   ?sel=brightest|<id> selected star (animated reticle);  ?hover=<id>  hovered star
 *   ?hide=brightest     hide that star: its sprite fades with ?fade=0..1 (default animates 0->1)
 *   ?exposure=<x>       starfield brightness multiplier (also the harness exposure param!) -> ?exp=
 *   ?labels=1           overlay the ids of anchors(12) and the nearest pick under the mouse
 *
 * Harness parameters (?t=, ?quality=, ?ui=0, ?cam=…) work as usual (dev/README.md).
 * `window.__STARFIELD__` exposes the visual and timing stats for --eval.
 */
import * as THREE from 'three';
import { blackbodyRGB } from '../src/core/color';
import { createRng } from '../src/core/rng';
import type { StarBlock } from '../src/core/types';
import { createGalaxyModel } from '../src/gen/galaxy/model';
import { StarfieldVisual } from '../src/render/starfield/StarfieldVisual';
import { BASE_CELL_LY, STAR_KINDS } from '../src/universe/contracts';
import { createHarness } from './harness';

declare global {
  interface Window {
    __STARFIELD__?: {
      visual: StarfieldVisual;
      blocks: readonly StarBlock[];
      stats: Record<string, number>;
      camera: THREE.Vector3;
    };
  }
}

const url = new URLSearchParams(location.search);
const N = Number(url.get('n') ?? 20000);
const FLY = Number(url.get('fly') ?? 3);
const source = url.get('src') ?? 'synthetic';
const galaxy = createGalaxyModel(20260929);
const home = new THREE.Vector3(...galaxy.params.homeLy);
const CELL = BASE_CELL_LY;

// ── synthetic catalogue ────────────────────────────────────────────────────────────────────
function syntheticBlocks(n: number, radiusLy: number): StarBlock[] {
  const rng = createRng(12345).fork('starfield-dev');
  const cells = new Map<string, { cell: [number, number, number]; stars: number[][] }>();
  for (let i = 0; i < n; i++) {
    // Apparent magnitudes (seen from home) follow N(<m) ~ 10^(0.5 m), like the real sky; distances are
    // uniform in a flattened ball; the absolute magnitude follows from the distance modulus.
    const m = Math.max(-1.6, 6.8 + 2 * Math.log10(Math.max(rng.next(), 1e-4)));
    const r = Math.max(4, radiusLy * rng.next() ** (1 / 3));
    const cosT = rng.range(-1, 1) * 0.55;
    const phi = rng.range(0, Math.PI * 2);
    const sinT = Math.sqrt(1 - cosT * cosT);
    const x = home.x + r * sinT * Math.cos(phi);
    const y = home.y + r * cosT;
    const z = home.z + r * sinT * Math.sin(phi);
    const absMag = m - 5 * Math.log10(r / 32.6156);
    // Rough main-sequence colour-magnitude relation with scatter; a third of the luminous ones are
    // cool giants.
    let tempK = Math.min(30000, Math.max(2800, 9000 - 620 * absMag + rng.normal(0, 500)));
    if (absMag < 1.5 && rng.chance(0.35)) tempK = rng.range(3400, 5000);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const cz = Math.floor(z / CELL);
    const key = `${cx}.${cy}.${cz}`;
    let c = cells.get(key);
    if (!c) {
      c = { cell: [cx, cy, cz], stars: [] };
      cells.set(key, c);
    }
    c.stars.push([x, y, z, absMag, tempK]);
  }
  const blocks: StarBlock[] = [];
  for (const [key, c] of cells) {
    const count = c.stars.length;
    const origin: [number, number, number] = [
      (c.cell[0] + 0.5) * CELL,
      (c.cell[1] + 0.5) * CELL,
      (c.cell[2] + 0.5) * CELL,
    ];
    const b: StarBlock = {
      key: `0.${key}`,
      level: 0,
      cell: c.cell,
      originLy: origin,
      count,
      offsetsLy: new Float32Array(count * 3),
      absMag: new Float32Array(count),
      luminositySolar: new Float32Array(count),
      colorRGB: new Float32Array(count * 3),
      kind: new Uint8Array(count),
    };
    c.stars.forEach((s, i) => {
      b.offsetsLy[i * 3] = s[0] - origin[0];
      b.offsetsLy[i * 3 + 1] = s[1] - origin[1];
      b.offsetsLy[i * 3 + 2] = s[2] - origin[2];
      b.absMag[i] = s[3];
      b.luminositySolar[i] = 10 ** (-0.4 * (s[3] - 4.83));
      const rgb = blackbodyRGB(s[4]);
      b.colorRGB[i * 3] = rgb[0];
      b.colorRGB[i * 3 + 1] = rgb[1];
      b.colorRGB[i * 3 + 2] = rgb[2];
      b.kind[i] = STAR_KINDS.indexOf('main-sequence');
    });
    blocks.push(b);
  }
  return blocks;
}

async function universeBlocks(): Promise<StarBlock[]> {
  const { getUniverse } = await import('../src/universe');
  const u = getUniverse();
  const res = u.queryBlocks({
    observerLy: [home.x, home.y, home.z],
    magnitudeLimit: 7.5,
    budgetMs: 2000,
  });
  return res.blocks;
}

const h = createHarness({
  title: 'Starfield',
  fov: 50,
  near: 1e-6,
  far: 3e5,
  cameraPosition: [0, 0.4, 2.2],
  target: [0, 0, 0],
  minDistance: 0.01,
  maxDistance: 100,
});

const visual = new StarfieldVisual(h.quality);
h.scene.add(visual.object);

const stats: Record<string, number> = {};
const cameraLy = new THREE.Vector3();
const origin = new THREE.Vector3();
let blocks: readonly StarBlock[] = [];
const REBASE_LY = 50;

function rebase(camera: THREE.Vector3): void {
  origin.copy(camera);
  const t0 = performance.now();
  visual.setBlocks(blocks, origin);
  stats.setBlocksMs = performance.now() - t0;
  stats.rebases = (stats.rebases ?? 0) + 1;
}

const ready = (async () => {
  blocks = source === 'universe' ? await universeBlocks() : syntheticBlocks(N, 260);
  stats.blocks = blocks.length;
  stats.stars = blocks.reduce((s, b) => s + b.count, 0);
  rebase(home);
})();
void h.waitFor(ready);

const params = { exposure: Number(url.get('exp') ?? 1), fade: Number(url.get('fade') ?? -1) };
h.gui.add(params, 'exposure', 0.1, 6);
h.gui.add(params, 'fade', -1, 1, 0.01).name('hidden fade (-1 = loop)');

// Highlights: ?sel= / ?hover= / ?hide=brightest resolve to real ids once blocks exist.
function brightestId(): string | null {
  let best: string | null = null;
  let bm = Number.POSITIVE_INFINITY;
  for (const b of blocks) {
    for (let i = 0; i < b.count; i++) {
      const dx = b.originLy[0] + b.offsetsLy[i * 3] - home.x;
      const dy = b.originLy[1] + b.offsetsLy[i * 3 + 1] - home.y;
      const dz = b.originLy[2] + b.offsetsLy[i * 3 + 2] - home.z;
      const d = Math.max(Math.hypot(dx, dy, dz), 0.01);
      const m = b.absMag[i] + 5 * Math.log10(d / 32.6156);
      if (m < bm) {
        bm = m;
        best = `${b.key}.${i}`;
      }
    }
  }
  return best;
}
const opts = {
  cameraLy,
  hiddenStarId: null as string | null,
  hiddenFade: 0,
  selectedId: null as string | null,
  hoveredId: null as string | null,
  exposure: 1,
};
let resolvedIds = false;

// Optional label overlay.
const overlay = document.createElement('div');
overlay.style.cssText =
  'position:fixed;inset:0;pointer-events:none;font:10px monospace;color:#9fc4ff';
if (url.get('labels') === '1') document.body.append(overlay);
const labelPool: HTMLDivElement[] = [];
let mouse: { x: number; y: number } | null = null;
addEventListener('pointermove', (e) => {
  mouse = { x: e.clientX, y: e.clientY };
});
addEventListener('pointerdown', (e) => {
  const hit = visual.pick(e.clientX, e.clientY, 16);
  opts.selectedId = hit ? hit.id : null;
});

h.onFrame((f) => {
  if (!resolvedIds && blocks.length) {
    resolvedIds = true;
    const sel = url.get('sel');
    opts.selectedId = sel === 'brightest' ? brightestId() : sel;
    opts.hoveredId = url.get('hover');
    if (url.get('hide') === 'brightest') opts.hiddenStarId = brightestId();
  }
  const t = f.timeSec;
  // Fly-through: a gentle curve away from home, plus the harness orbit offset.
  const s = FLY * t;
  cameraLy.set(
    home.x + s * 0.8 + 6 * Math.sin(t * 0.13),
    home.y + 2 * Math.sin(t * 0.21),
    home.z + s * 0.6 + 6 * Math.cos(t * 0.11),
  );
  cameraLy.add(h.cameraWorldPosition);
  if (blocks.length && cameraLy.distanceTo(origin) > REBASE_LY) rebase(cameraLy);
  opts.exposure = params.exposure;
  opts.hiddenFade = params.fade >= 0 ? params.fade : (t * 0.25) % 1;
  if (!opts.hiddenStarId) opts.hiddenFade = 0;
  if (mouse) {
    const hit = visual.pick(mouse.x, mouse.y, 14);
    opts.hoveredId = hit ? hit.id : (url.get('hover') ?? null);
  }
  visual.update(f, opts);
  if (url.get('labels') === '1') {
    const t0 = performance.now();
    const anchors = visual.anchors(12);
    stats.anchorsMs = performance.now() - t0;
    while (labelPool.length < anchors.length) {
      const d = document.createElement('div');
      d.style.cssText =
        'position:absolute;transform:translate(10px,-6px);white-space:nowrap;text-shadow:0 0 3px #000';
      overlay.append(d);
      labelPool.push(d);
    }
    labelPool.forEach((d, i) => {
      const a = anchors[i];
      d.style.display = a ? 'block' : 'none';
      if (a) {
        d.style.left = `${a.x}px`;
        d.style.top = `${a.y}px`;
        d.textContent = `${a.id} (${(-a.priority).toFixed(1)})`;
      }
    });
  }
});

window.__STARFIELD__ = {
  visual,
  get blocks() {
    return blocks;
  },
  stats,
  camera: cameraLy,
};
h.start();
