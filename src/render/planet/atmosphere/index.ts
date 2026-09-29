/**
 * Planet atmosphere — STUB (integration phase). The atmosphere specialist replaces this with a
 * real scattering shell; the factory signature and `IAtmosphereShell` stay.
 *
 * A slightly larger sphere with a view-dependent limb glow tinted by `appearance.hazeColor`, lit
 * from `sunDirection` with a soft terminator. Premultiplied alpha, RENDER_ORDER.atmosphere;
 * `intensity` is used as opacity.
 *
 * Composition contract (shared by all planet sub-components): the returned `object` is added to
 * the PlanetVisual's root group, which already carries `positionKm` and `orientation`. Work in
 * body-fixed km (Y = spin axis) and do NOT apply positionKm/orientation to `object` yourself.
 */
import {
  Color,
  GLSL3,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  SphereGeometry,
  Uniform,
  Vector3,
} from 'three';
import type { BodyBase, StarSystem } from '../../../core/types';
import {
  type IAtmosphereShell,
  type PlanetUniforms,
  type Quality,
  RENDER_ORDER,
  type VisualFrame,
} from '../../contracts';
import { common } from '../../shaders/common.glsl';

/** Below this surface pressure the shell is skipped entirely. */
const MIN_PRESSURE_ATM = 0.005;
const SEGMENTS: Readonly<Record<Quality, number>> = { low: 32, medium: 48, high: 64, ultra: 96 };

const vertexShader = /* glsl */ `
out vec3 vNormalW;
out vec3 vViewW;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormalW = mat3(modelMatrix) * normal;
  vViewW = -world.xyz; // camera at the origin
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${common}
uniform vec3 uColor;
uniform float uStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uIntensity;

in vec3 vNormalW;
in vec3 vViewW;
out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormalW);
  float mu = saturate(dot(n, normalize(vViewW)));
  // Limb glow peaking just inside the shell's silhouette, faint haze across the disk.
  float rim = pow(1.0 - mu, 4.0) * smoothstep(0.0, 0.3, mu) * 2.2 + 0.04;
  float day = smoothstep(-0.25, 0.35, dot(n, uSunDir));
  float a = saturate(rim * day * uStrength) * uIntensity;
  fragColor = vec4(uColor * uSunColor * (uSunIntensity * a), a); // premultiplied
}
`;

class AtmosphereShell implements IAtmosphereShell {
  readonly object: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly uniforms = {
    uColor: new Uniform(new Color()),
    uStrength: new Uniform(1),
    uSunDir: new Uniform(new Vector3(0, 1, 0)),
    uSunColor: new Uniform(new Color(1, 1, 1)),
    uSunIntensity: new Uniform(1),
    uIntensity: new Uniform(1),
  };

  constructor(body: BodyBase, pressureAtm: number, scaleHeightKm: number, quality: Quality) {
    const haze = body.appearance.hazeColor ?? [0.32, 0.56, 1];
    this.uniforms.uColor.value.setRGB(haze[0], haze[1], haze[2]);
    this.uniforms.uStrength.value = Math.min(1.4, 0.55 + 0.3 * Math.log10(1 + pressureAtm * 9));
    // ~6 scale heights, clamped so the rim stays visible but never balloons.
    const thickness = Math.min(0.05, Math.max(0.015, (6 * scaleHeightKm) / body.radiusKm));
    const segments = SEGMENTS[quality];
    this.object = new Mesh(
      new SphereGeometry(1, segments, segments / 2),
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: this.uniforms,
        blending: NormalBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const r = body.radiusKm * (1 + thickness);
    this.object.scale.set(r, r * (1 - body.oblateness), r);
    this.object.renderOrder = RENDER_ORDER.atmosphere;
    this.object.name = 'atmosphere';
  }

  update(_frame: VisualFrame, u: PlanetUniforms): void {
    const un = this.uniforms;
    un.uSunDir.value.copy(u.sunDirection);
    un.uSunColor.value.copy(u.sunColor);
    un.uSunIntensity.value = u.sunIntensity;
    un.uIntensity.value = u.intensity;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}

/** A limb-glow shell for bodies with a meaningful atmosphere, else null. */
export function createAtmosphere(
  body: BodyBase,
  _system: StarSystem,
  quality: Quality,
): IAtmosphereShell | null {
  const atm = body.atmosphere;
  if (!atm || atm.surfacePressureAtm < MIN_PRESSURE_ATM || !body.appearance.hazeColor) return null;
  return new AtmosphereShell(body, atm.surfacePressureAtm, atm.scaleHeightKm, quality);
}
