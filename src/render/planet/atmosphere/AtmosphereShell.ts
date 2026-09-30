/**
 * AtmosphereShell — a physically based scattering shell around a planet (see atmosphere.glsl.ts).
 *
 * Two meshes share one geometry and one program: a multiplicative pass (dst * T) and an additive pass
 * (+ in-scattered light), drawn just after the clouds. The meshes are children of the PlanetVisual's root
 * group, so the shell inherits the body's position and orientation; every shader input is rotated into the
 * body frame on the CPU (float64) and oblate bodies are handled in sphere space (`toSphereSpace`).
 */
import {
  AddEquation,
  BackSide,
  CustomBlending,
  GLSL3,
  Group,
  Matrix4,
  Mesh,
  OneFactor,
  ShaderMaterial,
  SphereGeometry,
  SrcColorFactor,
  type Texture,
  Uniform,
  Vector3,
  Vector4,
  ZeroFactor,
} from 'three';
import type { BodyBase } from '../../../core/types';
import {
  type IAtmosphereShell,
  type PlanetUniforms,
  type Quality,
  RENDER_ORDER,
  type VisualFrame,
} from '../../contracts';
import { atmosphereFragment, atmosphereVertex } from './atmosphere.glsl';
import { SkyFrame, toSphereSpace } from './frame';
import type { AtmosphereParams } from './params';
import { createTransmittanceTexture, LUT_MU_SIZE, LUT_R_SIZE, lutGeometry } from './transmittance';

/** View-ray samples per quality (ARCHITECTURE section 8). Even: the sampler splits them around the lowest point. */
const SAMPLES: Readonly<Record<Quality, number>> = { low: 8, medium: 12, high: 16, ultra: 24 };
const SEGMENTS: Readonly<Record<Quality, number>> = { low: 32, medium: 48, high: 64, ultra: 96 };
/** The coverage mesh is larger than the atmosphere so its polygonal silhouette never clips the glow. */
const MESH_MARGIN = 1.04;

export class AtmosphereShell implements IAtmosphereShell {
  readonly object = new Group();
  readonly params: AtmosphereParams;
  private readonly geometry: SphereGeometry;
  private readonly lut: Texture;
  private readonly materials: ShaderMaterial[] = [];
  private readonly frame = new SkyFrame();
  private readonly camQ = new Vector3();
  private readonly sunQ = new Vector3();
  private readonly oblate: number;
  private readonly u;

  constructor(body: BodyBase, params: AtmosphereParams, quality: Quality) {
    this.params = params;
    this.oblate = 1 - body.oblateness;
    const g = lutGeometry(params);
    this.lut = createTransmittanceTexture(params);
    const rayleigh = params.rayleigh;
    const mie = params.mie;
    const ab = params.absorber;
    this.u = {
      uLut: new Uniform(this.lut),
      uLutScale: new Uniform(
        new Vector4(
          1 - 1 / LUT_MU_SIZE,
          1 - 1 / LUT_R_SIZE,
          0.5 / LUT_MU_SIZE,
          0.5 / LUT_R_SIZE,
        ),
      ),
      uGeom: new Uniform(new Vector4(g.rp, g.rt, g.hb, this.oblate)),
      uMeshR: new Uniform(g.rt * MESH_MARGIN),
      uCamQ: new Uniform(this.camQ),
      uSun: new Uniform(this.sunQ),
      uSunE: new Uniform(new Vector3(Math.PI, Math.PI, Math.PI)),
      uSunAng: new Uniform(0.0047),
      uBetaR: new Uniform(new Vector3(...rayleigh.beta)),
      uBetaMS: new Uniform(new Vector3(...mie.scatter)),
      uBetaME: new Uniform(new Vector3(...mie.extinction)),
      uBetaA: new Uniform(new Vector3(...ab.beta)),
      uProf: new Uniform(
        new Vector4(1 / rayleigh.heightKm, 1 / mie.heightKm, ab.centerKm, 1 / ab.widthKm),
      ),
      uPhase: new Uniform(new Vector4(mie.g, params.multiScatter, params.multiScatter * 0.5, 0)),
      uSamples: new Uniform(SAMPLES[quality]),
      uIntensity: new Uniform(1),
      uProj: new Uniform(new Matrix4()),
    };

    const seg = SEGMENTS[quality];
    this.geometry = new SphereGeometry(1, seg, seg / 2);
    const passes = [
      // Pass 0: dst * T (per-channel view transmittance).
      { pass: 0, order: RENDER_ORDER.atmosphere, src: ZeroFactor, dst: SrcColorFactor },
      // Pass 1: dst + in-scattered radiance.
      { pass: 1, order: RENDER_ORDER.atmosphere + 1, src: OneFactor, dst: OneFactor },
    ] as const;
    const meshR = g.rt * MESH_MARGIN;
    for (const p of passes) {
      const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        uniforms: { ...this.u, uPass: new Uniform(p.pass) },
        side: BackSide,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: p.src,
        blendDst: p.dst,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.scale.set(meshR, meshR * this.oblate, meshR);
      mesh.renderOrder = p.order;
      mesh.frustumCulled = false;
      mesh.name = p.pass === 0 ? 'atmosphere-transmittance' : 'atmosphere-inscatter';
      this.materials.push(material);
      this.object.add(mesh);
    }
    this.object.name = 'atmosphere';
  }

  setQuality(q: Quality): void {
    this.u.uSamples.value = SAMPLES[q];
  }

  update(frame: VisualFrame, u: PlanetUniforms): void {
    this.object.visible = u.intensity > 0.001;
    if (!this.object.visible) return;
    const f = this.frame;
    f.update(u);
    toSphereSpace(f.camPos, this.oblate, this.camQ);
    toSphereSpace(f.sunDir, this.oblate, this.sunQ).normalize();
    const k = Math.PI * u.sunIntensity * this.params.gain;
    this.u.uSunE.value.set(u.sunColor.r * k, u.sunColor.g * k, u.sunColor.b * k);
    this.u.uSunAng.value = Math.max(u.sunAngularRadiusRad, 1e-4);
    this.u.uIntensity.value = u.intensity;
    this.u.uProj.value.copy(frame.camera.projectionMatrix);
  }

  dispose(): void {
    this.geometry.dispose();
    this.lut.dispose();
    for (const m of this.materials) m.dispose();
  }
}
