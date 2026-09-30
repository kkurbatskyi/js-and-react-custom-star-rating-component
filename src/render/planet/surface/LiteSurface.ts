/**
 * LiteSurface — the cheap analytic surface of small or distant rocky worlds (see glsl/lite.glsl.ts).
 * No bake, no textures: `ready` immediately. Gas and ice giants use `GiantSurface` in lite mode instead.
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
} from 'three';
import type { BodyBase } from '../../../core/types';
import { type PlanetUniforms, RENDER_ORDER, type VisualFrame } from '../../contracts';
import { common } from '../../shaders/common.glsl';
import { noise } from '../../shaders/noise.glsl';
import { EMISSIVE_ID, LIQUID_ID, type RockyLook, STYLE_ID } from '../appearance';
import { BodyFrame } from './bodyFrame';
import { lightingGlsl } from './glsl/lighting.glsl';
import { liteFragment, liteVertex } from './glsl/lite.glsl';

const fragmentShader = `${common}\n${noise}\n${lightingGlsl}\n${liteFragment}`;
const LITE_SEGMENTS = 48;

export class LiteSurface {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly frame = new BodyFrame();
  private readonly body: BodyBase;
  private readonly uniforms: Record<string, Uniform>;
  private readonly sunRadiance = new Vector3();

  constructor(body: BodyBase, look: RockyLook) {
    this.body = body;
    const c = look.colors;
    const ocean = look.ocean;
    const ring = body.rings;
    const hazeColor = body.appearance.hazeColor;
    const tint = (v: readonly [number, number, number]): Color => new Color(v[0], v[1], v[2]);
    this.uniforms = {
      uSunDirB: new Uniform(this.frame.sunDir),
      uCamB: new Uniform(this.frame.camPos),
      uSunRadiance: new Uniform(this.sunRadiance),
      uIntensity: new Uniform(1),
      uRadii: new Uniform(
        new Vector3(body.radiusKm, body.radiusKm * (1 - body.oblateness), body.radiusKm),
      ),
      uRing: new Uniform(
        ring
          ? new Vector4(
              ring.innerRadiusKm,
              ring.outerRadiusKm,
              ring.opticalDepth,
              (ring.seed % 997) / 97,
            )
          : new Vector4(0, 0, 0, 0),
      ),
      uTime: new Uniform(0),
      uSeed: new Uniform(new Vector3(look.seed[0], look.seed[1], look.seed[2])),
      uContScale: new Uniform(look.terrain.contScale),
      uWarp: new Uniform(look.terrain.warp),
      uSea: new Uniform(look.terrain.sea),
      uEyeball: new Uniform(look.terrain.eyeball),
      uStyle: new Uniform(STYLE_ID[look.style]),
      uC0: new Uniform(tint(c.c0)),
      uC1: new Uniform(tint(c.c1)),
      uC2: new Uniform(tint(c.c2)),
      uC3: new Uniform(tint(c.c3)),
      uVeg: new Uniform(tint(c.vegetation)),
      uSnow: new Uniform(tint(c.snow)),
      uSand: new Uniform(tint(c.sand)),
      uVegAmount: new Uniform(c.vegAmount),
      // Ice reaches |sin(latitude)| >= 1 - coverage.
      uIceLat: new Uniform(look.climate.iceTempK > 0 ? 1 - Math.min(1, body.iceCoverage) : 1),
      uOceanDeep: new Uniform(ocean ? tint(ocean.deep) : new Color()),
      uOceanShallow: new Uniform(ocean ? tint(ocean.shallow) : new Color()),
      uOceanMode: new Uniform(ocean ? LIQUID_ID[ocean.liquid] + 1 : 0),
      uOceanRough: new Uniform(ocean?.roughness ?? 0.1),
      uCraters: new Uniform(look.terrain.craters),
      uCloudCov: new Uniform(look.cloudCoverage),
      uCloudColor: new Uniform(tint(body.appearance.cloudColor)),
      uEmissiveKind: new Uniform(EMISSIVE_ID[look.emissive.kind]),
      uEmissive: new Uniform(look.emissive.strength),
      uSunTau: new Uniform(new Vector3(...look.optics.sunTau)),
      uSkyColor: new Uniform(new Vector3(...look.optics.skyColor)),
      uAmbient: new Uniform(look.optics.ambient),
      uWrap: new Uniform(look.optics.wrap),
      uAirless: new Uniform(look.airlessBrdf ? 1 : 0),
      uHaze: new Uniform(hazeColor ? tint(hazeColor) : new Color()),
      uRim: new Uniform(hazeColor ? 0.5 * Math.min(1, 0.4 + look.optics.pressureAtm) : 0),
    };
    this.mesh = new Mesh(
      new SphereGeometry(1, LITE_SEGMENTS, LITE_SEGMENTS / 2),
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: liteVertex,
        fragmentShader,
        uniforms: this.uniforms,
        toneMapped: false,
      }),
    );
    this.mesh.scale.set(body.radiusKm, body.radiusKm * (1 - body.oblateness), body.radiusKm);
    this.mesh.renderOrder = RENDER_ORDER.surface;
    this.mesh.name = 'surface';
    this.mesh.frustumCulled = false;
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
    if (un.uTime) un.uTime.value = frame.timeSec % 100000;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
