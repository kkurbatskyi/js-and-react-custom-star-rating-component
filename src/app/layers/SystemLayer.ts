/**
 * SystemLayer (km) — the active planetary system: StarVisual, a lite PlanetVisual for every body the
 * planet layer does not own, orbit lines, belts; markers, labels, picking and occluders.
 *
 * Camera-relative placement: the camera's position in S is `cam.systemKm` (derived from the
 * authoritative focus offset, exact within the system); a body at `posS` sits at
 * R_SG·(posS − systemKm), the star at −R_SG·systemKm. The StarVisual fades in over the outer 40 % of
 * the system radius exactly as the starfield hides the star's point (hand-off without a pop).
 */
import { type PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { smoothstep } from '../../core/math';
import { formatDistanceKm } from '../../core/format';
import {
  type FrameInfo,
  type LabelSpec,
  LabelTier,
  type Layer,
  type LayerRenderSpec,
  type PickHit,
} from '../../engine/contracts';
import type {
  OrbitLinesOptions,
  PlanetUniforms,
  Quality,
  ScreenDisc,
  StarVisualOptions,
  VisualFrame,
} from '../../render/contracts';
import {
  bodyLabel,
  createPlanetUniforms,
  drawPlanet,
  fillPlanetUniforms,
  labelAt,
  pushDisc,
  setStarRef,
} from './bodies';
import {
  createVisualFrame,
  type LayerContext,
  pixelsPerRadian,
  projectRelative,
  type ScreenPoint,
  syncVisualFrame,
} from './context';
import { buildSlices, type Interval } from './depthSlices';
import type { SystemAssets } from './SystemAssets';

/** Bodies smaller than this on screen (radius, px) are not drawn: their marker stands in. */
const MIN_DRAW_RADIUS_PX = 0.35;
/** Moons closer than this to their planet on screen get no label at system scale. */
const MOON_LABEL_SEPARATION_PX = 22;
/** The star's glow extends this many radii (depth interval). */
const STAR_EXTENT_RADII = 8;

export class SystemLayer implements Layer {
  readonly id = 'system';
  readonly scene = new Scene();
  private readonly ctx: LayerContext;
  private assets: SystemAssets | null = null;
  private readonly vframe: VisualFrame;
  private readonly uniforms: PlanetUniforms = createPlanetUniforms();
  private readonly starRel = new Vector3();
  private readonly starOptions: StarVisualOptions = { positionKm: this.starRel, intensity: 1 };
  private readonly focusRel = new Vector3();
  private readonly orbitOptions: OrbitLinesOptions = {
    starPositionKm: this.starRel,
    eclipticToWorld: new Quaternion(), // replaced by the system's frame
    opacity: 1,
    simDays: 0,
    highlightId: null,
    focusPositionKm: null,
  };
  private readonly intervals: Interval[] = [];
  private readonly cover: Interval = { near: 1, far: 1 };
  private readonly slices: LayerRenderSpec[] = [];
  private readonly labelPool: LabelSpec[] = [];
  private readonly discPool: ScreenDisc[] = [];
  private readonly starScreen: ScreenPoint = { x: 0, y: 0, depth: 0 };
  private starRadiusPx = 0;
  private starVisible = false;
  private starIntensity = 0;
  private readonly range = { start: 0, end: 0 };
  private readonly scratch = new Vector3();
  private readonly screen: ScreenPoint = { x: 0, y: 0, depth: 0 };
  private active = false;
  private focusId: string | null = null;
  private destinationId: string | null = null;

  constructor(ctx: LayerContext, quality: Quality) {
    this.ctx = ctx;
    this.vframe = createVisualFrame(ctx.engine.renderer, quality);
  }

  update(frame: FrameInfo, camera: PerspectiveCamera): LayerRenderSpec[] | null {
    const engine = this.ctx.engine;
    const handle = engine.systemHandle;
    const camS = frame.cam.systemKm;
    if (!handle?.system || !camS) {
      this.detach();
      return null;
    }
    const assets = this.ctx.assets.get(handle.system);
    if (assets !== this.assets) this.attach(assets);
    assets.update(frame.simDays);
    this.active = true;
    const system = assets.system;
    const vf = syncVisualFrame(this.vframe, frame, camera);
    const ppr = pixelsPerRadian(camera, frame.height);
    const { width, height } = frame;

    // The star.
    this.starRel.copy(camS).applyQuaternion(assets.frame).negate();
    const dStar = camS.length();
    const rStar = system.star.radiusKm;
    this.starIntensity = smoothstep(system.radiusKm, 0.6 * system.radiusKm, dStar);
    this.starVisible = projectRelative(this.starRel, camera, width, height, this.scratch, this.starScreen);
    this.starRadiusPx = (rStar / Math.max(dStar, rStar)) * ppr;

    // Which bodies does the planet layer own this frame?
    const anchor = engine.rig.anchor;
    this.range.start = this.range.end = 0;
    if (frame.level === 'planet' && anchor.planet && anchor.starId === system.id) {
      assets.familyRange(anchor.planet.id, this.range);
    }
    this.focusId = anchor.starId === system.id ? (anchor.body?.id ?? anchor.starId) : null;
    const dest = engine.rig.destination;
    this.destinationId = dest && dest.starId === system.id ? (dest.body?.id ?? dest.starId) : null;

    let n = 0;
    n = this.pushInterval(n, dStar - STAR_EXTENT_RADII * rStar, dStar + STAR_EXTENT_RADII * rStar);
    const bodies = assets.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (i >= this.range.start && i < this.range.end) continue; // the planet layer's
      if (b.lite.object.parent !== this.scene) this.scene.add(b.lite.object);
      b.owner = 'system';
      b.rel.subVectors(b.posS, camS).applyQuaternion(assets.frame);
      const d = b.rel.length();
      b.onScreen = projectRelative(b.rel, camera, width, height, this.scratch, this.screen);
      b.screenX = this.screen.x;
      b.screenY = this.screen.y;
      b.radiusPx = (b.body.radiusKm / Math.max(d, b.body.radiusKm)) * ppr;
      const draw = b.onScreen && b.radiusPx >= MIN_DRAW_RADIUS_PX;
      drawPlanet(b.lite, vf, fillPlanetUniforms(this.uniforms, b, assets, 1, undefined), draw);
      if (draw) n = this.pushInterval(n, d - b.extentKm, d + b.extentKm);
    }

    // Orbits and belts fade in with the star as the camera enters the system.
    const o = this.orbitOptions;
    o.eclipticToWorld = assets.frame;
    o.opacity = this.ctx.orbitOpacity() * this.starIntensity;
    o.simDays = frame.simDays;
    const sel = this.ctx.selectedId();
    o.highlightId = sel !== null && assets.indexOf(sel) >= 0 ? sel : (anchor.body?.id ?? null);
    if (anchor.body && anchor.starId === system.id) {
      o.focusPositionKm = this.focusRel.subVectors(anchor.posS, camS).applyQuaternion(assets.frame);
    } else {
      o.focusPositionKm = null;
    }
    assets.orbitLines.update(vf, o);
    for (const belt of assets.belts) belt.update(vf, o);
    this.starOptions.intensity = this.starIntensity;
    assets.star.update(vf, this.starOptions);

    this.cover.near = Math.max(1, 1e-4 * dStar);
    this.cover.far = dStar + system.radiusKm;
    const count = buildSlices(this.intervals, n, this.slices, this.cover);
    let near = Number.POSITIVE_INFINITY;
    let far = 0;
    for (let i = 0; i < count; i++) {
      near = Math.min(near, this.slices[i].near);
      far = Math.max(far, this.slices[i].far);
    }
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    this.slices.length = count;
    return this.slices;
  }

  occluders(out: ScreenDisc[]): void {
    const assets = this.assets;
    if (!this.active || !assets) return;
    let slot = 0;
    const pool = this.discPool;
    if (this.starVisible && this.starRadiusPx > 1.5 && this.starIntensity > 0.5) {
      slot = pushDisc(pool, slot, out, this.starScreen.x, this.starScreen.y, this.starRadiusPx);
    }
    for (const b of assets.bodies) {
      if (b.owner === 'system' && b.onScreen && b.radiusPx > 1.5) {
        slot = pushDisc(pool, slot, out, b.screenX, b.screenY, b.radiusPx);
      }
    }
  }

  pick(x: number, y: number, maxDistPx: number): PickHit | null {
    const assets = this.assets;
    if (!this.active || !assets) return null;
    let best: PickHit | null = null;
    let bestD = maxDistPx;
    for (const b of assets.bodies) {
      if (b.owner !== 'system' || !b.onScreen) continue;
      const handicap = b.moon ? 4 : 0; // prefer the planet when a moon sits on top of it
      const d = Math.max(0, Math.hypot(b.screenX - x, b.screenY - y) - b.radiusPx) + handicap;
      if (d <= bestD) {
        bestD = d;
        best = { ref: { kind: b.moon ? 'moon' : 'planet', id: b.id }, distPx: d, x: b.screenX, y: b.screenY };
      }
    }
    if (this.starVisible && this.starIntensity > 0.2) {
      const d = Math.max(0, Math.hypot(this.starScreen.x - x, this.starScreen.y - y) - Math.max(this.starRadiusPx, 6));
      if (d <= bestD) {
        best = {
          ref: { kind: 'star', id: assets.system.id },
          distPx: d,
          x: this.starScreen.x,
          y: this.starScreen.y,
        };
      }
    }
    return best;
  }

  labels(out: LabelSpec[]): void {
    const assets = this.assets;
    if (!this.active || !assets || !this.ctx.labelsEnabled()) return;
    const sel = this.ctx.selectedId();
    let slot = 0;
    if (this.starVisible && this.starIntensity > 0.3) {
      const star = assets.system.star;
      const spec = labelAt(this.labelPool, slot++);
      spec.key = star.id;
      setStarRef(spec, star.id);
      spec.text = star.name;
      spec.sub = star.spectralType;
      spec.x = this.starScreen.x;
      spec.y = this.starScreen.y;
      spec.priority = this.tier(star.id, sel, LabelTier.planet) * 1000 + 999;
      spec.marker = null;
      spec.color = undefined;
      out.push(spec);
    }
    const bodies = assets.bodies;
    let parentX = 0;
    let parentY = 0;
    for (const b of bodies) {
      if (!b.moon) {
        parentX = b.screenX;
        parentY = b.screenY;
      }
      if (b.owner !== 'system' || !b.onScreen) continue;
      const important = b.id === sel || b.id === this.focusId || b.id === this.destinationId;
      if (b.moon && !important) {
        if (Math.hypot(b.screenX - parentX, b.screenY - parentY) < MOON_LABEL_SEPARATION_PX) continue;
      }
      const base = b.moon ? LabelTier.moon : LabelTier.planet;
      const rank = Math.min(998, Math.round(Math.log10(b.body.radiusKm) * 150));
      const marker = b.id === sel ? 'ring' : b.radiusPx < 3 ? 'dot' : null;
      const sub = important ? formatDistanceKm(b.rel.length()) : undefined;
      out.push(bodyLabel(labelAt(this.labelPool, slot++), b, this.tier(b.id, sel, base) * 1000 + rank, marker, sub));
    }
  }

  setQuality(q: Quality): void {
    this.ctx.assets.setQuality(q);
  }

  dispose(): void {
    this.detach();
  }

  // ───────────────────────────────────────────── internals

  private tier(id: string, selected: string | null, base: number): number {
    if (id === this.focusId || id === this.destinationId) return LabelTier.focus;
    if (id === selected) return LabelTier.selected;
    return base;
  }

  private pushInterval(n: number, near: number, far: number): number {
    let it = this.intervals[n];
    if (!it) {
      it = { near: 0, far: 0 };
      this.intervals[n] = it;
    }
    it.near = Math.max(near, 1e-3);
    it.far = Math.max(far, it.near * 1.001);
    return n + 1;
  }

  private attach(assets: SystemAssets): void {
    this.detach();
    this.assets = assets;
    this.scene.add(assets.star.object, assets.orbitLines.object);
    for (const belt of assets.belts) this.scene.add(belt.object);
  }

  /** Stop drawing the current system (its visuals stay cached in the SystemAssetCache). */
  private detach(): void {
    this.active = false;
    const assets = this.assets;
    if (!assets) return;
    for (const obj of [assets.star.object, assets.orbitLines.object, ...assets.belts.map((b) => b.object)]) {
      if (obj.parent === this.scene) this.scene.remove(obj);
    }
    for (const b of assets.bodies) {
      if (b.lite.object.parent === this.scene) this.scene.remove(b.lite.object);
      if (b.owner === 'system') b.owner = null;
    }
    this.assets = null;
  }
}
