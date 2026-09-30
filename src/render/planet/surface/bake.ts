/**
 * SurfaceBaker — time-sliced GPU bake of a rocky world's surface into two cube maps.
 *
 *   pass 1  terrain   -> heightCube  RGBA16F (temporary): height, moisture, special, aux
 *   pass 2  albedo    -> albedoCube  sRGB8+A : albedo, packed (emissive, ice)      [mip-mapped]
 *   pass 3  relief    -> reliefCube  RGBA8   : tangent slope vector, height        [mip-mapped]
 *
 * Each pass renders one cube face at a time as strips of rows (viewport + scissor). The strip height
 * adapts to a running estimate of the pass's cost, measured with `gl.finish()` so it includes the GPU's
 * work: `step(renderer, budgetMs)` stays within the budget (plus at most one strip) on any GPU.
 * Shader programs are compiled up front with `compileAsync` (KHR_parallel_shader_compile), so the first
 * strip never stalls on compilation. The temporary height cube is disposed as soon as pass 3 is done.
 *
 * State the baker touches on the shared renderer (render target, autoClear) is restored after every step.
 */
import {
  ClampToEdgeWrapping,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import { common } from '../../shaders/common.glsl';
import { noise } from '../../shaders/noise.glsl';
import { EMISSIVE_ID, type RockyLook, type RockyStyle, STYLE_ID } from '../appearance';
import { bakeAlbedoGlsl } from './glsl/bakeAlbedo.glsl';
import { bakeReliefGlsl } from './glsl/bakeRelief.glsl';
import { bakeTerrainGlsl } from './glsl/bakeTerrain.glsl';
import { cubeGlsl } from './glsl/cube.glsl';
import { gradientGlsl } from './glsl/gradient.glsl';

/** Strength of the baked cavity occlusion per style (see gradient.glsl.ts). */
const CAVITY_AO: Readonly<Record<RockyStyle, number>> = {
  biome: 0.25,
  regolith: 0.7,
  desert: 0.4,
  icy: 0.3,
  volcanic: 0.4,
  dwarf: 0.5,
};

const FULLSCREEN_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const terrainFrag = `${common}\n${noise}\n${cubeGlsl}\n${bakeTerrainGlsl}`;
const albedoFrag = `${common}\n${noise}\n${cubeGlsl}\n${gradientGlsl}\n${bakeAlbedoGlsl}`;
const reliefFrag = `${common}\n${noise}\n${cubeGlsl}\n${gradientGlsl}\n${bakeReliefGlsl}`;

type Pass = 'terrain' | 'albedo' | 'relief';
type Phase = 'init' | 'compile' | Pass | 'albedoMips' | 'reliefMips' | 'done';

/** Rows rendered by the first strip of a pass, before any cost measurement exists. */
const INITIAL_ROWS = 4;
/** Hard cap on the pixels of one strip, whatever the cost estimate says (guards against a lying clock). */
const MAX_JOB_PIXELS = 131_072;
/** A strip may grow by at most this factor over the previous one, so a low estimate cannot overshoot. */
const MAX_GROWTH = 2;

export interface BakeResult {
  albedo: WebGLCubeRenderTarget;
  relief: WebGLCubeRenderTarget;
}

/** Everything the bake shaders need from a `RockyLook`, as three uniform maps. */
function terrainUniforms(look: RockyLook, size: number): Record<string, { value: unknown }> {
  const t = look.terrain;
  return {
    uFace: { value: 0 },
    uSize: { value: size },
    uSeed: { value: look.seed },
    uContScale: { value: t.contScale },
    uWarp: { value: t.warp },
    uSea: { value: t.sea },
    uContAmp: { value: t.contAmp },
    uMountains: { value: t.mountains },
    uHills: { value: t.hills },
    uCraters: { value: t.craters },
    uCraterSize: { value: t.craterSize },
    uMare: { value: t.mare },
    uRifts: { value: t.rifts },
    uVolcanoes: { value: t.volcanoes },
    uLineae: { value: t.lineae },
    uChaos: { value: t.chaos },
    uRelief: { value: t.relief },
    uEyeball: { value: t.eyeball },
    uRays: { value: look.style === 'regolith' ? 0.35 : look.style === 'dwarf' ? 0.2 : 0 },
    uStyle: { value: STYLE_ID[look.style] },
  };
}

export class SurfaceBaker {
  readonly size: number;
  private phase: Phase = 'init';
  private face = 0;
  private row = 0;
  private readonly look: RockyLook;
  private heightRT: WebGLCubeRenderTarget | null = null;
  private albedoRT: WebGLCubeRenderTarget | null = null;
  private reliefRT: WebGLCubeRenderTarget | null = null;
  private scene: Scene | null = null;
  private camera: OrthographicCamera | null = null;
  private readonly meshes = new Map<Pass, Mesh<PlaneGeometry, ShaderMaterial>>();
  private geometry: PlaneGeometry | null = null;
  private lastRows = INITIAL_ROWS;
  private compileDone = false;
  private compileStarted = false;
  /** Estimated milliseconds per row of work, per pass (exponential moving average), and the fixed sync cost. */
  private readonly rowMs: Record<Pass, number> = { terrain: 0, albedo: 0, relief: 0 };
  private fixedMs = -1;
  private readonly floatProbe = new Float32Array(4);
  private readonly byteProbe = new Uint8Array(4);
  private disposed = false;

  constructor(look: RockyLook, size: number) {
    this.look = look;
    this.size = size;
  }

  /** 0..1 progress (for dev UIs). */
  get progress(): number {
    const order: Phase[] = [
      'init',
      'compile',
      'terrain',
      'albedo',
      'albedoMips',
      'relief',
      'reliefMips',
      'done',
    ];
    const weights = [0, 0.05, 0.45, 0.2, 0.02, 0.06, 0.02, 0];
    let p = 0;
    const idx = order.indexOf(this.phase);
    for (let i = 0; i < idx; i++) p += weights[i] ?? 0;
    const w = weights[idx] ?? 0;
    if (this.phase === 'terrain' || this.phase === 'albedo' || this.phase === 'relief') {
      p += w * ((this.face + this.row / this.size) / 6);
    }
    return this.phase === 'done' ? 1 : Math.min(1, p);
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  /** The finished cubes (only after `done`). */
  get result(): BakeResult | null {
    return this.phase === 'done' && this.albedoRT && this.reliefRT
      ? { albedo: this.albedoRT, relief: this.reliefRT }
      : null;
  }

  /**
   * Advance the bake by at most ~budgetMs (always performs at least one small unit of work).
   * Returns true when finished.
   */
  step(renderer: WebGLRenderer, budgetMs: number): boolean {
    if (this.disposed || this.done) return this.done;
    const start = performance.now();
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      if (this.phase === 'init') this.init(renderer);
      if (this.phase === 'compile') {
        this.ensureCompile(renderer);
        return false;
      }
      do {
        this.runUnit(renderer, budgetMs - (performance.now() - start));
      } while (!this.done && performance.now() - start < budgetMs);
    } finally {
      renderer.setRenderTarget(prevTarget, prevFace, prevMip);
      renderer.autoClear = prevAutoClear;
    }
    return this.done;
  }

  /** Dispose everything, including the finished cubes. */
  dispose(): void {
    this.disposed = true;
    this.freeTransient();
    this.albedoRT?.dispose();
    this.reliefRT?.dispose();
    this.albedoRT = this.reliefRT = null;
  }

  /** Free what only the bake needs: temporary terrain cube, bake materials, quad geometry. */
  private freeTransient(): void {
    this.heightRT?.dispose();
    this.heightRT = null;
    for (const m of this.meshes.values()) m.material.dispose();
    this.meshes.clear();
    this.geometry?.dispose();
    this.geometry = null;
    this.scene?.clear();
  }

  // ───────────────────────────────────────────────────────────── setup

  private init(renderer: WebGLRenderer): void {
    const n = this.size;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.heightRT = new WebGLCubeRenderTarget(n, {
      format: RGBAFormat,
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    this.albedoRT = new WebGLCubeRenderTarget(n, {
      format: RGBAFormat,
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      anisotropy: aniso,
    });
    this.reliefRT = new WebGLCubeRenderTarget(n, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      anisotropy: aniso,
    });
    for (const rt of [this.heightRT, this.albedoRT, this.reliefRT]) {
      rt.texture.wrapS = rt.texture.wrapT = ClampToEdgeWrapping;
      rt.scissorTest = true;
    }
    this.geometry = new PlaneGeometry(2, 2);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new Scene();
    this.camera.updateMatrixWorld(true);

    const look = this.look;
    const c = look.colors;
    const lut = [...look.climate.lut];
    while (lut.length < 17) lut.push(lut[lut.length - 1] ?? 288);
    const make = (
      fragmentShader: string,
      uniforms: Record<string, { value: unknown }>,
    ): ShaderMaterial =>
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader,
        uniforms,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });

    const terrain = make(terrainFrag, terrainUniforms(look, n));
    const albedo = make(albedoFrag, {
      uFace: { value: 0 },
      uSize: { value: n },
      uHeightTex: { value: this.heightRT.texture },
      uSeed: { value: look.seed },
      uStyle: { value: STYLE_ID[look.style] },
      uC0: { value: c.c0 },
      uC1: { value: c.c1 },
      uC2: { value: c.c2 },
      uC3: { value: c.c3 },
      uVeg: { value: c.vegetation },
      uSnow: { value: c.snow },
      uSand: { value: c.sand },
      uSeabed: { value: c.seabed },
      uVegAmount: { value: c.vegAmount },
      uHasSea: { value: look.ocean ? 1 : 0 },
      uRelief: { value: look.terrain.relief },
      uLut: { value: lut },
      uLocked: { value: look.climate.locked ? 1 : 0 },
      uIceTemp: { value: look.climate.iceTempK },
      uLapse: { value: look.climate.lapseK },
      uEmissiveKind: { value: EMISSIVE_ID[look.emissive.kind] },
      uAo: { value: CAVITY_AO[look.style] },
    });
    const relief = make(reliefFrag, {
      uFace: { value: 0 },
      uSize: { value: n },
      uHeightTex: { value: this.heightRT.texture },
      uRelief: { value: look.terrain.relief },
    });
    for (const [pass, material] of [
      ['terrain', terrain],
      ['albedo', albedo],
      ['relief', relief],
    ] as const) {
      const mesh = new Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      this.meshes.set(pass, mesh);
      this.scene.add(mesh);
    }
    this.phase = 'compile';
  }

  private ensureCompile(renderer: WebGLRenderer): void {
    if (this.compileDone) {
      this.phase = 'terrain';
      return;
    }
    if (this.compileStarted || !this.scene || !this.camera || !this.heightRT) return;
    this.compileStarted = true;
    // Compile against a render target so the program key matches the real draws.
    renderer.setRenderTarget(this.heightRT);
    const done = (): void => {
      this.compileDone = true;
    };
    renderer.compileAsync(this.scene, this.camera).then(done, done);
  }

  // ───────────────────────────────────────────────────────────── work units

  private runUnit(renderer: WebGLRenderer, remainingMs: number): void {
    switch (this.phase) {
      case 'terrain':
      case 'albedo':
      case 'relief':
        this.runStrip(renderer, this.phase, remainingMs);
        break;
      case 'albedoMips':
        if (this.albedoRT) this.generateMips(renderer, this.albedoRT);
        this.phase = 'relief';
        this.face = 0;
        this.row = 0;
        break;
      case 'reliefMips':
        if (this.reliefRT) this.generateMips(renderer, this.reliefRT);
        this.freeTransient();
        this.phase = 'done';
        break;
      default:
        break;
    }
  }

  private runStrip(renderer: WebGLRenderer, pass: Pass, remainingMs: number): void {
    const mesh = this.meshes.get(pass);
    const target =
      pass === 'terrain' ? this.heightRT : pass === 'albedo' ? this.albedoRT : this.reliefRT;
    if (!mesh || !target || !this.scene || !this.camera) return;
    const n = this.size;
    // Cost model per strip: dt = fixed + rowMs * rows. `fixed` is the round trip of the sync itself (large on
    // software renderers, ~0.1 ms on a GPU); each strip is sized so its work at least matches that overhead.
    const est = this.rowMs[pass];
    const cap = Math.min(
      Math.max(4, Math.floor(MAX_JOB_PIXELS / n)),
      Math.ceil(this.lastRows * MAX_GROWTH),
    );
    const workMs = Math.max(remainingMs - Math.max(this.fixedMs, 0), Math.max(this.fixedMs, 0));
    const rows = est <= 0 ? INITIAL_ROWS : Math.max(1, Math.min(cap, Math.floor(workMs / est)));
    const h = Math.min(rows, n - this.row);
    this.lastRows = Math.max(h, INITIAL_ROWS);

    for (const [p, m] of this.meshes) m.visible = p === pass;
    const u = mesh.material.uniforms;
    if (u.uFace) u.uFace.value = this.face;
    mesh.material.uniformsNeedUpdate = true;
    target.viewport.set(0, this.row, n, h);
    target.scissor.set(0, this.row, n, h);
    renderer.setRenderTarget(target, this.face);
    const t0 = performance.now();
    renderer.render(this.scene, this.camera);
    this.sync(renderer, target === this.heightRT);
    const dt = performance.now() - t0;
    if (this.fixedMs < 0)
      this.fixedMs = dt * 0.9; // the first strip is tiny: nearly all overhead
    else if (h <= 2) this.fixedMs = Math.min(dt, this.fixedMs * 1.02);
    const perRow = Math.max(dt - this.fixedMs, 0) / h;
    this.rowMs[pass] = est <= 0 ? Math.max(perRow, 1e-4) : Math.max(est * 0.6 + perRow * 0.4, 1e-4);

    this.row += h;
    if (this.row >= n) {
      this.row = 0;
      this.face++;
      if (this.face >= 6) {
        this.face = 0;
        if (pass === 'terrain') this.phase = 'albedo';
        else if (pass === 'albedo') this.phase = 'albedoMips';
        else this.phase = 'reliefMips';
      }
    }
  }

  /**
   * Wait for the GPU to finish the strip just drawn, so the cost measurement includes its work and the
   * bake never queues more than a budget's worth. `finish()` alone is a no-op on some drivers; reading one
   * pixel back cannot return before the draw has completed.
   */
  private sync(renderer: WebGLRenderer, floatTarget: boolean): void {
    const gl = renderer.getContext();
    gl.finish();
    if (floatTarget) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this.floatProbe);
    else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.byteProbe);
    gl.getError(); // clear any 'not readable' error so it never surfaces in three's checks
  }

  /** Build the mip chain once: flip `generateMipmaps` on for one (empty) render, then off again. */
  private generateMips(renderer: WebGLRenderer, rt: WebGLCubeRenderTarget): void {
    if (!this.scene || !this.camera) return;
    for (const m of this.meshes.values()) m.visible = false;
    rt.texture.generateMipmaps = true;
    rt.scissorTest = false;
    renderer.setRenderTarget(rt, 0);
    renderer.render(this.scene, this.camera);
    rt.texture.generateMipmaps = false;
    renderer.getContext().finish();
  }
}
