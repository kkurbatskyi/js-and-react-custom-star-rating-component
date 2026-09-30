/**
 * GalaxyLayer (light-years) — the GalaxyVisual: the whole spiral from outside, the luminous band of
 * the Milky-Way-like sky from inside the disk. Always active: it is the sky.
 */
import { type PerspectiveCamera, Scene, Vector3 } from 'three';
import { smoothstep } from '../../core/math';
import type { FrameInfo, LabelSpec, Layer, LayerRenderSpec } from '../../engine/contracts';
import { LabelTier } from '../../engine/contracts';
import type {
  GalaxyVisualOptions,
  IGalaxyVisual,
  Quality,
  VisualFrame,
} from '../../render/contracts';
import { GalaxyVisual } from '../../render/galaxy/GalaxyVisual';
import type { Universe } from '../../universe/contracts';
import { setStarRef } from './bodies';
import {
  createVisualFrame,
  type LayerContext,
  projectRelative,
  type ScreenPoint,
  syncVisualFrame,
} from './context';

/** Galaxy particles closer than this fade out; the starfield resolves individual stars there. */
const NEAR_FADE_LY = 1200;
/** Exposure eases towards its target at this rate, 1/s (≈95 % in one second, in log space). */
const EXPOSURE_LAMBDA = 3;
/** Galaxy-scale labels (core, home) only from at least this far away, ly. */
const FEATURE_LABEL_MIN_LY = 4000;

export class GalaxyLayer implements Layer {
  readonly id = 'galaxy';
  readonly scene = new Scene();
  private visual: IGalaxyVisual;
  private universe: Universe;
  private readonly ctx: LayerContext;
  private readonly options: GalaxyVisualOptions = {
    cameraLy: new Vector3(),
    nearFadeLy: NEAR_FADE_LY,
    intensity: 1,
  };
  private readonly vframe: VisualFrame;
  private readonly slice: LayerRenderSpec = { near: 1, far: 1e6 };
  private readonly slices = [this.slice];
  // Labels: the galactic core and "home".
  private readonly labelSpecs: LabelSpec[] = [];
  private readonly rel = new Vector3();
  private readonly scratch = new Vector3();
  private readonly screen: ScreenPoint = { x: 0, y: 0, depth: 0 };
  private camera: PerspectiveCamera | null = null;
  /** ln(scene exposure), eased; NaN until the first frame (snaps). */
  private logExposure = Number.NaN;
  private cutSerial = -1;
  private level: FrameInfo['level'] = 'galaxy';
  private width = 1;
  private height = 1;

  constructor(ctx: LayerContext, quality: Quality) {
    this.ctx = ctx;
    this.universe = ctx.universe();
    this.visual = new GalaxyVisual(this.universe.galaxy, quality);
    this.scene.add(this.visual.object);
    this.vframe = createVisualFrame(ctx.engine.renderer, quality);
  }

  update(frame: FrameInfo, camera: PerspectiveCamera): LayerRenderSpec[] {
    const universe = this.ctx.universe();
    if (universe !== this.universe) this.rebuild(universe, frame.quality);
    const g = frame.cam.galacticLy;
    this.options.cameraLy.copy(g);
    const radius = this.universe.galaxy.params.radiusLy;
    this.slice.near = 0.3 * NEAR_FADE_LY;
    this.slice.far = g.length() + 2 * radius;
    camera.near = this.slice.near;
    camera.far = this.slice.far;
    camera.updateProjectionMatrix();

    this.visual.update(syncVisualFrame(this.vframe, frame, camera), this.options);
    this.updateExposure(frame);

    this.camera = camera;
    this.level = frame.level;
    this.width = frame.width;
    this.height = frame.height;
    return this.slices;
  }

