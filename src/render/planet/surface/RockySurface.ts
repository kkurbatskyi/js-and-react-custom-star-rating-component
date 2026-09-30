/**
 * RockySurface — the opaque surface of a baked rocky world: an ellipsoid mesh with the runtime
 * shader (`glsl/rocky.glsl.ts`) sampling the albedo and relief cube maps produced by `SurfaceBaker`.
 *
 * The mesh is a child of the PlanetVisual root group (which carries position and orientation) and is
 * scaled to the body's radii (polar flattening from `oblateness`). It stays hidden until `setBaked`.
 */
import {
  Color,
  GLSL3,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Uniform,
  Vector3,
  Vector4,
  type WebGLCubeRenderTarget,
} from 'three';
import type { BodyBase } from '../../../core/types';
import { type Quality, RENDER_ORDER, type PlanetUniforms, type VisualFrame } from '../../contracts';
import { common } from '../../shaders/common.glsl';
import { noise } from '../../shaders/noise.glsl';
import {
  DETAIL_OCTAVES,
  EMISSIVE_ID,
  LIQUID_ID,
  type RockyLook,
  type RockyStyle,
  SURFACE_SEGMENTS,
} from '../appearance';
import { BodyFrame, MAX_OCCLUDERS } from './bodyFrame';
import { lightingGlsl } from './glsl/lighting.glsl';
import { rockyFragment, rockyVertex } from './glsl/rocky.glsl';

/** Sub-texel detail strength per style: tangent-slope amplitude and albedo modulation. */
const DETAIL: Readonly<Record<RockyStyle, { slope: number; albedo: number }>> = {
  biome: { slope: 0.09, albedo: 0.25 },
  regolith: { slope: 0.16, albedo: 0.3 },
  desert: { slope: 0.12, albedo: 0.25 },
  icy: { slope: 0.05, albedo: 0.1 },
  volcanic: { slope: 0.12, albedo: 0.3 },
  dwarf: { slope: 0.1, albedo: 0.22 },
};

const fragmentShader = `${common}\n${noise}\n${lightingGlsl}\n${rockyFragment}`;

export class RockySurface {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly frame = new BodyFrame();
  private readonly body: BodyBase;
  private readonly uniforms: Record<string, Uniform>;
  private readonly sunRadiance = new Vector3();

  constructor(body: BodyBase, look: RockyLook, quality: Quality, bakeSize: number) {
    this.body = body;
    const ocean = look.ocean;
    const ring = body.rings;
    const detail = DETAIL[look.style];
    this.uniforms = {
      uAlbedoTex: new Uniform(null),
      uReliefTex: new Uniform(null),
      uSunDirB: new Uniform(this.frame.sunDir),
      uCamB: new Uniform(this.frame.camPos),
      uSunRadiance: new Uniform(this.sunRadiance),
      uIntensity: new Uniform(1),
      uRadii: new Uniform(new Vector3(body.radiusKm, body.radiusKm * (1 - body.oblateness), body.radiusKm)),
      uSunAng: new Uniform(0.0047),
      uOcc: new Uniform(this.frame.occluders),
      uOccCount: new Uniform(0),
      uRing: new Uniform(
        ring
          ? new Vector4(ring.innerRadiusKm, ring.outerRadiusKm, ring.opticalDepth, (ring.seed % 997) / 97)
          : new Vector4(0, 0, 0, 0),
      ),
      uTime: new Uniform(0),
      uSeed: new Uniform(new Vector3(look.seed[0], look.seed[1], look.seed[2])),
      uRelief: new Uniform(look.terrain.relief),
      uBakeTexel: new Uniform((Math.PI / 2) / bakeSize),
      uDetailOctaves: new Uniform(DETAIL_OCTAVES[quality]),
      uDetailSlope: new Uniform(detail.slope),
      uDetailAlbedo: new Uniform(detail.albedo),
      uOceanDeep: new Uniform(ocean ? new Color(...ocean.deep) : new Color()),
      uOceanShallow: new Uniform(ocean ? new Color(...ocean.shallow) : new Color()),
      uOceanMode: new Uniform(ocean ? LIQUID_ID[ocean.liquid] + 1 : 0),
      uOceanRough: new Uniform(ocean?.roughness ?? 0.1),
      uEmissiveKind: new Uniform(EMISSIVE_ID[look.emissive.kind]),
      uEmissive: new Uniform(look.emissive.strength),
      uSunTau: new Uniform(new Vector3(...look.optics.sunTau)),
      uSkyColor: new Uniform(new Vector3(...look.optics.skyColor)),
      uAmbient: new Uniform(look.optics.ambient),
      uWrap: new Uniform(look.optics.wrap),
      uAirless: new Uniform(look.airlessBrdf ? 1 : 0),
      uRough: new Uniform(look.roughness),
      uDebug: new Uniform(0),
    };
    void MAX_OCCLUDERS;

    const seg = SURFACE_SEGMENTS[quality];
    this.mesh = new Mesh(
      new SphereGeometry(1, seg, seg / 2),
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: rockyVertex,
        fragmentShader,
        uniforms: this.uniforms,
        toneMapped: false,
      }),
    );
    this.mesh.scale.set(body.radiusKm, body.radiusKm * (1 - body.oblateness), body.radiusKm);
    this.mesh.renderOrder = RENDER_ORDER.surface;
    this.mesh.name = 'surface';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Attach the baked cubes and reveal the surface. */
  setBaked(albedo: WebGLCubeRenderTarget, relief: WebGLCubeRenderTarget): void {
    const a = this.uniforms.uAlbedoTex;
    const r = this.uniforms.uReliefTex;
    if (a) a.value = albedo.texture;
    if (r) r.value = relief.texture;
    this.mesh.visible = true;
  }

  /** Debug visualisation: 0 shaded, 1 albedo, 2 normals, 3 height. */
  setDebug(mode: number): void {
    const d = this.uniforms.uDebug;
    if (d) d.value = mode;
  }

  update(frame: VisualFrame, u: PlanetUniforms): void {
    this.frame.update(this.body, u);
    this.sunRadiance.set(
      u.sunColor.r * u.sunIntensity,
      u.sunColor.g * u.sunIntensity,
      u.sunColor.b * u.sunIntensity,
    );
    const un = this.uniforms;
    if (un.uIntensity) un.uIntensity.value = u.intensity;
    if (un.uSunAng) un.uSunAng.value = Math.max(u.sunAngularRadiusRad, 1e-4);
    if (un.uOccCount) un.uOccCount.value = this.frame.occluderCount;
    if (un.uTime) un.uTime.value = frame.timeSec % 100000;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
