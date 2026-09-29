/**
 * PlanetVisual — STUB (integration phase). The planet-surface specialist replaces the internals
 * (baked cube-map surfaces etc.); the public API (`IPlanetVisual`) stays.
 *
 * A sphere scaled to `radiusKm` and flattened by `oblateness`, shaded procedurally from the
 * generator's `appearance` hints: palette-mapped fBm terrain, oceans with a Blinn–Phong glint,
 * polar ice, craters, latitude bands for giants, lava glow and night-side city lights, and a soft
 * terminator that widens with atmosphere. Until the clouds module exists the cloud cover is
 * folded into the surface shader. Composes `createAtmosphere`, `createClouds` and `createRings`
 * ('lite' skips atmosphere and clouds).
 *
 * The root group carries position (camera-relative km) and orientation (body-fixed → world);
 * sub-components are its children and work in body-fixed km. `intensity` scales brightness (the
 * surface is opaque — never alpha). No GPU bakes, so `ready` is true from the start.
 */
import {
  Color,
  GLSL3,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Uniform,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { BodyBase, StarSystem } from '../../core/types';
import {
  type IAtmosphereShell,
  type ICloudLayer,
  type IPlanetVisual,
  type IRingVisual,
  type PlanetDetail,
  type PlanetUniforms,
  type Quality,
  RENDER_ORDER,
  type VisualFrame,
} from '../contracts';
import { common } from '../shaders/common.glsl';
import { noise } from '../shaders/noise.glsl';
import { createAtmosphere } from './atmosphere';
import { createClouds } from './clouds';
import { createRings } from './rings';

const MAX_COLORS = 5;
const SEGMENTS: Readonly<Record<Quality, number>> = { low: 64, medium: 96, high: 128, ultra: 192 };
const LITE_SEGMENTS = 32;

const vertexShader = /* glsl */ `
out vec3 vObj;
out vec3 vNormalW;
out vec3 vViewW;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vObj = position;
  // Inverse-transpose: the mesh is non-uniformly scaled by the polar flattening.
  vNormalW = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  vViewW = -world.xyz; // the layer camera sits at the origin
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${common}
${noise}
#define MAX_COLORS ${MAX_COLORS}
uniform vec3 uColors[MAX_COLORS];
uniform int uColorCount;
uniform int uBanded;
uniform vec3 uSeed;
uniform float uOcean;
uniform vec3 uOceanColor;
uniform float uIce;
uniform float uCraters;
uniform float uCloudCoverage;
uniform vec3 uCloudColor;
uniform float uCloudPhase;
uniform float uLavaGlow;
uniform float uNightLights;
uniform float uHaze;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uIntensity;

in vec3 vObj;
in vec3 vNormalW;
in vec3 vViewW;
out vec4 fragColor;

/** Piecewise-linear ramp through the first uColorCount palette colours. */
vec3 palette(float t) {
  float x = clamp(t, 0.0, 0.999) * float(max(uColorCount - 1, 1));
  int i = int(floor(x));
  vec3 a = uColors[0];
  vec3 b = uColors[0];
  for (int k = 0; k < MAX_COLORS; k++) {
    if (k == i) a = uColors[k];
    if (k == i + 1 && k < uColorCount) b = uColors[k];
  }
  return mix(a, b, smoothstep(0.0, 1.0, fract(x)));
}

void main() {
  vec3 p = normalize(vObj);
  vec3 albedo;
  float land = 0.0;   // solid ground (city lights)
  float water = 0.0;
  float lava = 0.0;
  if (uBanded == 1) {
    float turb = fbm(p * vec3(2.0, 9.0, 2.0) + uSeed, OCTAVES);
    float lat = p.y + 0.07 * turb;
    albedo = palette(0.5 + 0.5 * sin(lat * 17.0 + uSeed.x) * cos(lat * 6.0 + uSeed.y));
  } else {
    float h = fbm(p * 2.3 + uSeed, OCTAVES);
    float detail = fbm(p * 9.0 + uSeed.zxy, 3);
    albedo = palette(saturate(0.5 + 0.9 * detail + 0.3 * h));
    land = 1.0;
    if (uCraters > 0.05) {
      vec2 w = worley(p * 7.0 + uSeed, 1.0);
      albedo *= 1.0 - 0.4 * uCraters * smoothstep(0.3, 0.0, w.x);
    }
    float seaLevel = (uOcean - 0.5) * 0.75;
    if (uOcean > 0.0 && h < seaLevel) {
      water = 1.0;
      land = 0.0;
      albedo = uOceanColor * (0.75 + 0.5 * smoothstep(seaLevel - 0.35, seaLevel, h));
    }
    if (uLavaGlow > 0.0) {
      float cracks = 1.0 - abs(fbm(p * 6.0 + uSeed.yzx, 4));
      lava = uLavaGlow * max(smoothstep(0.8, 0.96, cracks), water);
    }
    if (uIce > 0.0) {
      float iceLine = 1.0 - min(uIce * 1.4, 1.0);
      float ice = smoothstep(iceLine - 0.03, iceLine + 0.03, abs(p.y) + 0.12 * detail);
      albedo = mix(albedo, vec3(0.85, 0.88, 0.92), ice);
      land *= 1.0 - ice;
    }
  }

  float cloud = 0.0;
  if (uCloudCoverage > 0.0) {
    vec3 q = p * 3.0 + uSeed.yxz + vec3(uCloudPhase, 0.0, 0.0);
    float c = fbm(q + 0.6 * fbm(q * 2.0, 3), OCTAVES) * 0.5 + 0.5;
    cloud = uCloudCoverage >= 0.999
      ? 0.8 + 0.2 * c
      : smoothstep(1.0 - uCloudCoverage, 1.25 - uCloudCoverage, c);
    albedo = mix(albedo, uCloudColor, cloud);
  }

  vec3 n = normalize(vNormalW);
  float ndl = dot(n, uSunDir);
  float wrap = mix(0.02, 0.2, uHaze);
  float diffuse = saturate((ndl + wrap) / (1.0 + wrap));
  vec3 col = albedo * uSunColor * (uSunIntensity * diffuse);
  if (water > 0.0) {
    vec3 h = normalize(uSunDir + normalize(vViewW));
    float spec = pow(max(dot(n, h), 0.0), 90.0) * step(0.0, ndl);
    col += uSunColor * (uSunIntensity * 1.5 * spec * (1.0 - cloud));
  }
  float night = 1.0 - smoothstep(-0.08, 0.12, ndl);
  col += vec3(1.0, 0.36, 0.08) * (2.6 * lava * (0.35 + 0.65 * night) * (1.0 - 0.7 * cloud));
  if (uNightLights > 0.0) {
    float cities = smoothstep(0.62, 0.8, fbm(p * 22.0 + uSeed, 3) * 0.5 + 0.5) * land;
    col += vec3(1.0, 0.72, 0.4) * (1.6 * uNightLights * cities * night * (1.0 - cloud));
  }
  fragColor = vec4(col * uIntensity, 1.0);
}
`;

export class PlanetVisual implements IPlanetVisual {
  readonly object = new Group();
  readonly body: BodyBase;
  readonly detail: PlanetDetail;
  readonly ready = true;
  private readonly surface: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly atmosphere: IAtmosphereShell | null;
  private readonly clouds: ICloudLayer | null;
  private readonly rings: IRingVisual | null;
  private readonly uniforms = {
    uColors: new Uniform(Array.from({ length: MAX_COLORS }, () => new Color())),
    uColorCount: new Uniform(1),
    uBanded: new Uniform(0),
    uSeed: new Uniform(new Vector3()),
    uOcean: new Uniform(0),
    uOceanColor: new Uniform(new Color()),
    uIce: new Uniform(0),
    uCraters: new Uniform(0),
    uCloudCoverage: new Uniform(0),
    uCloudColor: new Uniform(new Color()),
    uCloudPhase: new Uniform(0),
    uLavaGlow: new Uniform(0),
    uNightLights: new Uniform(0),
    uHaze: new Uniform(0),
    uSunDir: new Uniform(new Vector3(1, 0, 0)),
    uSunColor: new Uniform(new Color(1, 1, 1)),
    uSunIntensity: new Uniform(1),
    uIntensity: new Uniform(1),
  };

  constructor(
    body: BodyBase,
    ctx: { system: StarSystem },
    quality: Quality,
    detail: PlanetDetail = 'full',
  ) {
    this.body = body;
    this.detail = detail;
    this.object.name = `PlanetVisual:${body.id}`;

    const a = body.appearance;
    const u = this.uniforms;
    const colors = a.surfaceColors.length > 0 ? a.surfaceColors : [a.swatch];
    colors.slice(0, MAX_COLORS).forEach((c, i) => u.uColors.value[i].setRGB(c[0], c[1], c[2]));
    u.uColorCount.value = Math.min(colors.length, MAX_COLORS);
    u.uBanded.value = body.type === 'gas-giant' || body.type === 'ice-giant' ? 1 : 0;
    u.uSeed.value.set(
      (body.seed % 1009) / 10.09,
      ((body.seed >>> 10) % 1013) / 10.13,
      ((body.seed >>> 20) % 1019) / 10.19,
    );
    u.uOcean.value = a.oceanColor ? body.oceanCoverage : 0;
    if (a.oceanColor) u.uOceanColor.value.setRGB(a.oceanColor[0], a.oceanColor[1], a.oceanColor[2]);
    u.uIce.value = body.type === 'ice' ? 0 : body.iceCoverage; // ice worlds are ice in their palette
    u.uCraters.value = body.craterDensity;
    u.uCloudCoverage.value = a.cloudCoverage;
    u.uCloudColor.value.setRGB(a.cloudColor[0], a.cloudColor[1], a.cloudColor[2]);
    u.uLavaGlow.value = a.lavaGlow;
    u.uNightLights.value = a.nightLights;
    u.uHaze.value = Math.min(1, Math.log10(1 + 9 * (body.atmosphere?.surfacePressureAtm ?? 0)));

    const segments = detail === 'full' ? SEGMENTS[quality] : LITE_SEGMENTS;
    this.surface = new Mesh(
      new SphereGeometry(1, segments, segments / 2),
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: this.uniforms,
        defines: { OCTAVES: detail === 'full' ? 5 : 3 },
        toneMapped: false,
      }),
    );
    this.surface.scale.set(body.radiusKm, body.radiusKm * (1 - body.oblateness), body.radiusKm);
    this.surface.renderOrder = RENDER_ORDER.surface;
    this.surface.name = 'surface';
    this.object.add(this.surface);

    const system = ctx.system;
    this.atmosphere = detail === 'full' ? createAtmosphere(body, system, quality) : null;
    this.clouds = detail === 'full' ? createClouds(body, system, quality) : null;
    this.rings = createRings(body, system, quality);
    for (const part of [this.atmosphere, this.clouds, this.rings])
      if (part) this.object.add(part.object);
  }

  prepare(_renderer: WebGLRenderer, _budgetMs: number): boolean {
    return true; // nothing to bake in the stub
  }

  update(frame: VisualFrame, u: PlanetUniforms): void {
    this.object.position.copy(u.positionKm);
    this.object.quaternion.copy(u.orientation);
    this.object.visible = u.intensity > 0.001;
    if (!this.object.visible) return;
    const un = this.uniforms;
    un.uSunDir.value.copy(u.sunDirection);
    un.uSunColor.value.copy(u.sunColor);
    un.uSunIntensity.value = u.sunIntensity;
    un.uIntensity.value = u.intensity;
    un.uCloudPhase.value = (frame.timeSec * 0.004) % 1000; // animation clock, never raw simDays
    this.atmosphere?.update(frame, u);
    this.clouds?.update(frame, u);
    this.rings?.update(frame, u);
  }

  dispose(): void {
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.atmosphere?.dispose();
    this.clouds?.dispose();
    this.rings?.dispose();
  }
}
