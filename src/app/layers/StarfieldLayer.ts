/**
 * StarfieldLayer (light-years) — catalogue stars around the camera as points.
 *
 *  - Blocks come from `universe.queryBlocks` (magnitude-limited, time-sliced): re-queried every frame
 *    while cells are pending, otherwise only after the camera has moved QUERY_MOVE_LY.
 *  - `setBlocks(blocks, origin)` rebases float32 offsets on a float64 origin near the camera whenever
 *    the block set changes or the camera drifts REBASE_LY from the origin.
 *  - Inside a system the focus star's point fades out (hiddenFade over the outer 40 % of the system
 *    radius) while the system layer's StarVisual fades in — the shared photometry makes the two agree.
 *  - Names for labels are resolved lazily through `universe.getRecord` and cached.
 * Active within ~3 kly of the disk; from farther out the galaxy visual represents the stars.
 */
import { type PerspectiveCamera, Scene, Vector3 } from 'three';
import { smoothstep } from '../../core/math';
import type { StarBlock, StarId, Vec3Tuple } from '../../core/types';
import {
  type FrameInfo,
  type LabelSpec,
  LabelTier,
  type Layer,
  type LayerRenderSpec,
  type PickHit,
} from '../../engine/contracts';
import type { IStarfieldVisual, Quality, StarfieldOptions } from '../../render/contracts';
import { StarfieldVisual } from '../../render/starfield/StarfieldVisual';
import { isStarId } from '../../universe';
import type { Universe } from '../../universe/contracts';
import {
  createVisualFrame,
  type LayerContext,
  projectRelative,
  type ScreenPoint,
  syncVisualFrame,
} from './context';

const MAGNITUDE_LIMIT = 6.8;
const QUERY_BUDGET_MS = 3;
const QUERY_MOVE_LY = 2;
const REBASE_LY = 50;
/** Fully visible within this distance of the disk, gone beyond FADE_OUT_LY. */
const FADE_IN_LY = 1500;
const FADE_OUT_LY = 3000;
const ANCHOR_REFRESH_FRAMES = 6;
const MAX_NAME_CACHE = 2000;

interface StarInfo {
  name: string;
  sub: string;
  posLy: Vec3Tuple;
}

export class StarfieldLayer implements Layer {
  readonly id = 'starfield';
  readonly scene = new Scene();
  private visual: IStarfieldVisual;
  private universe: Universe;
  private readonly ctx: LayerContext;
  private blocks: readonly StarBlock[] = [];
  private readonly origin = new Vector3();
  private hasOrigin = false;
  private readonly lastQuery = new Vector3();
  private queried = false;
  private pending = 0;
  private readonly options: StarfieldOptions = {
    cameraLy: new Vector3(),
    hiddenStarId: null,
    hiddenFade: 0,
    selectedId: null,
    hoveredId: null,
    exposure: 1,
  };
  private readonly vframe;
  private readonly slice: LayerRenderSpec = { near: 1e-6, far: 3e5 };
  private readonly slices = [this.slice];
  private readonly infos = new Map<StarId, StarInfo | null>();
  private anchorIds: StarId[] = [];
  private frameNo = 0;
  private camera: PerspectiveCamera | null = null;
  private width = 1;
  private height = 1;
  private level: FrameInfo['level'] = 'galaxy';
  private destinationId: StarId | null = null;
  private readonly labelPool: LabelSpec[] = [];
  private readonly rel = new Vector3();
  private readonly scratch = new Vector3();
  private readonly screen: ScreenPoint = { x: 0, y: 0, depth: 0 };

  constructor(ctx: LayerContext, quality: Quality) {
    this.ctx = ctx;
    this.universe = ctx.universe();
    this.visual = new StarfieldVisual(quality);
    this.scene.add(this.visual.object);
    this.vframe = createVisualFrame(ctx.engine.renderer, quality);
  }

  update(frame: FrameInfo, camera: PerspectiveCamera): LayerRenderSpec[] | null {
    const universe = this.ctx.universe();
    if (universe !== this.universe) this.rebuild(universe, frame.quality);
    const g = frame.cam.galacticLy;
    const radius = universe.galaxy.params.radiusLy;
    const fromDisk = Math.max(Math.abs(g.y), Math.hypot(g.x, g.z) - radius, 0);
    const exposure = 1 - smoothstep(FADE_IN_LY, FADE_OUT_LY, fromDisk);
    this.camera = null;
    if (exposure <= 0.001) {
      this.visual.object.visible = false;
      return null;
    }
    this.visual.object.visible = true;
    this.query(g);

    const o = this.options;
    o.cameraLy.copy(g);
    o.exposure = exposure;
    const sys = this.ctx.engine.systemHandle;
    const systemKm = frame.cam.systemKm;
    if (sys?.system && systemKm) {
      const r = sys.system.radiusKm;
      o.hiddenStarId = sys.starId;
      o.hiddenFade = smoothstep(r, 0.6 * r, systemKm.length());
    } else {
      o.hiddenStarId = null;
      o.hiddenFade = 0;
    }
    o.selectedId = starOrNull(this.ctx.selectedId());
    o.hoveredId = starOrNull(this.ctx.hoveredId());

    camera.near = this.slice.near;
    camera.far = this.slice.far;
    camera.updateProjectionMatrix();
    this.visual.update(syncVisualFrame(this.vframe, frame, camera), o);

    this.camera = camera;
    this.width = frame.width;
    this.height = frame.height;
    this.level = frame.level;
    const dest = this.ctx.engine.rig.destination;
    this.destinationId = dest?.kind === 'star' ? dest.starId : null;
    if (this.frameNo++ % ANCHOR_REFRESH_FRAMES === 0 && this.ctx.labelsEnabled()) {
      // Background stars are labelled in the galaxy view, sparsely inside a system, not near a planet.
      const max = frame.level === 'galaxy' ? 14 : frame.level === 'system' ? 4 : 0;
      this.anchorIds = this.visual.anchors(max).map((a) => a.id);
    }
    return this.slices;
  }

