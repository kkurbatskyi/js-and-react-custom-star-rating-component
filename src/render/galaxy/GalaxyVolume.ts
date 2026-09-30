/**
 * Diffuse galaxy light: an emission–absorption raymarch at reduced resolution, accumulated over
 * frames (jittered starts + reprojected, neighbourhood-clamped history) and composited additively
 * at full resolution. Shaders and the stepping scheme: ./volume.glsl.ts.
 *
 * Usage: add `mesh` to the galaxy scene; call `render()` once per frame before the scene renders.
 */
import {
  AdditiveBlending,
  type BufferGeometry,
  type Data3DTexture,
  DataUtils,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { VisualFrame } from '../contracts';
import { fullScreenTriangle } from './GalaxyMap';
import type { GalaxyFieldUniforms } from './uniforms';
import { compositeFragment, fullScreenVertex, marchFragment, resolveFragment } from './volume.glsl';

/** Weight of the newest frame once the history has converged (≈ 1 / effective sample count). */
const MIN_BLEND = 0.1;

function makeTarget(
  filter: typeof LinearFilter | typeof NearestFilter,
  count = 1,
): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, {
    count,
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class GalaxyVolume {
  /** Full-resolution composite (additive). Add it to the galaxy scene. */
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** Linear fraction of the drawing buffer's size; 0 disables the pass. */
  scale: number;
  steps: number;

  readonly uniforms = {
    uCameraLy: new Uniform(new Vector3()),
    uCamRot: new Uniform(new Matrix3()),
    uProjInv: new Uniform(new Matrix4()),
    uPixelAngle: new Uniform(1e-3),
    uFrame: new Uniform(0),
    uSteps: new Uniform(32),
    uBoundR: new Uniform(1),
    uBoundY: new Uniform(1),
    uStepK: new Uniform(new Vector4(0.3, 0.12, 0.16, 300)),
    uStepLimits: new Uniform(new Vector3(25, 6000, 1500)),
    uColThin: new Uniform(new Vector3()),
    uColThinInner: new Uniform(new Vector3()),
    uColThick: new Uniform(new Vector3()),
    uColArm: new Uniform(new Vector3()),
    uColArmInner: new Uniform(new Vector3()),
    uArmDetail: new Uniform(new Vector2()),
    uColSpheroid: new Uniform(new Vector3()),
    uColHii: new Uniform(new Vector3()),
    uMottle: new Uniform(0),
    uLight: new Uniform(new Vector4(1, 4, 1.5, 1e4)),
    uKnee: new Uniform(new Vector2(1e30, 1)),
    uNoise: new Uniform<Data3DTexture | null>(null),
    uNear: new Uniform(new Vector3(0, 2500, 0)),
  };

  private readonly geometry = fullScreenTriangle();
  private readonly camera = new OrthographicCamera();
  private readonly marchScene = new Scene();
  private readonly resolveScene = new Scene();
  private readonly marchMaterial: ShaderMaterial;
  private readonly resolveMaterial: ShaderMaterial;
  /** textures[0]: radiance + distance; textures[1]: dust optical-depth guide. */
  private readonly marchTarget = makeTarget(NearestFilter, 2);
  private readonly history = [makeTarget(LinearFilter), makeTarget(LinearFilter)] as const;
  private readonly resolveUniforms = {
    uCurrent: new Uniform(this.marchTarget.texture),
    uHistory: new Uniform(this.history[0].texture),
    uPrevViewProj: new Uniform(new Matrix4()),
    uCamDelta: new Uniform(new Vector3()),
    uAlpha: new Uniform(1),
  };
  private readonly compositeUniforms = {
    uVolume: new Uniform(this.history[0].texture),
    uGuide: new Uniform(this.marchTarget.textures[1] ?? null),
    uPixelAngleFull: new Uniform(1e-3),
    uGuided: new Uniform(1),
    uGain: new Uniform(1),
  };
  /** Dust-guided upsampling (off: plain bilinear, cheaper). */
  guided = true;
  private current = 0;
  private accumulated = 0;
  private frameIndex = 0;
  private hasPrevious = false;
  private readonly prevCameraLy = new Vector3();
  private readonly bufferSize = new Vector2();

  constructor(fields: GalaxyFieldUniforms, noise: Data3DTexture, scale: number, steps: number) {
    this.scale = scale;
    this.steps = steps;
    this.uniforms.uNoise.value = noise;
    const common = { glslVersion: GLSL3, depthTest: false, depthWrite: false, toneMapped: false };
    this.marchMaterial = new ShaderMaterial({
      ...common,
      vertexShader: fullScreenVertex,
      fragmentShader: marchFragment,
      uniforms: { ...fields, ...this.uniforms },
    });
    this.resolveMaterial = new ShaderMaterial({
      ...common,
      vertexShader: fullScreenVertex,
      fragmentShader: resolveFragment,
      uniforms: {
        ...this.resolveUniforms,
        uCamRot: this.uniforms.uCamRot,
        uProjInv: this.uniforms.uProjInv,
      },
    });
    for (const [scene, material] of [
      [this.marchScene, this.marchMaterial],
      [this.resolveScene, this.resolveMaterial],
    ] as const) {
      const quad = new Mesh(this.geometry, material);
      quad.frustumCulled = false;
      scene.add(quad);
    }
    this.mesh = new Mesh(
      this.geometry,
      new ShaderMaterial({
        ...common,
        vertexShader: fullScreenVertex,
        fragmentShader: compositeFragment,
        uniforms: {
          ...fields,
          ...this.compositeUniforms,
          uCameraLy: this.uniforms.uCameraLy,
          uCamRot: this.uniforms.uCamRot,
          uProjInv: this.uniforms.uProjInv,
          uBoundR: this.uniforms.uBoundR,
        },
        blending: AdditiveBlending,
        transparent: true,
      }),
    );
    this.mesh.name = 'GalaxyVolume';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Forget the accumulated history (e.g. after a camera cut or a look change). */
  resetHistory(): void {
    this.accumulated = 0;
    this.hasPrevious = false;
  }

  /** Raymarch + resolve for this frame (call before the galaxy scene renders). */
  render(frame: VisualFrame, cameraLy: Vector3, gain: number, nearFadeLy: number): void {
    this.uniforms.uNear.value.z = nearFadeLy;
    this.mesh.visible = this.scale > 0 && gain > 0;
    if (!this.mesh.visible) {
      this.hasPrevious = false;
      return;
    }
    const renderer = frame.renderer;
    renderer.getDrawingBufferSize(this.bufferSize);
    const w = Math.max(1, Math.round(this.bufferSize.x * this.scale));
    const h = Math.max(1, Math.round(this.bufferSize.y * this.scale));
    if (w !== this.marchTarget.width || h !== this.marchTarget.height) {
      this.marchTarget.setSize(w, h);
      this.history[0].setSize(w, h);
      this.history[1].setSize(w, h);
      this.resetHistory();
    }

    const cam = frame.camera;
    cam.updateMatrixWorld();
    const u = this.uniforms;
    u.uCameraLy.value.copy(cameraLy);
    u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uPixelAngle.value = 2 / ((cam.projectionMatrix.elements[5] ?? 1) * h);
    u.uFrame.value = this.frameIndex++ % 4096;
    u.uSteps.value = this.steps;

    // Temporal: a camera jump (> 10 % of its distance from the centre) restarts accumulation.
    const r = this.resolveUniforms;
    r.uCamDelta.value.subVectors(cameraLy, this.prevCameraLy);
    const jump = r.uCamDelta.value.length() > 0.1 * Math.max(cameraLy.length(), 1000);
    this.accumulated = !this.hasPrevious || jump ? 0 : this.accumulated + 1;
    r.uAlpha.value = Math.max(1 / (this.accumulated + 1), MIN_BLEND);
    const next = 1 - this.current;
    const read = this.history[this.current];
    const write = this.history[next];
    if (!read || !write) return;
    r.uHistory.value = read.texture;

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.marchTarget);
    renderer.render(this.marchScene, this.camera);
    renderer.setRenderTarget(write);
    renderer.render(this.resolveScene, this.camera);
    renderer.setRenderTarget(previous);
    this.current = next;

    const c = this.compositeUniforms;
    c.uVolume.value = write.texture;
    c.uGain.value = gain;
    c.uGuided.value = this.guided ? 1 : 0;
    c.uPixelAngleFull.value = 2 / ((cam.projectionMatrix.elements[5] ?? 1) * this.bufferSize.y);
    r.uPrevViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.prevCameraLy.copy(cameraLy);
    this.hasPrevious = true;
  }

  /** Dev: resolved volume radiance (RGB) and distance (kly) at screen uv (0..1, y up). */
  probe(renderer: WebGLRenderer, u: number, v: number): [number, number, number, number] {
    const target = this.history[this.current];
    if (!target) return [0, 0, 0, 0];
    const half = new Uint16Array(4);
    const x = Math.min(target.width - 1, Math.floor(u * target.width));
    const y = Math.min(target.height - 1, Math.floor(v * target.height));
    renderer.readRenderTargetPixels(target, x, y, 1, 1, half);
    const f = (i: number): number => Number(DataUtils.fromHalfFloat(half[i] ?? 0).toPrecision(4));
    return [f(0), f(1), f(2), f(3)];
  }

  dispose(): void {
    this.geometry.dispose();
    this.marchMaterial.dispose();
    this.resolveMaterial.dispose();
    this.mesh.material.dispose();
    this.marchTarget.dispose();
    this.history[0].dispose();
    this.history[1].dispose();
  }
}
