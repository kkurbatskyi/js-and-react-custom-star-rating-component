/**
 * Sidereal dev harness — the standard sandbox for developing one visual in isolation under the
 * real PostFX pipeline. See dev/README.md for usage and a page template.
 *
 * Camera-relative rendering (src/render/contracts.ts): OrbitControls drive a *proxy* camera in
 * absolute space (float64 on the CPU). Every frame the real render camera sits at the origin with
 * the proxy's orientation, and pages place objects at `absPos − cameraWorldPosition`
 * (`harness.relative()` / `harness.place()`).
 *
 * URL parameters
 *   ?quality=low|medium|high|ultra   render quality (default: option, else 'high')
 *   ?t=<sec>                         freeze the animation clock at t (reproducible screenshots)
 *   ?cam=x,y,z  ?target=x,y,z        override the proxy camera position / orbit target
 *   ?days=<n>  ?simRate=<days/sec>   simulation clock start / rate
 *   ?exposure=<n>                    PostFX exposure
 *   ?bloom=<intensity>[,<threshold>[,<radius>]]   PostFX bloom overrides
 *   ?dpr=<n>                         device-pixel-ratio cap (default 1.5)
 *   ?ui=0                            hide GUI, title and stats (clean screenshots)
 *
 * `window.__READY__` becomes true once every `waitFor()` promise has settled and 5 more frames
 * have rendered; scripts/shot.mjs waits for it. `window.__HARNESS__` exposes the harness.
 */
import GUI from 'lil-gui';
import { RenderPass } from 'postprocessing';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Quality, VisualFrame } from '../src/render/contracts';
import { type BloomSettings, PostFX } from '../src/render/post/PostFX';

declare global {
  interface Window {
    __READY__?: boolean;
    __HARNESS__?: Harness;
  }
}

export type Vec3Like = THREE.Vector3Like | readonly [number, number, number];

/** Anything with time-sliced GPU preparation, e.g. `IPlanetVisual.prepare()`. */
export interface Preparable {
  prepare(renderer: THREE.WebGLRenderer, budgetMs: number): boolean;
}

export interface HarnessOptions {
  /** Page title: document title and overlay label. */
  title?: string;
  /** Vertical field of view, degrees. Default 50. */
  fov?: number;
  /** Near/far planes in the page's units. Defaults 0.01 / 1e7. */
  near?: number;
  far?: number;
  /** Absolute proxy-camera position. Default (0, 0, 5). `?cam=` overrides. */
  cameraPosition?: Vec3Like;
  /** Absolute orbit target. Default origin. `?target=` overrides. */
  target?: Vec3Like;
  /** Quality when `?quality=` is absent. Default 'high'. */
  quality?: Quality;
  /** Show the lil-gui panel. Default true (`?ui=0` hides it regardless). */
  gui?: boolean;
  bloom?: Partial<BloomSettings>;
  exposure?: number;
  /** Clear colour (linear). Default black. */
  background?: THREE.ColorRepresentation;
  /** Simulation days per real second. Default 1. `?simRate=` overrides. */
  simRate?: number;
  /** OrbitControls distance limits. */
  minDistance?: number;
  maxDistance?: number;
}

export interface Harness {
  readonly renderer: THREE.WebGLRenderer;
  /** Scene rendered by the default scene pass; holds camera-relative objects. */
  readonly scene: THREE.Scene;
  /** Render camera: always at the origin, oriented like the proxy. Owns fov/near/far. */
  readonly camera: THREE.PerspectiveCamera;
  /** Absolute-space camera driven by OrbitControls. Never rendered. */
  readonly proxy: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly gui: GUI;
  readonly post: PostFX;
  readonly params: URLSearchParams;
  readonly quality: Quality;
  /** The proxy camera's absolute position, updated before `onFrame` callbacks run. */
  readonly cameraWorldPosition: THREE.Vector3;
  /** `out = absPos − cameraWorldPosition` (float64). Pass `out` in hot paths to avoid allocating. */
  relative(absPos: THREE.Vector3Like, out?: THREE.Vector3): THREE.Vector3;
  /** Shorthand: `object.position = relative(absPos)`. */
  place(object: THREE.Object3D, absPos: THREE.Vector3Like): void;
  /** Run `cb` every frame before rendering. Returns an unsubscribe function. */
  onFrame(cb: (frame: VisualFrame) => void): () => void;
  /** Hold `window.__READY__` until `promise` settles (e.g. async bakes, shader warm-up). */
  waitFor<T>(promise: Promise<T>): Promise<T>;
  /**
   * Call `visual.prepare(renderer, budgetMs)` once per frame, before `onFrame` callbacks, until it
   * returns true — as the engine does for GPU bakes. Holds `window.__READY__` until then.
   */
  prepare(visual: Preparable, budgetMs?: number): Promise<void>;
  /** Resolves after `n` more frames have been rendered. */
  frames(n: number): Promise<void>;
  /** Display pixel (sRGB, 0–255 RGBA) at CSS px (x, y), read right after the next frame. */
  probe(x: number, y: number): Promise<[number, number, number, number]>;
  start(): void;
  dispose(): void;
}

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'ultra'];
const DEFAULT_DPR_CAP = 1.5;
const READY_FRAMES = 5;
const MAX_DT = 0.1;