  pick(x: number, y: number, maxDistPx: number): PickHit | null {
    if (!this.camera) return null;
    const hit = this.visual.pick(x, y, maxDistPx);
    if (!hit || hit.id === this.options.hiddenStarId) return null;
    const p = this.project(hit.id);
    return {
      ref: { kind: 'star', id: hit.id },
      distPx: hit.distPx,
      x: p ? p.x : x,
      y: p ? p.y : y,
    };
  }

  labels(out: LabelSpec[]): void {
    if (!this.camera || !this.ctx.labelsEnabled()) return;
    let slot = 0;
    const hidden = this.options.hiddenFade > 0.5 ? this.options.hiddenStarId : null;
    const selected = this.options.selectedId;
    for (let i = 0; i < this.anchorIds.length; i++) {
      const id = this.anchorIds[i];
      if (id === hidden || id === selected || id === this.destinationId) continue;
      const rank = Math.max(0, 999 - i * 40);
      slot = this.pushLabel(out, slot, id, LabelTier.star * 1000 + rank, null);
    }
    if (selected && selected !== hidden) {
      slot = this.pushLabel(out, slot, selected, LabelTier.selected * 1000 + 500, 'ring');
    }
    if (this.destinationId && this.destinationId !== hidden && this.destinationId !== selected) {
      this.pushLabel(out, slot, this.destinationId, LabelTier.focus * 1000 + 500, 'ring');
    }
  }

  setQuality(q: Quality): void {
    this.visual.setQuality?.(q);
  }

  dispose(): void {
    this.scene.remove(this.visual.object);
    this.visual.dispose();
  }

  // ───────────────────────────────────────────── internals

  private query(g: Vector3): void {
    const moved = !this.queried || g.distanceTo(this.lastQuery) > QUERY_MOVE_LY;
    if (moved || this.pending > 0) {
      const res = this.universe.queryBlocks({
        observerLy: [g.x, g.y, g.z],
        magnitudeLimit: MAGNITUDE_LIMIT,
        budgetMs: QUERY_BUDGET_MS,
      });
      this.queried = true;
      this.lastQuery.copy(g);
      this.pending = res.pending;
      if (!sameBlocks(res.blocks, this.blocks)) {
        this.blocks = res.blocks;
        this.rebase(g);
        return;
      }
    }
    if (!this.hasOrigin || g.distanceTo(this.origin) > REBASE_LY) this.rebase(g);
  }

  private rebase(g: Vector3): void {
    this.origin.copy(g);
    this.hasOrigin = true;
    this.visual.setBlocks(this.blocks, this.origin);
  }

  private info(id: StarId): StarInfo | null {
    let info = this.infos.get(id);
    if (info === undefined) {
      if (this.infos.size > MAX_NAME_CACHE) this.infos.clear();
      const rec = this.universe.getRecord(id);
      info = rec ? { name: rec.name, sub: rec.spectralType, posLy: rec.posLy } : null;
      this.infos.set(id, info);
    }
    return info;
  }

  private project(id: StarId): ScreenPoint | null {
    const info = this.info(id);
    if (!info || !this.camera) return null;
    const g = this.options.cameraLy;
    this.rel.set(info.posLy[0] - g.x, info.posLy[1] - g.y, info.posLy[2] - g.z);
    return projectRelative(
      this.rel,
      this.camera,
      this.width,
      this.height,
      this.scratch,
      this.screen,
    )
      ? this.screen
      : null;
  }

  private pushLabel(
    out: LabelSpec[],
    slot: number,
    id: StarId,
    priority: number,
    marker: LabelSpec['marker'],
  ): number {
    const info = this.info(id);
    const p = info ? this.project(id) : null;
    if (!info || !p) return slot;
    if (p.x < -40 || p.y < -40 || p.x > this.width + 40 || p.y > this.height + 40) return slot;
    let spec = this.labelPool[slot];
    if (!spec) {
      spec = { key: id, text: '', x: 0, y: 0, priority: 0 };
      this.labelPool[slot] = spec;
    }
    spec.key = id;
    spec.ref = { kind: 'star', id };
    spec.text = info.name;
    spec.sub = this.level === 'galaxy' || marker ? info.sub : undefined;
    spec.x = p.x;
    spec.y = p.y;
    spec.priority = priority;
    spec.marker = marker;
    spec.color = marker ? 'var(--sd-accent, #d9b36c)' : undefined;
    out.push(spec);
    return slot + 1;
  }

  private rebuild(universe: Universe, quality: Quality): void {
    this.scene.remove(this.visual.object);
    this.visual.dispose();
    this.universe = universe;
    this.visual = new StarfieldVisual(quality);
    this.scene.add(this.visual.object);
    this.blocks = [];
    this.queried = false;
    this.hasOrigin = false;
    this.pending = 0;
    this.infos.clear();
    this.anchorIds = [];
  }
}

function starOrNull(id: string | null): StarId | null {
  return id !== null && isStarId(id) ? id : null;
}

function sameBlocks(a: readonly StarBlock[], b: readonly StarBlock[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
