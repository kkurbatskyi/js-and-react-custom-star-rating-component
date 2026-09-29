/**
 * Planetary rings — STUB (integration phase). The rings specialist replaces the internals; the
 * factory signature and `IRingVisual` stay.
 *
 * A flat annulus in the body's equatorial plane (body-fixed XZ; Y = spin axis) with procedural
 * radial structure (bands, ringlets, a Cassini-like gap), opacity 1 − e^(−τ) from the optical
 * depth, dimming when the sun grazes the ring plane, and the planet's cylindrical shadow.
 * Drawn as two view-dependent halves sharing one geometry (RENDER_ORDER.ringsFar / ringsNear), so
 * the far half sits behind the atmosphere and clouds and the near half in front of them.
 * Premultiplied alpha; `intensity` is used as opacity.
 *
 * Composition contract: the returned `object` is added to the PlanetVisual's root group, which
 * already carries positionKm/orientation — do not transform it yourself.
 */
import {
  Color,
  DoubleSide,
  GLSL3,
  Group,
  Mesh,
  NormalBlending,
  RingGeometry,
  ShaderMaterial,
  Uniform,
  Vector3,
} from 'three';
import type { BodyBase, RingSystem, RGB, StarSystem } from '../../../core/types';
import { type IRingVisual, type PlanetUniforms, type Quality, RENDER_ORDER, type VisualFrame } from '../../contracts';
import { common } from '../../shaders/common.glsl';

const SEGMENTS: Readonly<Record<Quality, number>> = { low: 96, medium: 160, high: 256, ultra: 384 };

const RING_COLORS: Readonly<Record<RingSystem['composition'], RGB>> = {
  ice: [0.86, 0.8, 0.7],
  rock: [0.42, 0.36, 0.3],
  dust: [0.55, 0.46, 0.4],
};

const vertexShader = /* glsl */ `
out vec3 vObj;
out vec3 vWorld;
out vec3 vCentre;
out vec3 vNormalW;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vObj = position;
  vWorld = world.xyz;
  vCentre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${common}
uniform float uInner;
uniform float uOuter;
uniform float uOpticalDepth;
uniform float uSeed;
uniform float uHalf;          // +1: draw the half beyond the planet centre, -1: the near half
uniform float uPlanetRadius;
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uIntensity;

in vec3 vObj;
in vec3 vWorld;
in vec3 vCentre;
in vec3 vNormalW;
out vec4 fragColor;

void main() {
  // The camera sits at the origin: split by distance relative to the planet centre.
  if ((length(vWorld) - length(vCentre)) * uHalf < 0.0) discard;
  float t = (length(vObj.xz) - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float bands = 0.6 + 0.22 * sin(t * 37.0 + uSeed) + 0.14 * sin(t * 113.0 + uSeed * 1.7)
              + 0.08 * sin(t * 311.0 + uSeed * 2.3);
  float gap = 1.0 - 0.9 * (smoothstep(0.58, 0.6, t) - smoothstep(0.64, 0.66, t));
  float edges = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.92, 1.0, t));
  float tau = uOpticalDepth * max(bands, 0.0) * gap * edges;
  float alpha = (1.0 - exp(-tau)) * uIntensity;

  // Sunlight grazing the ring plane lights it poorly; the planet casts a cylindrical shadow.
  float lit = 0.2 + 0.8 * sqrt(abs(dot(vNormalW, uSunDir)));
  vec3 rel = vWorld - vCentre;
  float along = dot(rel, uSunDir);
  float perp = length(rel - along * uSunDir);
  float shadow = along < 0.0 ? smoothstep(uPlanetRadius * 0.97, uPlanetRadius * 1.03, perp) : 1.0;
  vec3 c = uColor * uSunColor * (uSunIntensity * lit * (0.08 + 0.92 * shadow));
  fragColor = vec4(c * alpha, alpha); // premultiplied
}
`;

class RingVisual implements IRingVisual {
  readonly object = new Group();
  private readonly geometry: RingGeometry;
  private readonly materials: ShaderMaterial[] = [];
  private readonly sunDir = new Vector3(0, 1, 0);
  private readonly sunColor = new Color(1, 1, 1);

  constructor(body: BodyBase, rings: RingSystem, quality: Quality) {
    this.object.name = 'rings';
    this.geometry = new RingGeometry(rings.innerRadiusKm, rings.outerRadiusKm, SEGMENTS[quality], 1);
    this.geometry.rotateX(-Math.PI / 2); // XY → equatorial XZ plane, normal +Y
    const [r, g, b] = RING_COLORS[rings.composition];
    for (const [half, order] of [
      [1, RENDER_ORDER.ringsFar],
      [-1, RENDER_ORDER.ringsNear],
    ] as const) {
      const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: {
          uInner: new Uniform(rings.innerRadiusKm),
          uOuter: new Uniform(rings.outerRadiusKm),
          uOpticalDepth: new Uniform(rings.opticalDepth),
          uSeed: new Uniform((rings.seed % 997) / 97),
          uHalf: new Uniform(half),
          uPlanetRadius: new Uniform(body.radiusKm),
          uColor: new Uniform(new Color(r, g, b)),
          uSunDir: new Uniform(this.sunDir),
          uSunColor: new Uniform(this.sunColor),
          uSunIntensity: new Uniform(1),
          uIntensity: new Uniform(1),
        },
        side: DoubleSide,
        blending: NormalBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.renderOrder = order;
      mesh.name = half > 0 ? 'rings-far' : 'rings-near';
      this.materials.push(material);
      this.object.add(mesh);
    }
  }

  update(_frame: VisualFrame, u: PlanetUniforms): void {
    // Shared Vector3/Color objects are referenced by both materials' uniforms.
    this.sunDir.copy(u.sunDirection);
    this.sunColor.copy(u.sunColor);
    for (const m of this.materials) {
      m.uniforms.uSunIntensity.value = u.sunIntensity;
      m.uniforms.uIntensity.value = u.intensity;
    }
    this.object.visible = u.intensity > 0.001;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** Rings in the body's equatorial plane, or null when it has none (moons never do). */
export function createRings(body: BodyBase, _system: StarSystem, quality: Quality): IRingVisual | null {
  return body.rings ? new RingVisual(body, body.rings, quality) : null;
}
