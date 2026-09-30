/**
 * CloudLayer — the animated cloud shell of a planet (see clouds.glsl.ts / cloudField.glsl.ts).
 *
 * One back-face sphere mesh slightly larger than the cloud sphere; the fragment shader does the analytic
 * ray-sphere hit, the density field and the lighting. Drawn between the far half of the rings and the
 * atmosphere (RENDER_ORDER.clouds), premultiplied, depth-tested against the surface with an analytic depth.
 * The pattern rotates slowly about the spin axis (winds) and evolves; both phases are computed on the CPU
 * from `simDays - epoch` (never the raw sim clock: float32 has ~84 s resolution at today's J2000 offset).
 */
import {
  BackSide,
  Color,
  GLSL3,
  Matrix4,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  SphereGeometry,
  Uniform,
  Vector3,
  Vector4,
} from 'three';
import { hash32 } from '../../../core/hash';
import type { BodyBase } from '../../../core/types';
import {
  type ICloudLayer,
  type PlanetUniforms,
  type Quality,
  RENDER_ORDER,
  type VisualFrame,
} from '../../contracts';
import { SkyFrame, toSphereSpace } from '../atmosphere/frame';
import { cloudFragment, cloudVertex } from './clouds.glsl';
import { type CloudParams, MAX_VORTICES } from './params';

const SEGMENTS: Readonly<Record<Quality, number>> = { low: 32, medium: 48, high: 64, ultra: 96 };
const OCTAVES: Readonly<Record<Quality, { base: number; detail: number; shadow: number }>> = {
  low: { base: 3, detail: 3, shadow: 0 },
  medium: { base: 4, detail: 4, shadow: 1 },
  high: { base: 5, detail: 5, shadow: 1 },
  ultra: { base: 5, detail: 6, shadow: 1 },
};
const MESH_MARGIN = 1.04;
/** Winds turn the pattern relative to the ground: rad per simulated day, and per real second (alive at rest). */
const DRIFT_RAD_PER_DAY = 0.12;
const DRIFT_RAD_PER_SEC = 0.0012;
const EVOLVE_PER_DAY = 0.05;
const EVOLVE_PER_SEC = 0.0015;

export class CloudLayer implements ICloudLayer {
  readonly object: Mesh<SphereGeometry, ShaderMaterial>;
  readonly params: CloudParams;
  private readonly frame = new SkyFrame();
  private readonly camQ = new Vector3();
  private readonly sunQ = new Vector3();
  private readonly oblate: number;
  private epoch: number | null = null;
  private readonly u;

  constructor(body: BodyBase, params: CloudParams, quality: Quality) {
    this.params = params;
    this.oblate = 1 - body.oblateness;
    const rc = body.radiusKm * (1 + params.heightFraction);
    const meshR = rc * MESH_MARGIN;
    const oct = OCTAVES[quality];
    const seed = (k: number): number => (hash32(body.seed, 0xc10d, k) / 0xffffffff) * 60;
    const vortexA = Array.from({ length: MAX_VORTICES }, () => new Vector4());
    const vortexB = Array.from({ length: MAX_VORTICES }, () => new Vector4());
    params.vortices.slice(0, MAX_VORTICES).forEach((v, i) => {
      const c = Math.cos(v.lat);
      vortexA[i]?.set(c * Math.cos(v.lon), Math.sin(v.lat), c * Math.sin(v.lon), v.size);
      vortexB[i]?.set(v.strength, 0, 0, 0);
    });
    const wisp = params.style === 'wisp' ? 1 : 0;
    const overcast = params.style === 'overcast' ? 1 : 0;
    this.u = {
      uGeom: new Uniform(new Vector4(rc, body.radiusKm, this.oblate, 0)),
      uMeshR: new Uniform(meshR),
      uCamQ: new Uniform(this.camQ),
      uSun: new Uniform(this.sunQ),
      uSunRad: new Uniform(new Color(1, 1, 1)),
      uProj: new Uniform(new Matrix4()),
      uColor: new Uniform(new Color(...params.color)),
      uSunTau: new Uniform(new Vector3(...params.sunTau)),
      uSky: new Uniform(new Color(...params.skyColor)),
      uLook: new Uniform(new Vector4(params.opacity, 1, oct.shadow, 0.012)),
      uCloudA: new Uniform(new Vector4(params.coverage, params.zonalMean, wisp, overcast)),
      uCloudB: new Uniform(new Vector4(0, 0, wisp ? 0.3 : 0.28, 0)),
      uCloudSeed: new Uniform(new Vector3(seed(1), seed(2), seed(3))),
      uCloudOctBase: new Uniform(oct.base),
      uCloudOctDetail: new Uniform(oct.detail),
      uCloudVortexCount: new Uniform(Math.min(params.vortices.length, MAX_VORTICES)),
      uCloudVortexA: new Uniform(vortexA),
      uCloudVortexB: new Uniform(vortexB),
    };
    this.object = new Mesh(
      new SphereGeometry(1, SEGMENTS[quality], SEGMENTS[quality] / 2),
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        uniforms: this.u,
        side: BackSide,
        blending: NormalBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.object.scale.set(meshR, meshR * this.oblate, meshR);
    this.object.renderOrder = RENDER_ORDER.clouds;
    this.object.frustumCulled = false;
    this.object.name = 'clouds';
  }

  setQuality(q: Quality): void {
    const oct = OCTAVES[q];
    this.u.uCloudOctBase.value = oct.base;
    this.u.uCloudOctDetail.value = oct.detail;
    this.u.uLook.value.z = oct.shadow;
  }

  update(frame: VisualFrame, u: PlanetUniforms): void {
    this.object.visible = u.intensity > 0.001;
    if (!this.object.visible) return;
    const f = this.frame;
    f.update(u);
    toSphereSpace(f.camPos, this.oblate, this.camQ);
    toSphereSpace(f.sunDir, this.oblate, this.sunQ).normalize();
    this.u.uSunRad.value.setRGB(
      u.sunColor.r * u.sunIntensity,
      u.sunColor.g * u.sunIntensity,
      u.sunColor.b * u.sunIntensity,
    );
    this.u.uProj.value.copy(frame.camera.projectionMatrix);
    this.u.uLook.value.y = u.intensity;
    if (this.epoch === null) this.epoch = frame.simDays;
    const days = frame.simDays - this.epoch;
    const tau = Math.PI * 2;
    this.u.uCloudB.value.x = (days * DRIFT_RAD_PER_DAY + frame.timeSec * DRIFT_RAD_PER_SEC) % tau;
    this.u.uCloudB.value.y = days * EVOLVE_PER_DAY + frame.timeSec * EVOLVE_PER_SEC;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