function isTuple(v: Vec3Like): v is readonly [number, number, number] {
  return Array.isArray(v);
}

function toVector(v: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
  return isTuple(v) ? out.set(v[0], v[1], v[2]) : out.copy(v);
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const parseNumberOrNull = (value: string): number | null => parseNumber(value);

function parseVec3(value: string | null): [number, number, number] | null {
  if (value === null) return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Compact "x,y,z" (10 significant digits) for URL parameters. */
function formatVec3(v: THREE.Vector3): string {
  return [v.x, v.y, v.z].map((c) => String(Number(c.toPrecision(10)))).join(',');
}

const BASE_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; background: #000; color-scheme: dark; }
.sd-harness-canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block;
  touch-action: none; outline: none; }
.sd-harness-hud { position: fixed; left: 12px; z-index: 10; pointer-events: none;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: rgba(226, 232, 240, 0.72); letter-spacing: 0.04em; text-shadow: 0 1px 2px #000; }
.sd-harness-title { top: 10px; text-transform: uppercase; letter-spacing: 0.18em; }
.sd-harness-stats { bottom: 10px; font-variant-numeric: tabular-nums; white-space: pre; }
.sd-harness-error { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px;
  font: 14px/1.5 ui-monospace, Menlo, monospace; color: #fca5a5; background: #0b0b10; }
`;

function injectStyle(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  document.head.append(style);
  return style;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const params = new URLSearchParams(location.search);
  const showUi = params.get('ui') !== '0';
  const qualityParam = params.get('quality') as Quality | null;
  const quality: Quality =
    qualityParam && QUALITIES.includes(qualityParam) ? qualityParam : (options.quality ?? 'high');
  const frozenTime = parseNumber(params.get('t'));
  const dprCap = parseNumber(params.get('dpr')) ?? DEFAULT_DPR_CAP;
  const title = options.title ?? 'Sidereal dev';
  document.title = `${title} — Sidereal dev`;

  const style = injectStyle();

  // ── renderer ──────────────────────────────────────────────────────────────
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false, // AA happens in PostFX (SMAA/FXAA, MSAA on ultra)
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    const message = document.createElement('div');
    message.className = 'sd-harness-error';
    message.textContent = `WebGL2 is unavailable: ${err instanceof Error ? err.message : String(err)}`;
    document.body.append(message);
    throw err;
  }
  renderer.setClearColor(new THREE.Color(options.background ?? 0x000000), 1);
  renderer.info.autoReset = false; // count draw calls for the whole frame, not the last pass
  renderer.domElement.classList.add('sd-harness-canvas');
  renderer.domElement.tabIndex = 0;
  document.body.append(renderer.domElement);

  // ── cameras & controls ────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    options.fov ?? 50,
    1,
    options.near ?? 0.01,
    options.far ?? 1e7,
  );
  const proxy = camera.clone();
  toVector(parseVec3(params.get('cam')) ?? options.cameraPosition ?? [0, 0, 5], proxy.position);

  const controls = new OrbitControls(proxy, renderer.domElement);
  toVector(parseVec3(params.get('target')) ?? options.target ?? [0, 0, 0], controls.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  if (options.minDistance !== undefined) controls.minDistance = options.minDistance;
  if (options.maxDistance !== undefined) controls.maxDistance = options.maxDistance;
  controls.update();

  const scene = new THREE.Scene();
  const bloomParam = (params.get('bloom') ?? '').split(',').map(parseNumberOrNull);
  const post = new PostFX(renderer, {
    quality,
    scenePass: new RenderPass(scene, camera),
    bloom: {
      ...options.bloom,
      ...(bloomParam[0] != null && { intensity: bloomParam[0] }),
      ...(bloomParam[1] != null && { threshold: bloomParam[1] }),
      ...(bloomParam[2] != null && { radius: bloomParam[2] }),
    },
    exposure: parseNumber(params.get('exposure')) ?? options.exposure,
  });

  const cameraWorldPosition = new THREE.Vector3().copy(proxy.position);

  // ── overlays ──────────────────────────────────────────────────────────────
  const titleEl = document.createElement('div');
  titleEl.className = 'sd-harness-hud sd-harness-title';
  titleEl.textContent = `${title} · ${quality}${frozenTime !== null ? ` · t=${frozenTime}s` : ''}`;
  const statsEl = document.createElement('div');
  statsEl.className = 'sd-harness-hud sd-harness-stats';
  if (showUi) document.body.append(titleEl, statsEl);

  // ── clock & GUI state ─────────────────────────────────────────────────────
  const clock = {
    paused: false,
    timeScale: 1,
    simRate: parseNumber(params.get('simRate')) ?? options.simRate ?? 1,
  };
  const startDays = parseNumber(params.get('days')) ?? 0;
  const bloom = post.getBloom();
  const view = {
    exposure: post.getExposure(),
    vignette: post.getVignette(),
    grain: post.getGrain(),
    fov: camera.fov,
    quality,
    copyLink: (): void => {
      const next = new URLSearchParams(location.search);
      next.set('cam', formatVec3(proxy.position));
      next.set('target', formatVec3(controls.target));
      const url = `${location.pathname}?${next.toString()}`;
      history.replaceState(null, '', url);
      void navigator.clipboard?.writeText(location.href).catch(() => undefined);
    },
  };

  const gui = new GUI({ title });
  if (!showUi || options.gui === false) gui.hide();
  const harnessFolder = gui.addFolder('Harness');
  harnessFolder
    .add(view, 'quality', [...QUALITIES])
    .name('quality (reload)')
    .onChange((q: Quality) => {
      params.set('quality', q);
      location.search = params.toString();
    });
  harnessFolder.add(view, 'exposure', 0.05, 8, 0.01).onChange((v: number) => post.setExposure(v));
  harnessFolder
    .add(bloom, 'intensity', 0, 4, 0.01)
    .name('bloom intensity')
    .onChange((v: number) => post.setBloom({ intensity: v }));
  harnessFolder
    .add(bloom, 'threshold', 0, 8, 0.01)
    .name('bloom threshold')
    .onChange((v: number) => post.setBloom({ threshold: v }));
  harnessFolder
    .add(bloom, 'radius', 0, 1, 0.01)
    .name('bloom radius')
    .onChange((v: number) => post.setBloom({ radius: v }));
  harnessFolder.add(view, 'vignette').onChange((v: boolean) => post.setVignette(v));
  harnessFolder.add(view, 'grain', 0, 0.2, 0.005).onChange((v: number) => post.setGrain(v));
  harnessFolder
    .add(view, 'fov', 5, 120, 1)
    .name('fov (deg)')
    .onChange((v: number) => {
      camera.fov = v;
      camera.updateProjectionMatrix();
    });
  harnessFolder.add(clock, 'paused');
  harnessFolder.add(clock, 'timeScale', 0, 10, 0.1).name('time scale');
  harnessFolder.add(clock, 'simRate', 0, 1000, 0.1).name('sim days / s');
  harnessFolder.add(view, 'copyLink').name('copy ?cam= link');
  harnessFolder.close();

  // ── frame state (reused every frame: no per-frame allocations) ────────────
  const frame: VisualFrame = {
    renderer,
    timeSec: frozenTime ?? 0,
    dtSec: 0,
    simDays: startDays + (frozenTime ?? 0) * clock.simRate,
    camera,
    width: 1,
    height: 1,
    pixelRatio: 1,
    quality,
  };
  const callbacks = new Set<(f: VisualFrame) => void>();
  const prepareJobs = new Set<() => void>();
  const probes: {
    x: number;
    y: number;
    resolve: (rgba: [number, number, number, number]) => void;
  }[] = [];
  const probeBuffer = new Uint8Array(4);

  let pending = 0;
  let settledFrames = 0;
  let lastMs: number | null = null;
  let statsFrames = 0;
  let statsCpuMs = 0;
  let statsSince = performance.now();

  function resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, dprCap);
    post.setSize(width, height, pixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frame.width = width;
    frame.height = height;
    frame.pixelRatio = pixelRatio;
  }

  function syncCamera(): void {
    controls.update();
    if (proxy.fov !== camera.fov || proxy.aspect !== camera.aspect) {
      proxy.fov = camera.fov;
      proxy.aspect = camera.aspect;
      proxy.updateProjectionMatrix();
    }
    cameraWorldPosition.copy(proxy.position);
    camera.position.set(0, 0, 0);
    camera.quaternion.copy(proxy.quaternion);
    camera.updateMatrixWorld(true);
  }

  function serviceProbes(): void {
    if (probes.length === 0) return;
    const gl = renderer.getContext();
    renderer.setRenderTarget(null);
    const dpr = renderer.getPixelRatio();
    for (const { x, y, resolve } of probes.splice(0)) {
      const px = Math.min(gl.drawingBufferWidth - 1, Math.max(0, Math.floor(x * dpr)));
      const py = Math.min(
        gl.drawingBufferHeight - 1,
        Math.max(0, gl.drawingBufferHeight - 1 - Math.floor(y * dpr)),
      );
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probeBuffer);
      resolve([probeBuffer[0] ?? 0, probeBuffer[1] ?? 0, probeBuffer[2] ?? 0, probeBuffer[3] ?? 0]);
    }
  }

  function tick(nowMs: number): void {
    const cpuStart = performance.now();
    const realDt = lastMs === null ? 0 : Math.min((nowMs - lastMs) / 1000, MAX_DT);
    lastMs = nowMs;

    if (frozenTime !== null) {
      frame.dtSec = 0;
    } else {
      frame.dtSec = clock.paused ? 0 : realDt * clock.timeScale;
      frame.timeSec += frame.dtSec;
      frame.simDays += frame.dtSec * clock.simRate;
    }

    renderer.info.reset();
    syncCamera();
    for (const job of prepareJobs) job();
    for (const cb of callbacks) cb(frame);
    post.render(frame.dtSec);
    serviceProbes();

    // Readiness: all waitFor() promises settled, then READY_FRAMES more frames.
    settledFrames = pending === 0 ? settledFrames + 1 : 0;
    if (settledFrames >= READY_FRAMES && window.__READY__ !== true) window.__READY__ = true;

    // Stats, refreshed twice a second.
    statsFrames++;
    statsCpuMs += performance.now() - cpuStart;
    const elapsed = nowMs - statsSince;
    if (showUi && elapsed >= 500) {
      const { calls, triangles, points } = renderer.info.render;
      statsEl.textContent =
        `${((statsFrames * 1000) / elapsed).toFixed(0).padStart(3)} fps  ` +
        `${(statsCpuMs / statsFrames).toFixed(2)} ms cpu  ` +
        `${calls} calls  ${triangles.toLocaleString('en-US')} tris  ${points.toLocaleString('en-US')} pts`;
      statsFrames = 0;
      statsCpuMs = 0;
      statsSince = nowMs;
    }
  }

  let started = false;
  const onResize = (): void => resize();

  const harness: Harness = {
    renderer,
    scene,
    camera,
    proxy,
    controls,
    gui,
    post,
    params,
    quality,
    cameraWorldPosition,
    relative(absPos, out = new THREE.Vector3()) {
      return out.set(
        absPos.x - cameraWorldPosition.x,
        absPos.y - cameraWorldPosition.y,
        absPos.z - cameraWorldPosition.z,
      );
    },
    place(object, absPos) {
      harness.relative(absPos, object.position);
    },
    onFrame(cb) {
      callbacks.add(cb);
      return () => {
        callbacks.delete(cb);
      };
    },
    waitFor(promise) {
      pending++;
      promise
        .catch((err: unknown) => console.error('[harness] waitFor() promise rejected:', err))
        .finally(() => {
          pending--;
        });
      return promise;
    },
    prepare(visual, budgetMs = 8) {
      const done = new Promise<void>((resolve, reject) => {
        const job = (): void => {
          try {
            if (!visual.prepare(renderer, budgetMs)) return;
            prepareJobs.delete(job);
            resolve();
          } catch (err) {
            prepareJobs.delete(job);
            reject(err);
          }
        };
        prepareJobs.add(job);
      });
      return harness.waitFor(done);
    },
    frames(n) {
      return new Promise((resolve) => {
        let count = 0;
        const off = harness.onFrame(() => {
          if (++count > n) {
            off();
            resolve();
          }
        });
      });
    },
    probe(x, y) {
      return new Promise((resolve) => probes.push({ x, y, resolve }));
    },
    start() {
      if (started) return;
      started = true;
      window.__READY__ = false;
      resize();
      window.addEventListener('resize', onResize);
      renderer.setAnimationLoop(tick);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      callbacks.clear();
      prepareJobs.clear();
      controls.dispose();
      gui.destroy();
      post.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      titleEl.remove();
      statsEl.remove();
      style.remove();
    },
  };

  resize();
  window.__HARNESS__ = harness;
  return harness;
}