  labels(out: LabelSpec[]): void {
    // Galaxy-scale features belong to the galaxy view; inside a system they only clutter the sky.
    if (!this.camera || this.level !== 'galaxy' || !this.ctx.labelsEnabled()) return;
    const u = this.universe;
    const slot = this.pushLabel(
      out,
      0,
      'core',
      'Galactic core',
      u.galaxy.params.name,
      [0, 0, 0],
      999,
    );
    const home = u.getRecord(u.homeStarId());
    if (home) this.pushLabel(out, slot, home.id, home.name, 'You are here', home.posLy, 998);
  }

  /**
   * Galaxy-scale features are labelled only from afar (> FEATURE_LABEL_MIN_LY): up close the
   * starfield and system layers label the same objects themselves.
   */
  private pushLabel(
    out: LabelSpec[],
    slot: number,
    key: string,
    text: string,
    sub: string,
    posLy: readonly [number, number, number],
    rank: number,
  ): number {
    const g = this.options.cameraLy;
    this.rel.set(posLy[0] - g.x, posLy[1] - g.y, posLy[2] - g.z);
    if (this.rel.length() < FEATURE_LABEL_MIN_LY) return slot;
    if (
      !projectRelative(
        this.rel,
        this.camera as PerspectiveCamera,
        this.width,
        this.height,
        this.scratch,
        this.screen,
      )
    )
      return slot;
    const isHome = key !== 'core';
    let spec = this.labelSpecs[slot];
    if (!spec) {
      spec = { key, text, x: 0, y: 0, priority: 0 };
      this.labelSpecs[slot] = spec;
    }
    spec.key = `galaxy:${key}`;
    spec.text = text;
    spec.sub = sub;
    spec.x = this.screen.x;
    spec.y = this.screen.y;
    spec.priority = LabelTier.galaxyFeature * 1000 + rank;
    spec.marker = isHome ? 'ring' : null;
    spec.color = isHome ? 'var(--sd-accent, #d9b36c)' : undefined;
    if (isHome) setStarRef(spec, key);
    else spec.ref = undefined;
    out.push(spec);
    return slot + 1;
  }

  /**
   * Scene exposure: the galaxy suggests one per vantage point (≈2 inside the disk, ≈0.45 a few kly
   * above it), but star and planet visuals are calibrated for 1 — so inside a system the target
   * blends (geometrically) to 1 over the outer 15 % of its radius (the composed system view sits at
   * 0.8 R, fully calibrated). Eased in log space (~1 s, so boundary crossings in flight never
   * flicker); snapped on camera cuts and while the clock is frozen.
   */
  private updateExposure(frame: FrameInfo): void {
    const engine = this.ctx.engine;
    const hint = this.visual.exposureHint?.(this.options.cameraLy) ?? 1;
    const sys = engine.systemHandle;
    const systemKm = frame.cam.systemKm;
    const r = sys?.system?.radiusKm ?? 0;
    const inSystem = r > 0 && systemKm ? smoothstep(r, 0.85 * r, systemKm.length()) : 0;
    const target = Math.log(Math.max(hint, 1e-3)) * (1 - inSystem);
    const cut = engine.rig.cutSerial !== this.cutSerial;
    this.cutSerial = engine.rig.cutSerial;
    if (Number.isNaN(this.logExposure) || cut || frame.dtSec <= 0) this.logExposure = target;
    else
      this.logExposure +=
        (target - this.logExposure) * (1 - Math.exp(-EXPOSURE_LAMBDA * frame.dtSec));
    engine.exposure = Math.exp(this.logExposure);
  }

  setQuality(q: Quality): void {
    this.visual.setQuality?.(q);
  }

  private rebuild(universe: Universe, quality: Quality): void {
    this.scene.remove(this.visual.object);
    this.visual.dispose();
    this.universe = universe;
    this.visual = new GalaxyVisual(universe.galaxy, quality);
    this.scene.add(this.visual.object);
  }

  dispose(): void {
    this.scene.remove(this.visual.object);
    this.visual.dispose();
  }
}
