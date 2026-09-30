/**
 * PlanetVisual — a world you can orbit: baked, lit, shaded surface + atmosphere, clouds and rings.
 *
 * Composition (all children of the root group, which carries `positionKm` and `orientation`):
 *   surface  — rocky worlds: `SurfaceBaker` (time-sliced GPU bake of albedo/relief cube maps) +
 *              `RockySurface`; gas/ice giants: `GiantSurface` (analytic flowing bands, no bake).
 *   atmosphere, clouds — the sky specialist's factories, on full visuals only.
 *   rings    — the sky specialist's factory, on both.
 *
 * 'full' vs 'lite'. A lite visual is the same world at low fidelity, built from the same seed, palette,
 * terrain functions and lighting model, so the engine's lite -> full swap (at ~28 px radius) changes
 * detail, not look:
 *   rocky — the same bake at 64^2 per face (started lazily, a few per frame, from the first `update`) and
 *           the same shader, with the cloud shell and atmosphere rim folded into the surface;
 *   giant — the same analytic shader (octave cap only).
 * `ready` is true from the start for lite; a lite visual stays hidden for its first few frames while its
 * shaders compile and its tiny bake runs. A full rocky visual is `ready` once the time-sliced bake, driven
 * by `prepare(renderer, budgetMs)`, has finished and its shaders are compiled.
 *
 * See src/render/planet/surface/README.md for the design.
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
import { RockySurface } from './surface/RockySurface';

/** Cube-face resolution of the tiny bake behind 'lite' rocky visuals. */
export const LITE_BAKE_SIZE = 64;
/**
 * At most this many lite visuals advance their setup per ~frame (spreads 30 bodies over frames). The
 * window is wall-clock, not `renderer.info.render.frame`: the bake's own render calls bump that counter.
 */
const LITE_STARTS_PER_WINDOW = 2;
const LITE_WINDOW_MS = 12;
const LITE_STEP_BUDGET_MS = 6;

let liteWindowStart = Number.NEGATIVE_INFINITY;
let liteStarted = 0;

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
    } else {
      const size = full ? BAKE_SIZE[quality] : LITE_BAKE_SIZE;
      this.baker = new SurfaceBaker(this.look, size, !full);
      this.rocky = new RockySurface(body, this.look, quality, size, !full);
      this.surface = this.rocky;
      this.baked = false;
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
  }

  get ready(): boolean {
    return this.detail === 'lite' || this.settled;
  }

  /** 0..1 setup progress (bake + shader compilation); 1 when the surface can be drawn. */
  get progress(): number {
    if (this.settled) return 1;
    return Math.min(
      0.99,
      (this.baker?.progress ?? 0.5) * 0.95 + (this.compile === 'done' ? 0.05 : 0),
    );
  }

  /** True once the surface can actually be drawn (lite visuals report `ready` at once but draw a few frames later). */
  get drawable(): boolean {
    return this.settled;
  }

  /** The baked cube maps (dev tools: coverage statistics, inspection), or null before they are done. */
  bakedCubes(): { albedo: WebGLCubeRenderTarget; relief: WebGLCubeRenderTarget } | null {
    return this.baker?.result ?? null;
  }

  /** Debug view of the rocky surface: 0 shaded, 1 albedo, 2 normals, 3 height, 4 shadow, 5 diffuse. */
  setDebug(mode: number): void {
    this.rocky?.setDebug(mode);
  }

  /**
   * Compile this visual's shader programs without drawing anything (see `prewarmPlanetPrograms`).
   * Resolves when the surface program (and, for rocky worlds, the bake programs) are ready.
   */
  async warm(renderer: WebGLRenderer): Promise<void> {
    await Promise.all([this.compileSurface(renderer), this.baker?.warm(renderer)]);
  }

  prepare(renderer: WebGLRenderer, budgetMs: number): boolean {
    if (this.ready) return true;
    this.advance(renderer, budgetMs);
    return this.ready;
  }

  update(frame: VisualFrame, u: PlanetUniforms): void {
    if (this.detail === 'lite' && !this.settled) this.advanceLite(frame.renderer);
    this.object.position.copy(u.positionKm);
    this.object.quaternion.copy(u.orientation);
    this.object.visible = this.settled && u.intensity > 0.001;
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

  // ───────────────────────────────────────────────────────────── setup

  /** Bake finished and shader compiled: the surface can be drawn. */
  private get settled(): boolean {
    return this.baked && this.compile === 'done';
  }

  private advanceLite(renderer: WebGLRenderer): void {
    const now = performance.now();
    if (now - liteWindowStart > LITE_WINDOW_MS) {
      liteWindowStart = now;
      liteStarted = 0;
    }
    if (liteStarted >= LITE_STARTS_PER_WINDOW) return;
    liteStarted++;
    this.advance(renderer, LITE_STEP_BUDGET_MS);
  }

  private advance(renderer: WebGLRenderer, budgetMs: number): void {
    if (this.compile === 'idle') void this.compileSurface(renderer);
    if (!this.baked && this.baker?.step(renderer, budgetMs)) {
      const cubes = this.baker.result;
      if (cubes && this.rocky) {
        this.rocky.setBaked(cubes.albedo, cubes.relief);
        this.baked = true;
      }
    }
  }

  /** Compile the surface program through a proxy mesh (shared geometry/material), so it never depends on scene placement. */
  private compileSurface(renderer: WebGLRenderer): Promise<void> {
    if (this.compile === 'done') return Promise.resolve();
    this.compile = 'pending';
    const scene = new Scene();
    scene.add(new Mesh(this.surface.mesh.geometry, this.surface.mesh.material));
    const done = (): void => {
      this.compile = 'done';
    };
    return renderer.compileAsync(scene, new PerspectiveCamera()).then(done, done);
  }
}

/**
 * Compile every planet shader program up front (run it at boot, like the engine's other pre-warms) so the
 * first arrival at any world never stalls on compilation. Pass one rocky and one giant sample body (programs
 * are shared by all bodies of a family); keep the returned handle for the lifetime of the renderer — three.js
 * frees a program when its last material is disposed — and call `release()` on shutdown.
 */
export async function prewarmPlanetPrograms(
  renderer: WebGLRenderer,
  samples: readonly { body: BodyBase; system: StarSystem }[],
  quality: Quality,
): Promise<{ release(): void }> {
  const visuals = samples.map(
    (s) => new PlanetVisual(s.body, { system: s.system }, quality, 'lite'),
  );
  await Promise.all(visuals.map((v) => v.warm(renderer)));
  return {
    release(): void {
      for (const v of visuals) v.dispose();
    },
  };
}
