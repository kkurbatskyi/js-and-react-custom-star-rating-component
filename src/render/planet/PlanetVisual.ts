/**
 * PlanetVisual — a world you can orbit: baked, lit, shaded surface + atmosphere, clouds and rings.
 *
 * Composition (all children of the root group, which carries `positionKm` and `orientation`):
 *   surface  — 'full' rocky worlds: `SurfaceBaker` (time-sliced GPU bake of albedo/relief cube maps) +
 *              `RockySurface`; gas/ice giants: `GiantSurface` (analytic flowing bands, no bake);
 *              'lite': `LiteSurface` (rocky) or `GiantSurface` in lite mode — no bake, ready at once.
 *   atmosphere, clouds — the sky specialist's factories, on full visuals only.
 *   rings    — the sky specialist's factory, on both.
 *
 * `prepare(renderer, budgetMs)` advances the bake and compiles the shaders asynchronously (no hitch on
 * arrival); `ready` turns true when the visual looks final. Until then the root group stays hidden, so
 * a half-baked surface is never drawn. See src/render/planet/surface/README.md.
 */
import {
  type BufferGeometry,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  type ShaderMaterial,
  type WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { BodyBase, StarSystem } from '../../core/types';
import type {
  IAtmosphereShell,
  ICloudLayer,
  IPlanetVisual,
  IRingVisual,
  PlanetDetail,
  PlanetUniforms,
  Quality,
  VisualFrame,
} from '../contracts';
import { BAKE_SIZE, deriveLook, type PlanetLook } from './appearance';
import { createAtmosphere } from './atmosphere';
import { createClouds } from './clouds';
import { createRings } from './rings';
import { SurfaceBaker } from './surface/bake';
import { GiantSurface } from './surface/GiantSurface';
import { LiteSurface } from './surface/LiteSurface';
import { RockySurface } from './surface/RockySurface';

/** What every surface implementation offers the composer. */
interface SurfaceLike {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  update(frame: VisualFrame, u: PlanetUniforms): void;
  dispose(): void;
}

export class PlanetVisual implements IPlanetVisual {
  readonly object = new Group();
  readonly body: BodyBase;
  readonly detail: PlanetDetail;
  /** The derived visual parameters (exposed for dev tools and tests). */
  readonly look: PlanetLook;
  private readonly surface: SurfaceLike;
  private readonly rocky: RockySurface | null = null;
  private readonly baker: SurfaceBaker | null = null;
  private readonly atmosphere: IAtmosphereShell | null = null;
  private readonly clouds: ICloudLayer | null = null;
  private readonly rings: IRingVisual | null = null;
  private baked: boolean;
  private compile: 'idle' | 'pending' | 'done' = 'idle';

  constructor(
    body: BodyBase,
    ctx: { system: StarSystem },
    quality: Quality,
    detail: PlanetDetail = 'full',
  ) {
    this.body = body;
    this.detail = detail;
    this.look = deriveLook(body, ctx.system);
    this.object.name = `PlanetVisual:${body.id}`;
    const full = detail === 'full';

    if (this.look.family === 'giant') {
      this.surface = new GiantSurface(body, this.look, quality, !full);
      this.baked = true;
    } else if (full) {
      const size = BAKE_SIZE[quality];
      this.baker = new SurfaceBaker(this.look, size);
      this.rocky = new RockySurface(body, this.look, quality, size);
      this.surface = this.rocky;
      this.baked = false;
    } else {
      this.surface = new LiteSurface(body, this.look);
      this.baked = true;
    }
    this.object.add(this.surface.mesh);
    if (full) {
      this.atmosphere = createAtmosphere(body, ctx.system, quality);
      this.clouds = createClouds(body, ctx.system, quality);
    }
    this.rings = createRings(body, ctx.system, quality);
    for (const part of [this.atmosphere, this.clouds, this.rings])
      if (part) this.object.add(part.object);
    this.object.visible = false;
    // Lite visuals are ready at once; their program compiles on first draw (see `prewarmPlanetPrograms`).
    if (!full) this.compile = 'done';
  }

  get ready(): boolean {
    return this.baked && this.compile === 'done';
  }

  /** 0..1 bake progress (1 when ready). */
  get progress(): number {
    return this.ready ? 1 : Math.min(0.99, this.baker?.progress ?? 0);
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
    if (this.ready) return true;
    if (this.compile === 'idle') {
      this.compile = 'pending';
      const scene = new Scene();
      // A proxy mesh (shared geometry/material) so the compile does not depend on where the real one lives.
      scene.add(new Mesh(this.surface.mesh.geometry, this.surface.mesh.material));
      const done = (): void => {
        this.compile = 'done';
      };
      renderer.compileAsync(scene, new PerspectiveCamera()).then(done, done);
    }
    if (!this.baked && this.baker?.step(renderer, budgetMs)) {
      const cubes = this.baker.result;
      if (cubes && this.rocky) {
        this.rocky.setBaked(cubes.albedo, cubes.relief);
        this.baked = true;
      }
    }
    return this.ready;
  }

  update(frame: VisualFrame, u: PlanetUniforms): void {
    this.object.position.copy(u.positionKm);
    this.object.quaternion.copy(u.orientation);
    this.object.visible = this.ready && u.intensity > 0.001;
    if (!this.object.visible) return;
    this.surface.update(frame, u);
    this.atmosphere?.update(frame, u);
    this.clouds?.update(frame, u);
    this.rings?.update(frame, u);
  }

  dispose(): void {
    this.baker?.dispose();
    this.surface.dispose();
    this.atmosphere?.dispose();
    this.clouds?.dispose();
    this.rings?.dispose();
  }
}
