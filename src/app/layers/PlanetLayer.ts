/**
 * PlanetLayer (km) — the focus's local group at the `planet` level: the planet (with its rings) and
 * all its moons, whichever of them is the focus. It is the nearest layer, so everything that can
 * pass in front of the focus (its moons, its rings' near side) must live here — the system layer
 * skips these bodies (docs/ARCHITECTURE.md §5).
 *
 * Positions are differenced against the anchor body in S — `R_SG·(posS − anchor.posS) − offset` —
 * so the focus itself sits at exactly −offset: no jitter at any distance or time scale.
 *
 * The focus body swaps its 'lite' visual for a 'full' one once the full visual's GPU bakes are done
 * (prepared a few ms per frame from the moment it becomes the focus or flight destination) and its
 * disk is large enough to need it (hysteresis: on above FULL_ON_PX, off below FULL_OFF_PX).
 * Depth slices keep a moon at 1 km altitude and its giant 10⁶ km away both precise.
 */
import { type PerspectiveCamera, Scene, Vector3 } from 'three';
import { formatDistanceKm } from '../../core/format';
import type { FocusHandle } from '../../engine/camera/focus';
import {
  type FrameInfo,
  type LabelSpec,
  LabelTier,
  type Layer,
  type LayerRenderSpec,
  type PickHit,
} from '../../engine/contracts';
import type {
  IPlanetVisual,
  PlanetUniforms,
  Quality,
  ScreenDisc,
  VisualFrame,
} from '../../render/contracts';
import {
  bodyLabel,
  createPlanetUniforms,
  drawPlanet,
  fillPlanetUniforms,
  labelAt,
  type Occluder,
  pushDisc,
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
import type { BodyState, SystemAssets } from './SystemAssets';

/** Full visual above this projected radius (px), lite again below FULL_OFF_PX (hysteresis). */
const FULL_ON_PX = 28;
const FULL_OFF_PX = 20;
/** GPU bake budget per frame for the focus / destination full visuals, ms. */
const PREPARE_BUDGET_MS = 3;
/** The focus's own label is redundant once its disk is this large (radius, px). */
const FOCUS_LABEL_MAX_PX = 40;

export class PlanetLayer implements Layer {
  readonly id = 'planet';
  readonly scene = new Scene();
  private readonly ctx: LayerContext;
  private readonly vframe: VisualFrame;
  private readonly uniforms: PlanetUniforms = createPlanetUniforms();
  private assets: SystemAssets | null = null;
  private readonly range = { start: 0, end: 0 };
  private full: IPlanetVisual | null = null;
  private showingFull = false;
  private focusIndex = -1;
  private readonly intervals: Interval[] = [];
  private readonly slices: LayerRenderSpec[] = [];
  private readonly labelPool: LabelSpec[] = [];
  private readonly discPool: ScreenDisc[] = [];
  /** occluders[i]: every family body except i (pooled arrays of shared entries). */
  private readonly occluderEntries: Occluder[] = [];
  private readonly occluderLists: Occluder[][] = [];
  private readonly scratch = new Vector3();
  private readonly screen: ScreenPoint = { x: 0, y: 0, depth: 0 };
  private active = false;

  constructor(ctx: LayerContext, quality: Quality) {
    this.ctx = ctx;
    this.vframe = createVisualFrame(ctx.engine.renderer, quality);
  }

  update(frame: FrameInfo, camera: PerspectiveCamera): LayerRenderSpec[] | null {
    const rig = this.ctx.engine.rig;
    const anchor = rig.anchor;
    this.prepareFull(anchor, rig.destination);
    if (frame.level !== 'planet' || !anchor.planet || !anchor.system || !anchor.body) {
      this.release();
      return null;
    }
    const assets = this.ctx.assets.get(anchor.system);
    assets.update(frame.simDays);
    if (assets !== this.assets) this.release();
    this.assets = assets;
    this.active = true;
    assets.familyRange(anchor.planet.id, this.range);
    const { start, end } = this.range;
    this.focusIndex = assets.indexOf(anchor.body.id);
    const vf = syncVisualFrame(this.vframe, frame, camera);
    const ppr = pixelsPerRadian(camera, frame.height);
    const offset = frame.cam.focusOffsetKm;
    const bodies = assets.bodies;

    // Positions relative to the anchor body (exact), then camera-relative.
    for (let i = start; i < end; i++) {
      const b = bodies[i];
      if (b.lite.object.parent !== this.scene) this.scene.add(b.lite.object);
      b.owner = 'planet';
      b.rel.subVectors(b.posS, anchor.posS).applyQuaternion(assets.frame).sub(offset);
      const d = b.rel.length();
      b.onScreen = projectRelative(
        b.rel,
        camera,
        frame.width,
        frame.height,
        this.scratch,
        this.screen,
      );
      b.screenX = this.screen.x;
      b.screenY = this.screen.y;
      b.radiusPx = (b.body.radiusKm / Math.max(d, b.body.radiusKm)) * ppr;
    }
    this.buildOccluders(bodies, start, end);

    // Lite ↔ full for the focus body.
    const focus = bodies[this.focusIndex];
    const full = this.ctx.fullVisuals.peek(focus.id);
    if (full !== this.full) {
      if (this.full && this.full.object.parent === this.scene) this.scene.remove(this.full.object);
      this.full = full;
      this.showingFull = false;
    }
    if (full?.ready) {
      const threshold = this.showingFull ? FULL_OFF_PX : FULL_ON_PX;
      this.showingFull = focus.radiusPx > threshold;
    } else {
      this.showingFull = false;
    }
    if (full && full.object.parent !== this.scene) this.scene.add(full.object);

    let n = 0;
    for (let i = start; i < end; i++) {
      const b = bodies[i];
      const u = fillPlanetUniforms(this.uniforms, b, assets, 1, this.occluderLists[i - start]);
      const useFull = i === this.focusIndex && this.showingFull;
      drawPlanet(b.lite, vf, u, !useFull);
      if (useFull && full) drawPlanet(full, vf, u, true);
      n = this.pushInterval(n, b);
    }
    if (full && !this.showingFull) full.object.visible = false;

    const count = buildSlices(this.intervals, n, this.slices);
    this.slices.length = count;
    let near = Number.POSITIVE_INFINITY;
    let far = 0;
    for (let i = 0; i < count; i++) {
      near = Math.min(near, this.slices[i].near);
      far = Math.max(far, this.slices[i].far);
    }
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    return this.slices;
  }

  occluders(out: ScreenDisc[]): void {
    const assets = this.assets;
    if (!this.active || !assets) return;
    let slot = 0;
    for (let i = this.range.start; i < this.range.end; i++) {
      const b = assets.bodies[i];
      if (b.onScreen && b.radiusPx > 1) {
        slot = pushDisc(this.discPool, slot, out, b.screenX, b.screenY, b.radiusPx);
      }
    }
  }

  pick(x: number, y: number, maxDistPx: number): PickHit | null {
    const assets = this.assets;
    if (!this.active || !assets) return null;
    let best: PickHit | null = null;
    let bestD = maxDistPx;
    let bestDepth = Number.POSITIVE_INFINITY;
    for (let i = this.range.start; i < this.range.end; i++) {
      const b = assets.bodies[i];
      if (!b.onScreen) continue;
      const d = Math.max(0, Math.hypot(b.screenX - x, b.screenY - y) - b.radiusPx);
      const depth = b.rel.length();
      // Inside several discs (a moon in front of its planet): the nearer body wins.
      if (d < bestD || (d === 0 && bestD === 0 && depth < bestDepth)) {
        bestD = d;
        bestDepth = depth;
        best = {
          ref: { kind: b.moon ? 'moon' : 'planet', id: b.id },
          distPx: d,
          x: b.screenX,
          y: b.screenY,
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
    for (let i = this.range.start; i < this.range.end; i++) {
      const b = assets.bodies[i];
      if (!b.onScreen || this.hiddenBehindFamily(assets, i)) continue;
      const isFocus = i === this.focusIndex;
      if (isFocus && b.radiusPx > FOCUS_LABEL_MAX_PX) continue;
      const tier = isFocus
        ? LabelTier.focus
        : b.id === sel
          ? LabelTier.selected
          : b.moon
            ? LabelTier.moon
            : LabelTier.planet;
      const rank = Math.min(998, Math.round(Math.log10(b.body.radiusKm) * 150));
      const marker = b.id === sel && !isFocus ? 'ring' : b.radiusPx < 3 ? 'dot' : null;
      const sub = b.id === sel && !isFocus ? formatDistanceKm(b.rel.length()) : undefined;
      out.push(bodyLabel(labelAt(this.labelPool, slot++), b, tier * 1000 + rank, marker, sub));
    }
  }

  setQuality(q: Quality): void {
    this.ctx.fullVisuals.setQuality(q);
  }

  dispose(): void {
    this.release();
  }

  // ───────────────────────────────────────────── internals

  /** Advance the GPU bakes of the focus's and the destination's full visuals. */
  private prepareFull(anchor: FocusHandle, destination: FocusHandle | null): void {
    this.prepareOne(destination); // arrival first
    this.prepareOne(anchor);
  }

  private prepareOne(h: FocusHandle | null): void {
    if (!h?.body || !h.system) return;
    const v = this.ctx.fullVisuals.get(h.body, h.system);
    if (!v.ready) v.prepare(this.ctx.engine.renderer, PREPARE_BUDGET_MS);
  }

  /** True when body i's centre is behind the disc of a nearer member of the local group. */
  private hiddenBehindFamily(assets: SystemAssets, i: number): boolean {
    const b = assets.bodies[i];
    const depth = b.rel.lengthSq();
    for (let j = this.range.start; j < this.range.end; j++) {
      if (j === i) continue;
      const c = assets.bodies[j];
      if (!c.onScreen || c.rel.lengthSq() >= depth) continue;
      if (Math.hypot(b.screenX - c.screenX, b.screenY - c.screenY) < c.radiusPx) return true;
    }
    return false;
  }

  private buildOccluders(bodies: readonly BodyState[], start: number, end: number): void {
    const count = end - start;
    for (let k = 0; k < count; k++) {
      let e = this.occluderEntries[k];
      if (!e) {
        e = { positionKm: new Vector3(), radiusKm: 0 };
        this.occluderEntries[k] = e;
      }
      e.positionKm.copy(bodies[start + k].rel);
      e.radiusKm = bodies[start + k].body.radiusKm;
    }
    for (let k = 0; k < count; k++) {
      let list = this.occluderLists[k];
      if (!list) {
        list = [];
        this.occluderLists[k] = list;
      }
      list.length = 0;
      for (let j = 0; j < count; j++) if (j !== k) list.push(this.occluderEntries[j]);
    }
  }

  private pushInterval(n: number, b: BodyState): number {
    let it = this.intervals[n];
    if (!it) {
      it = { near: 0, far: 0 };
      this.intervals[n] = it;
    }
    const d = b.rel.length();
    const polar = b.body.radiusKm * (1 - b.body.oblateness);
    // Inside the atmosphere/ring extent the near plane must still sit in front of the surface.
    it.near = d > b.extentKm ? d - b.extentKm : Math.max((d - polar) * 0.5, 1e-3);
    it.far = d + b.extentKm;
    return n + 1;
  }

  /** Give the family back (the system layer re-claims it) and hide the full visual. */
  private release(): void {
    this.active = false;
    if (this.full && this.full.object.parent === this.scene) this.scene.remove(this.full.object);
    this.full = null;
    this.showingFull = false;
    const assets = this.assets;
    if (!assets) return;
    for (const b of assets.bodies) {
      if (b.owner === 'planet') b.owner = null;
    }
    this.assets = null;
  }
}
