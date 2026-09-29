/**
 * StarVisual — STUB (integration phase). The star specialist replaces the internals (corona,
 * flares, exotic objects); the public API (`IStarVisual`) stays.
 *
 * - Photosphere: sphere scaled to `star.radiusKm`, emissive HDR (~14 × the saturated blackbody
 *   colour) with quadratic limb darkening I(μ)/I(1) = 1 − 0.47(1−μ) − 0.23(1−μ)² (solar V band)
 *   and slow simplex "granulation". Black holes render an unlit event horizon.
 * - Glow: a camera-facing billboard (expanded in view space, so no per-frame quaternion work),
 *   additive. Near the star it is a corona falling off as (r/R)^−2.5; once the disk shrinks below a
 *   few pixels it becomes a fixed point-spread glow of at least MIN_GLOW_PX, so the star stays
 *   visible from anywhere in its system.
 */
import {
  AdditiveBlending,
  Color,
  GLSL3,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Uniform,
} from 'three';
import { saturateRGB } from '../../core/color';
import type { StarDetails } from '../../core/types';
import type { IStarVisual, Quality, StarVisualOptions, VisualFrame } from '../contracts';
import { common } from '../shaders/common.glsl';
import { simplex } from '../shaders/noise.glsl';

/** Minimum glow radius on screen, CSS px. */
const MIN_GLOW_PX = 26;
/** Corona extent in stellar radii. */
const GLOW_RADII = 7;
const PHOTOSPHERE_BRIGHTNESS = 14;
const SEGMENTS: Readonly<Record<Quality, number>> = { low: 32, medium: 48, high: 64, ultra: 96 };

const photosphereVertex = /* glsl */ `
out vec3 vNormalW;
out vec3 vViewW;
out vec3 vObj;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormalW = mat3(modelMatrix) * normal;
  vViewW = -world.xyz; // the layer camera sits at the origin
  vObj = position;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const photosphereFragment = /* glsl */ `
${common}
${simplex}
uniform vec3 uColor;
uniform float uBrightness;
uniform float uIntensity;
uniform float uTime;
uniform float uSeed;

in vec3 vNormalW;
in vec3 vViewW;
in vec3 vObj;
out vec4 fragColor;

void main() {
  float mu = saturate(dot(normalize(vNormalW), normalize(vViewW)));
  float x = 1.0 - mu;
  float limb = 1.0 - 0.47 * x - 0.23 * x * x;
  vec3 p = vObj * 18.0 + uSeed;
  float gran = snoise(vec4(p, uTime * 0.04)) * 0.6 + snoise(vec4(p * 2.3, uTime * 0.07)) * 0.4;
  // The limb is cooler: tint it slightly towards red.
  vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(1.0), smoothstep(0.0, 0.6, mu));
  vec3 c = uColor * tint * (uBrightness * limb * (0.93 + 0.07 * gran));
  fragColor = vec4(c * uIntensity, 1.0);
}
`;

const glowVertex = /* glsl */ `
uniform float uGlowRadius;
out vec2 vUv;

void main() {
  // Billboard: expand the quad in view space around the star centre.
  vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vUv = position.xy;
  gl_Position = projectionMatrix * (centre + vec4(position.xy * uGlowRadius, 0.0, 0.0));
}
`;

const glowFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uCoreRadius;  // stellar radius in glow-quad units
uniform float uFar;         // 0 = resolved disk (corona), 1 = point-like (PSF)
uniform float uBrightness;
uniform float uIntensity;
uniform float uRing;        // > 0: accretion ring (black holes)

in vec2 vUv;
out vec4 fragColor;

void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float taper = 1.0 - smoothstep(0.55, 1.0, r);
  float corona = pow(max(r / uCoreRadius, 1.0), -2.5);
  float psf = exp(-r * r * 60.0) * 2.5 + exp(-r * r * 9.0) * 0.35 + exp(-r * 4.5) * 0.08;
  float intensity = mix(corona, psf, uFar);
  if (uRing > 0.0) {
    float x = r / uCoreRadius;
    intensity = uRing * (exp(-pow((x - 3.2) / 0.9, 2.0)) * 2.0 + corona * 0.3) * (1.0 - uFar) + psf * uFar * uRing;
  }
  fragColor = vec4(uColor * (uBrightness * intensity * taper * uIntensity), 1.0);
}
`;

