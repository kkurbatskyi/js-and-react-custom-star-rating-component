/**
 * PlanetVisual — a world you can orbit: baked, lit, shaded surface + atmosphere, clouds and rings.
 *
 * Composition (all children of the root group, which carries `positionKm` and `orientation`):
 *   surface  — 'full' rocky worlds: `SurfaceBaker` (time-sliced GPU bake of terrain/albedo/relief cube
 *              maps) + `RockySurface`; gas/ice giants: analytic flowing bands.  'lite': a cheap analytic
 *              shader, no bake, `ready` from the start.
 *   atmosphere, clouds, rings — the sky specialist's factories (full detail; rings also on lite).
 *
 * See src/render/planet/surface/README.md for the design.
 */
import { Group, type WebGLCubeRenderTarget, type WebGLRenderer } from 'three';
import type { BodyBase, StarSystem } from '../../core/types';
import {
  type IAtmosphereShell,
  type ICloudLayer,
  type IPlanetVisual,
  type IRingVisual,
  type PlanetDetail,
  type PlanetUniforms,
  type Quality,
  type VisualFrame,
} from '../contracts';
import { BAKE_SIZE, type PlanetLook, deriveLook } from './appearance';
import { createAtmosphere } from './atmosphere';
import { createClouds } from './clouds';
import { createRings } from './rings';
import { SurfaceBaker } from './surface/bake';
import { LegacyPlanetVisual } from './surface/legacy';
import { RockySurface } from './surface/RockySurface';

export class PlanetVisual implements IPlanetVisual {
  readonly object: Group;
  readonly body: BodyBase;
  readonly detail: PlanetDetail;
  /** The derived visual parameters (exposed for dev tools and tests). */
  readonly look: PlanetLook;
  private readonly legacy: LegacyPlanetVisual | null = null;
  private readonly baker: SurfaceBaker | null = null;
  private readonly rocky: RockySurface | null = null;
  private readonly atmosphere: IAtmosphereShell | null = null;
  private readonly clouds: ICloudLayer | null = null;
  private readonly rings: IRingVisual | null = null;
  private baked = false;

  constructor(
    body: BodyBase,
    ctx: { system: StarSystem },
    quality: Quality,
    detail: PlanetDetail = 'full',
  ) {
    this.body = body;
    this.detail = detail;
    this.look = deriveLook(body, ctx.system);

    if (this.look.family === 'rocky' && detail === 'full') {
      this.object = new Group();
      this.object.name = `PlanetVisual:${body.id}`;
      const size = BAKE_SIZE[quality];
      this.baker = new SurfaceBaker(this.look, size);
      this.rocky = new RockySurface(body, this.look, quality, size);
      this.object.add(this.rocky.mesh);
      this.atmosphere = createAtmosphere(body, ctx.system, quality);
      this.clouds = createClouds(body, ctx.system, quality);
      this.rings = createRings(body, ctx.system, quality);
      for (const part of [this.atmosphere, this.clouds, this.rings]) {
        if (part) this.object.add(part.object);
      }
    } else {
      this.legacy = new LegacyPlanetVisual(body, ctx, quality, detail);
      this.object = this.legacy.object;
    }
  }

  get ready(): boolean {
    return this.legacy ? this.legacy.ready : this.baked;
  }

  /** 0..1 bake progress (1 when ready). */
  get progress(): number {
    return this.legacy ? 1 : (this.baker?.progress ?? 1);
  }

  /** The baked cube maps (dev tools: coverage statistics, inspection), or null before `ready`. */
  bakedCubes(): { albedo: WebGLCubeRenderTarget; relief: WebGLCubeRenderTarget } | null {
    return this.baker?.result ?? null;
  }

  /** Debug view of the rocky surface: 0 shaded, 1 albedo, 2 normals, 3 height. */
  setDebug(mode: number): void {
    this.rocky?.setDebug(mode);
  }

  prepare(renderer: WebGLRenderer, budgetMs: number): boolean {
    if (this.legacy) return this.legacy.prepare(renderer, budgetMs);
    if (this.baked) return true;
    if (this.baker?.step(renderer, budgetMs)) {
      const cubes = this.baker.result;
      if (cubes && this.rocky) {
        this.rocky.setBaked(cubes.albedo, cubes.relief);
        this.baked = true;
      }
    }
    return this.baked;
  }

  update(frame: VisualFrame, u: PlanetUniforms): void {
    if (this.legacy) {
      this.legacy.update(frame, u);
      return;
    }
    this.object.position.copy(u.positionKm);
    this.object.quaternion.copy(u.orientation);
    this.object.visible = this.baked && u.intensity > 0.001;
    if (!this.object.visible) return;
    this.rocky?.update(frame, u);
    this.atmosphere?.update(frame, u);
    this.clouds?.update(frame, u);
    this.rings?.update(frame, u);
  }

  dispose(): void {
    this.legacy?.dispose();
    this.baker?.dispose();
    this.rocky?.dispose();
    this.atmosphere?.dispose();
    this.clouds?.dispose();
    this.rings?.dispose();
  }
}
