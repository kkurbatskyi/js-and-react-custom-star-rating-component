/**
 * Engine — renderer, HDR post pipeline, the layer stack, the camera rig and the frame loop.
 *
 * Per frame:  clock → hooks.beforeUpdate → rig (orbit / flight) → CameraSnapshot (galactic ly,
 * active system, system km, view level) → layers.update (far → near, each with its own camera at the
 * origin sharing the rig's orientation) → sun & travel info → PostFX (LayerStackPass + effects) →
 * hooks.afterRender (labels, store sync, audio).
 *
 * The engine knows nothing about the store, the UI or concrete visuals: src/app composes those.
 */
import { PerspectiveCamera, Quaternion, Vector3, WebGLRenderer } from 'three';
import { RAD_TO_DEG, smoothstep } from '../core/math';
import type { FocusTarget, StarId } from '../core/types';
import type { Quality, ScreenDisc } from '../render/contracts';
import { PostFX } from '../render/post/PostFX';
import type { QualitySetting } from '../state/contracts';
import type { Universe } from '../universe/contracts';
import { CameraRig } from './camera/CameraRig';
import { type FocusHandle, resolveFocus } from './camera/focus';
import { galacticLyOf, systemKmOf } from './camera/frames';
import { framingDistanceKm, type OrbitPose, OVERVIEW_PITCH } from './camera/framing';
import type { CameraSnapshot, FrameInfo, LabelSpec, Layer, PickHit } from './contracts';
import { LayerStackPass } from './LayerStackPass';
import { LevelTracker, type SystemCandidate } from './levels';
import { collectLabels, insideAnyDisc, pickLayers } from './picking';
import { AdaptiveResolution, pixelRatioCap, resolveQuality } from './quality';
import { SimClock } from './SimClock';

export interface EngineOptions {
  universe: Universe;
  quality: QualitySetting;
  simDays: number;
  timeScale?: number;
  /** Bloom intensity multiplier (settings.bloom, 0..2). */
  bloom?: number;
  /** Vertical field of view, degrees. Default 50. */
  fovDeg?: number;
}

export interface EngineHooks {
  /** Before the camera moves: consume requests, apply settings. `dt` is 0 while frozen. */
  beforeUpdate?(engine: Engine, dtSec: number): void;
  /** After the layers updated, before PostFX renders (FX uniforms). */
  beforeRender?(frame: FrameInfo): void;
  /** After the frame rendered (labels, store sync, audio). */
  afterRender?(frame: FrameInfo): void;
}

/** Screen margins covered by UI (CSS px): the view is composed in the remaining rectangle. */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EngineStats {
  fps: number;
  /** EMA of the frame interval, ms. */
  frameMs: number;
  /** EMA of the JS time spent per frame (update + render submission), ms. */
  jsMs: number;
  renderScale: number;
  pixelRatio: number;
  quality: Quality;
}

const MAX_DT_SEC = 0.1;
/** Rate at which the optical centre glides to new view insets, 1/s. */
const INSET_LAMBDA = 7;
const STATS_ALPHA = 0.08;
/** Fraction of the viewport beyond its edges over which an off-screen sun fades out. */
const SUN_EDGE_MARGIN = 0.15;

function coarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly post: PostFX;
  readonly clock: SimClock;
  readonly rig: CameraRig;
  readonly levels = new LevelTracker();
  readonly snapshot: CameraSnapshot;
  readonly frame: FrameInfo;
  readonly stats: EngineStats;
  readonly hooks: EngineHooks[] = [];
  universe: Universe;
  /** Exposure before the reduced-motion fade (1 = neutral). */
  exposure = 1;

  private qualitySetting: QualitySetting;
  private layerList: readonly Layer[] = [];
  private cameras: PerspectiveCamera[] = [];
  private readonly active: boolean[] = [];
  private readonly stack = new LayerStackPass();
  private readonly adaptive = new AdaptiveResolution();
  private readonly fovDeg: number;
  private readonly systemKmStore = new Vector3();
  private readonly candidates: SystemCandidate[] = [0, 1, 2].map(() => ({
    id: null,
    distanceKm: 0,
    radiusKm: 1,
  }));
  private readonly candidateHandles: (FocusHandle | null)[] = [null, null, null];
  private systemHandleRef: FocusHandle | null = null;
  private readonly prevGalacticLy = new Vector3();
  private hasPrevGalactic = false;
  private readonly travelDir = new Vector3();
  private readonly sunInfo = { x: 0, y: 0, visibility: 0 };
  private readonly discs: ScreenDisc[] = [];
  private readonly insets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Current (damped) optical-centre shift, CSS px: the view offset applied to every camera. */
  private shiftX = 0;
  private shiftY = 0;
  private readonly labelScratch: LabelSpec[] = [];
  private raf = 0;
  private running = false;
  private lastNow = 0;
  private needsResize = true;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
    this.canvas = canvas;
    this.universe = options.universe;
    this.qualitySetting = options.quality;
    this.fovDeg = options.fovDeg ?? 50;
    const quality = resolveQuality(options.quality, { coarsePointer: coarsePointer() });

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      depth: true,
      stencil: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.post = new PostFX(this.renderer, {
      quality,
      scenePass: this.stack,
      bloom: { intensity: options.bloom ?? 1 },
    });
    this.clock = new SimClock(options.simDays, options.timeScale);

    const centre = resolveFocus(options.universe, { kind: 'galaxy', centerLy: [0, 0, 0] });
    if (!centre) throw new Error('Engine: cannot resolve the galactic centre');
    const pose: OrbitPose = {
      yaw: 0.9,
      pitch: OVERVIEW_PITCH,
      distanceKm: framingDistanceKm(
        centre,
        (canvas.clientWidth || window.innerWidth) /
          Math.max(1, canvas.clientHeight || window.innerHeight),
      ),
    };
    this.rig = new CameraRig((t) => this.resolve(t), centre, pose, this.fovDeg / RAD_TO_DEG);

    this.snapshot = {
      focus: centre.target,
      focusOffsetKm: new Vector3(),
      focusDistanceKm: 0,
      galacticLy: new Vector3(),
      systemId: null,
      systemKm: null,
      quaternion: new Quaternion(),
      fovY: this.rig.fovY,
    };
    this.frame = {
      renderer: this.renderer,
      timeSec: 0,
      dtSec: 0,
      simDays: options.simDays,
      width: 1,
      height: 1,
      pixelRatio: 1,
      quality,
      cam: this.snapshot,
      level: 'galaxy',
      flight: null,
      travel: 0,
      sun: null,
      travelDirection: this.travelDir,
    };
    this.stats = {
      fps: 60,
      frameMs: 16.7,
      jsMs: 0,
      renderScale: 1,
      pixelRatio: 1,
      quality,
    };

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        this.needsResize = true;
      });
      this.resizeObserver.observe(canvas);
    }
    window.addEventListener('resize', this.onWindowResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.updateSnapshot();
  }

  // ───────────────────────────────────────────── configuration

  get layers(): readonly Layer[] {
    return this.layerList;
  }

  get quality(): Quality {
    return this.frame.quality;
  }

  /** The active system's focus handle (whose star is `snapshot.systemId`), or null. */
  get systemHandle(): FocusHandle | null {
    return this.systemHandleRef;
  }

  /** Layers far → near. The engine owns one camera per layer; the caller owns the layers. */
  setLayers(layers: readonly Layer[]): void {
    this.layerList = layers;
    while (this.cameras.length < layers.length) {
      this.cameras.push(new PerspectiveCamera(this.fovDeg, 1, 1, 10));
    }
    this.active.length = layers.length;
    this.active.fill(false);
  }

  setQualitySetting(setting: QualitySetting): void {
    this.qualitySetting = setting;
    const q = resolveQuality(setting, { coarsePointer: coarsePointer() });
    this.adaptive.reset();
    if (q !== this.frame.quality) {
      this.frame.quality = q;
      this.stats.quality = q;
      this.post.setQuality(q);
      for (const layer of this.layerList) layer.setQuality?.(q);
    }
    this.needsResize = true;
  }

  /**
   * Compose the view in the part of the screen not covered by UI: the optical centre glides to the
   * centre of the free rectangle (three.js view offset on every layer camera), so a focused object
   * is centred where the user can see it. Picking, labels and rays stay consistent.
   */
  setViewInsets(insets: Partial<ViewInsets>): void {
    Object.assign(this.insets, insets);
  }

  setUniverse(universe: Universe): void {
    this.universe = universe;
  }

  resolve(target: FocusTarget): FocusHandle | null {
    return resolveFocus(this.universe, target);
  }

  /** Fly (or cut) to a target. Returns false when the target does not exist. */
  navigate(target: FocusTarget, mode: 'fly' | 'jump', reducedMotion: boolean): boolean {
    const handle = this.resolve(target);
    if (!handle) return false;
    if (mode === 'jump') this.rig.jumpTo(handle, this.clock.simDays);
    else this.rig.flyTo(handle, reducedMotion, this.clock.simDays);
    return true;
  }

  // ───────────────────────────────────────────── loop

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastNow = performance.now();
    if (!document.hidden) this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Update and render one frame synchronously (dt = 0), e.g. right before a capture. */
  renderNow(): void {
    this.step(0);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const dtMs = now - this.lastNow;
    this.lastNow = now;
    if (this.qualitySetting === 'auto' && this.adaptive.sample(dtMs)) this.needsResize = true;
    this.stats.frameMs += (dtMs - this.stats.frameMs) * STATS_ALPHA;
    this.stats.fps = 1000 / Math.max(1, this.stats.frameMs);
    this.step(Math.min(MAX_DT_SEC, Math.max(0, dtMs / 1000)));
  };

  private readonly onVisibility = (): void => {
    if (!this.running) return;
    cancelAnimationFrame(this.raf);
    if (!document.hidden) {
      this.lastNow = performance.now(); // no giant dt after a hidden tab
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private readonly onWindowResize = (): void => {
    this.needsResize = true;
  };

  private step(dtReal: number): void {
    const t0 = performance.now();
    if (this.needsResize) this.applySize();
    const dt = this.clock.advance(dtReal);
    for (const h of this.hooks) h.beforeUpdate?.(this, dt);

    this.rig.update(dt, this.clock.simDays);
    this.updateSnapshot();
    const f = this.frame;
    f.timeSec = this.clock.timeSec;
    f.dtSec = dt;
    f.simDays = this.clock.simDays;
    f.level = this.levels.level;
    f.flight = this.rig.progress;
    f.travel = this.rig.travel;
    this.updateTravelDirection(dt);
    this.updateLayers();
    f.sun = this.computeSun();

    for (const h of this.hooks) h.beforeRender?.(f);
    this.post.setExposure(this.exposure * this.rig.fade);
    this.post.render(dt);
    for (const h of this.hooks) h.afterRender?.(f);
    this.stats.jsMs += (performance.now() - t0 - this.stats.jsMs) * STATS_ALPHA;
  }

  private applySize(): void {
    this.needsResize = false;
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const scale = this.qualitySetting === 'auto' ? this.adaptive.scale : 1;
    const pixelRatio = pixelRatioCap(this.frame.quality, window.devicePixelRatio || 1) * scale;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false); // CSS size stays 100%: never write inline px
    this.post.setSize(width, height, pixelRatio);
    this.frame.width = width;
    this.frame.height = height;
    this.frame.pixelRatio = pixelRatio;
    this.rig.viewAspect = width / height;
    this.stats.renderScale = scale;
    this.stats.pixelRatio = pixelRatio;
  }

  // ───────────────────────────────────────────── per-frame derivations

  private updateSnapshot(): void {
    const rig = this.rig;
    const anchor = rig.anchor;
    const snap = this.snapshot;
    snap.focus = anchor.target;
    snap.focusOffsetKm.copy(rig.offsetKm);
    snap.focusDistanceKm = rig.offsetKm.length();
    galacticLyOf(anchor, rig.offsetKm, snap.galacticLy);
    snap.quaternion.copy(rig.quaternion);
    snap.fovY = rig.fovY;

    // Candidate systems: the anchor's star and the flight endpoints' stars — never a search.
    let n = this.considerSystem(anchor, 0);
    n = this.considerSystem(rig.flight?.from ?? null, n);
    n = this.considerSystem(rig.flight?.to ?? null, n);
    this.levels.update(anchor.kind, snap.focusDistanceKm, anchor.planetZoneKm, this.candidates, n);

    const systemId: StarId | null = this.levels.systemId;
    let handle: FocusHandle | null = null;
    for (let i = 0; i < n; i++)
      if (this.candidates[i].id === systemId) handle = this.candidateHandles[i];
    this.systemHandleRef = handle;
    snap.systemId = handle ? systemId : null;
    snap.systemKm = handle
      ? systemKmOf(anchor, rig.offsetKm, handle.starPoint, this.systemKmStore)
      : null;
    for (let i = 0; i < 3; i++) this.candidateHandles[i] = null;
  }

  /** Add `h`'s star to the system candidates (deduplicated); returns the new count. */
  private considerSystem(h: FocusHandle | null, n: number): number {
    if (!h?.system || h.starId === null) return n;
    for (let i = 0; i < n; i++) if (this.candidates[i].id === h.starId) return n;
    const c = this.candidates[n];
    c.id = h.starId;
    c.radiusKm = h.system.radiusKm;
    c.distanceKm = systemKmOf(
      this.rig.anchor,
      this.rig.offsetKm,
      h.starPoint,
      this.systemKmStore,
    ).length();
    this.candidateHandles[n] = h;
    return n + 1;
  }

  private updateLayers(): void {
    const f = this.frame;
    const aspect = f.width / f.height;
    const i = this.insets;
    const k = f.dtSec > 0 ? 1 - Math.exp(-INSET_LAMBDA * f.dtSec) : 1;
    this.shiftX += ((i.right - i.left) / 2 - this.shiftX) * k;
    this.shiftY += ((i.bottom - i.top) / 2 - this.shiftY) * k;
    const shifted = Math.abs(this.shiftX) > 0.05 || Math.abs(this.shiftY) > 0.05;
    this.stack.begin();
    const layers = this.layerList;
    for (let i = 0; i < layers.length; i++) {
      const camera = this.cameras[i];
      camera.position.set(0, 0, 0);
      camera.quaternion.copy(this.snapshot.quaternion);
      camera.fov = this.fovDeg;
      camera.aspect = aspect;
      if (shifted)
        camera.setViewOffset(f.width, f.height, this.shiftX, this.shiftY, f.width, f.height);
      else if (camera.view?.enabled) camera.clearViewOffset();
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const slices = layers[i].update(f, camera);
      this.active[i] = slices !== null && slices.length > 0;
      if (!slices) continue;
      for (const s of slices) this.stack.push(s.scene ?? layers[i].scene, camera, s.near, s.far);
    }
  }

  /** Motion direction in view space from the change in galactic position (only matters when fast). */
  private updateTravelDirection(dt: number): void {
    const g = this.snapshot.galacticLy;
    if (this.hasPrevGalactic && dt > 0 && this.frame.travel > 0.001) {
      this.travelDir.subVectors(g, this.prevGalacticLy);
      const len = this.travelDir.length();
      if (len > 0) {
        this.travelDir.divideScalar(len);
        _qInv.copy(this.snapshot.quaternion).invert();
        this.travelDir.applyQuaternion(_qInv);
      }
    } else if (this.frame.travel <= 0.001) {
      this.travelDir.set(0, 0, 0);
    }
    this.prevGalacticLy.copy(g);
    this.hasPrevGalactic = true;
  }

  /** Screen position and visibility of the active system's star (for flares and god-rays). */
  private computeSun(): FrameInfo['sun'] {
    const handle = this.systemHandleRef;
    const systemKm = this.snapshot.systemKm;
    if (!handle || !systemKm) return null;
    const f = this.frame;
    // Star relative to the camera, view space: −R(systemKm) rotated by the inverse camera.
    _v.copy(systemKm).applyQuaternion(handle.frame).negate();
    _qInv.copy(this.snapshot.quaternion).invert();
    _v.applyQuaternion(_qInv);
    const s = this.sunInfo;
    if (_v.z >= 0) {
      s.visibility = 0;
      return s;
    }
    const t = Math.tan(this.snapshot.fovY / 2);
    const ndcX = _v.x / (-_v.z * t * (f.width / f.height));
    const ndcY = _v.y / (-_v.z * t);
    s.x = (ndcX * 0.5 + 0.5) * f.width - this.shiftX;
    s.y = (0.5 - ndcY * 0.5) * f.height - this.shiftY;
    const edge = Math.max(Math.abs((s.x / f.width) * 2 - 1), Math.abs((s.y / f.height) * 2 - 1));
    let vis = 1 - smoothstep(1, 1 + 2 * SUN_EDGE_MARGIN, edge);
    if (vis > 0) {
      // Occluded by a body disc of any layer (the star's own disc is concentric: skipped).
      this.discs.length = 0;
      for (let i = 0; i < this.layerList.length; i++) {
        if (this.active[i]) this.layerList[i].occluders?.(this.discs);
      }
      let n = 0;
      for (const d of this.discs) {
        if (Math.hypot(d.x - s.x, d.y - s.y) > 0.75) this.discs[n++] = d;
      }
      if (insideAnyDisc(this.discs, n, s.x, s.y)) vis = 0;
    }
    s.visibility = vis;
    return s;
  }

  // ───────────────────────────────────────────── queries

  /** Best pick under a CSS-pixel position across all active layers (near-first, occlusion-aware). */
  pick(x: number, y: number, maxDistPx = 14): PickHit | null {
    return pickLayers(this.layerList, this.active, x, y, maxDistPx);
  }

  /** All visible labels of this frame (occlusion-culled), written into `out`. */
  collectLabels(out: LabelSpec[]): number {
    return collectLabels(this.layerList, this.active, out, this.labelScratch);
  }

  /** Unit ray direction (galactic axes) under a CSS-pixel position. */
  screenRay(x: number, y: number, out: Vector3): Vector3 {
    const f = this.frame;
    const t = Math.tan(this.snapshot.fovY / 2);
    const ndcX = ((x + this.shiftX) / f.width) * 2 - 1;
    const ndcY = 1 - ((y + this.shiftY) / f.height) * 2;
    return out
      .set(ndcX * t * (f.width / f.height), ndcY * t, -1)
      .normalize()
      .applyQuaternion(this.snapshot.quaternion);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.post.dispose();
    this.stack.dispose();
    this.renderer.dispose();
  }
}

const _v = new Vector3();
const _qInv = new Quaternion();