export class StarVisual implements IStarVisual {
  readonly object = new Group();
  private readonly star: StarDetails;
  private readonly photosphere: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly glow: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly glowUniforms = {
    uColor: new Uniform(new Color()),
    uGlowRadius: new Uniform(1),
    uCoreRadius: new Uniform(0.1),
    uFar: new Uniform(1),
    uBrightness: new Uniform(1),
    uIntensity: new Uniform(1),
    uRing: new Uniform(0),
  };
  private readonly sphereUniforms = {
    uColor: new Uniform(new Color()),
    uBrightness: new Uniform(PHOTOSPHERE_BRIGHTNESS),
    uIntensity: new Uniform(1),
    uTime: new Uniform(0),
    uSeed: new Uniform(0),
  };

  constructor(star: StarDetails, quality: Quality) {
    this.star = star;
    this.object.name = `StarVisual:${star.id}`;
    const rgb = saturateRGB(star.colorRGB, 1.25);
    const isHole = star.kind === 'black-hole';

    this.sphereUniforms.uColor.value.setRGB(rgb[0], rgb[1], rgb[2]);
    this.sphereUniforms.uBrightness.value = isHole ? 0 : PHOTOSPHERE_BRIGHTNESS;
    this.sphereUniforms.uSeed.value = (star.seed % 1000) / 10;
    const segments = SEGMENTS[quality];
    this.photosphere = new Mesh(
      new SphereGeometry(1, segments, segments / 2),
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: photosphereVertex,
        fragmentShader: photosphereFragment,
        uniforms: this.sphereUniforms,
        toneMapped: false,
      }),
    );
    this.photosphere.scale.setScalar(star.radiusKm);
    this.photosphere.name = 'photosphere';

    this.glowUniforms.uColor.value.setRGB(rgb[0], rgb[1], rgb[2]);
    this.glowUniforms.uRing.value = isHole ? (star.accretion ?? 0.5) : 0;
    this.glow = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        uniforms: this.glowUniforms,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.glow.name = 'glow';
    this.glow.frustumCulled = false; // the billboard is expanded in the shader
    this.glow.renderOrder = 1;
    this.object.add(this.photosphere, this.glow);
  }

  update(frame: VisualFrame, o: StarVisualOptions): void {
    this.object.position.copy(o.positionKm);
    this.object.visible = o.intensity > 0.001;
    if (!this.object.visible) return;

    const radius = this.star.radiusKm;
    const dist = Math.max(o.positionKm.length(), radius * 1.001);
    const fovY = (frame.camera.fov * Math.PI) / 180;
    const kmPerPx = (2 * dist * Math.tan(fovY / 2)) / frame.height;
    const diskPx = radius / kmPerPx;
    const glowRadius = Math.max(radius * GLOW_RADII, MIN_GLOW_PX * kmPerPx);

    const g = this.glowUniforms;
    g.uGlowRadius.value = glowRadius;
    g.uCoreRadius.value = radius / glowRadius;
    // Resolved disk (> 12 px): corona only; sub-2-px disk: PSF only.
    const t = Math.min(1, Math.max(0, (diskPx - 2) / 10));
    g.uFar.value = 1 - t * t * (3 - 2 * t);
    g.uBrightness.value = this.star.kind === 'black-hole' ? 3 : 4;
    g.uIntensity.value = o.intensity;

    this.sphereUniforms.uIntensity.value = o.intensity;
    this.sphereUniforms.uTime.value = frame.timeSec;
  }

  dispose(): void {
    this.photosphere.geometry.dispose();
    this.photosphere.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
  }
}
