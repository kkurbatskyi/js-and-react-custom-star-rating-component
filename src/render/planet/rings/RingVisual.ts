/**
 * RingVisual — a planet's ring system: a flat annulus in the equatorial plane with procedural radial
 * structure, slab photometry (lit / unlit face, forward-scattering glow), optical-depth transparency and the
 * planet's shadow (see rings.glsl.ts and ringProfile.glsl.ts).
 *
 * Two meshes share one geometry and one program and split the annulus by the plane through the planet's
 * centre perpendicular to the view direction: the far half draws before the clouds and the atmosphere
 * (RENDER_ORDER.ringsFar) so the limb hazes it, the near half after them (RENDER_ORDER.ringsNear).
 * Everything the shader needs is rotated into the body frame on the CPU in float64.
 */
import {
  Color,
  DoubleSide,
  GLSL3,
  Group,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Uniform,
  Vector3,
  Vector4,
} from 'three';
import type { BodyBase, RingSystem } from '../../../core/types';
import {
  type IRingVisual,
  type PlanetUniforms,
  type Quality,
  RENDER_ORDER,
  type VisualFrame,
} from '../../contracts';
import { SkyFrame, toSphereSpace } from '../atmosphere/frame';
import {
  createRingGeometry,
  deriveRingMaterial,
  type RingMaterialParams,
  ringUniformVector,
} from './ringMaterial';
import { ringFragment, ringVertex } from './rings.glsl';

const SEGMENTS: Readonly<Record<Quality, number>> = {
  low: 128,
  medium: 192,
  high: 256,
  ultra: 384,
};

export class RingVisual implements IRingVisual {
  readonly object = new Group();
  readonly material: RingMaterialParams;
  private readonly geometry;
  private readonly materials: ShaderMaterial[] = [];
  private readonly frame = new SkyFrame();
  private readonly sunQ = new Vector3();
  private readonly oblate: number;
  private readonly outerKm: number;
  private readonly u;

  constructor(body: BodyBase, rings: RingSystem, quality: Quality) {
    this.object.name = 'rings';
    this.oblate = 1 - body.oblateness;
    this.outerKm = rings.outerRadiusKm;
    this.material = deriveRingMaterial(rings);
    const m = this.material;
    this.geometry = createRingGeometry(rings.innerRadiusKm, rings.outerRadiusKm, SEGMENTS[quality]);
    this.u = {
      uRing: new Uniform(new Vector4(...ringUniformVector(rings))),
      uCam: new Uniform(this.frame.camPos),
      uSunL: new Uniform(this.frame.sunDir),
      uSunQ: new Uniform(this.sunQ),
      uSunRad: new Uniform(new Color(1, 1, 1)),
      uSunAng: new Uniform(0.0047),
      uPlanetR: new Uniform(body.radiusKm),
      uColor: new Uniform(new Color(m.color[0], m.color[1], m.color[2])),
      uPhase: new Uniform(new Vector4(m.phaseForward, m.phaseBackward, m.backwardWeight, m.surge)),
      uMs: new Uniform(m.multiScatter),
      uIntensity: new Uniform(1),
      uOcc: new Uniform(this.frame.occluders),
      uOccCount: new Uniform(0),
    };
    for (const [half, order] of [
      [1, RENDER_ORDER.ringsFar],
      [-1, RENDER_ORDER.ringsNear],
    ] as const) {
      const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        uniforms: { ...this.u, uHalf: new Uniform(half) },
        side: DoubleSide,
        blending: NormalBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      mesh.name = half > 0 ? 'rings-far' : 'rings-near';
      this.materials.push(material);
      this.object.add(mesh);
    }
  }

  update(_frame: VisualFrame, u: PlanetUniforms): void {
    this.object.visible = u.intensity > 0.001;
    if (!this.object.visible) return;
    this.frame.update(u, this.outerKm);
    this.u.uOccCount.value = this.frame.occluderCount;
    toSphereSpace(this.frame.sunDir, this.oblate, this.sunQ).normalize();
    this.u.uSunRad.value.setRGB(
      u.sunColor.r * u.sunIntensity,
      u.sunColor.g * u.sunIntensity,
      u.sunColor.b * u.sunIntensity,
    );
    this.u.uSunAng.value = Math.max(u.sunAngularRadiusRad, 1e-4);
    this.u.uIntensity.value = u.intensity;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
