/**
 * Planet atmosphere — STUB (integration phase). The atmosphere specialist replaces this with a
 * real scattering shell; the factory signature and `IAtmosphereShell` stay.
 *
 * A slightly larger sphere drawn with a view-dependent (fresnel-like) limb glow, tinted by the
 * dominant gases and lit from `sunDirection` with a soft terminator. Premultiplied alpha.
 *
 * Composition contract (shared by all planet sub-components): the returned `object` is added to
 * the PlanetVisual's root group, which already carries `positionKm` and `orientation`. Work in
 * body-fixed km (Y = spin axis) and do NOT apply positionKm/orientation to `object` yourself.
 */
import { Color, GLSL3, Mesh, NormalBlending, ShaderMaterial, SphereGeometry, Uniform, Vector3 } from 'three';
import type { BodyBase, StarSystem } from '../../../core/types';
import type { IAtmosphereShell, PlanetUniforms, Quality, VisualFrame } from '../../contracts';
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
  vec3 c = uColor * uSunColor * uSunIntensity * a;
  fragColor = vec4(c, a); // premultiplied
}
`;

/** Rough sky tint from composition and pressure (linear sRGB). */
function atmosphereTint(body: BodyBase): [number, number, number] {
  const atm = body.atmosphere;
  if (!atm) return [0, 0, 0];
  const frac = (gas: string) => atm.composition.find((c) => c.gas === gas)?.fraction ?? 0;
  if (frac('H₂') > 0.5) return frac('CH₄') > 0.015 ? [0.42, 0.78, 1] : [0.8, 0.82, 0.95];
  if (frac('CH₄') > 0.02 && frac('N₂') > 0.5) return [1, 0.58, 0.25]; // tholin haze
  if (frac('CO₂') > 0.5) return atm.surfacePressureAtm > 5 ? [1, 0.84, 0.55] : [0.95, 0.62, 0.45];
  if (frac('Na') > 0.2 || frac('SiO') > 0.2) return [1, 0.72, 0.42];
  return [0.32, 0.56, 1]; // Rayleigh blue
}

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

  constructor(body: BodyBase, quality: Quality) {
    const atm = body.atmosphere as NonNullable<BodyBase['atmosphere']>;
    const [r, g, b] = atmosphereTint(body);
    this.uniforms.uColor.value.setRGB(r, g, b);
    this.uniforms.uStrength.value = Math.min(1.4, 0.55 + 0.3 * Math.log10(1 + atm.surfacePressureAtm * 9));
    // ~6 scale heights, clamped so the rim stays visible but never balloons.
    const thickness = Math.min(0.05, Math.max(0.015, (6 * atm.scaleHeightKm) / body.radiusKm));
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
    this.object.scale.setScalar(body.radiusKm * (1 + thickness));
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
export function createAtmosphere(body: BodyBase, _system: StarSystem, quality: Quality): IAtmosphereShell | null {
  if (!body.atmosphere || body.atmosphere.surfacePressureAtm < MIN_PRESSURE_ATM) return null;
  return new AtmosphereShell(body, quality);
}
