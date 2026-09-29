/**
 * GalaxyVisual — STUB (integration phase). The galaxy specialist replaces the internals; the
 * public API (`IGalaxyVisual`) stays.
 *
 * One additive `THREE.Points` cloud sampled from `GalaxyModel.samplePosition` (∝ stellar light).
 * Each particle is a soft Gaussian "star cloud" of fixed WORLD size, so surface brightness is
 * distance-independent like real extended sources; sub-pixel sprites are clamped to ~1.5 px and
 * dimmed by the area ratio to conserve flux. Colour = population blackbody (old bulge ≈ 4200 K →
 * disk ≈ 5600 K → young arms ≈ 14 000 K) with a 1.3× saturation boost, a sprinkle of pink HII
 * knots in the arms, and dust dimming (exp(−k·dust)) that carves dark lanes.
 *
 * Camera-relative: the object sits at −cameraLy each frame (float64 on the CPU); particle
 * positions stay galaxy-centred float32. Particles closer than `nearFadeLy` fade out.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  Points,
  ShaderMaterial,
  Uniform,
} from 'three';
import { blackbodyRGBInto } from '../../core/color';
import { createRng } from '../../core/rng';
import type { GalaxyModel } from '../../core/types';
import type { GalaxyVisualOptions, IGalaxyVisual, Quality, VisualFrame } from '../contracts';

/** Particle budget per quality (stub values; ARCHITECTURE §8 lists the final budgets). */
const PARTICLES: Readonly<Record<Quality, number>> = {
  low: 60_000,
  medium: 100_000,
  high: 150_000,
  ultra: 200_000,
};
/** Brightness and size are normalised to this count, so every quality looks alike. */
const REFERENCE_COUNT = 150_000;
/** Largest sprite, CSS px (GPUs cap gl_PointSize; huge sprites also cost fill rate). */
const MAX_SPRITE_PX = 160;

const vertexShader = /* glsl */ `
uniform float uPixelsPerRadian;
uniform float uNearFade;
uniform float uIntensity;
uniform float uMaxPointPx;

in vec3 aColor;
in float aSize;

out vec3 vColor;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = length(mv.xyz);
  float fade = smoothstep(0.35 * uNearFade, uNearFade, dist);
  // World size → device pixels (distance, not depth, so sprites don't swell at the screen edge).
  float px = aSize * uPixelsPerRadian / max(dist, 1e-3);
  float drawPx = clamp(px, 1.5, uMaxPointPx);
  // Conserve flux for sub-pixel sprites; never brighten clamped close-ups.
  float area = min(1.0, (px * px) / (drawPx * drawPx));
  vColor = aColor * (uIntensity * fade * area);
  gl_PointSize = drawPx;
  if (fade <= 0.0 || uIntensity <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull
}
`;

const fragmentShader = /* glsl */ `
in vec3 vColor;
out vec4 fragColor;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  fragColor = vec4(vColor * exp(-4.0 * r2), 1.0);
}
`;

/** Pink Hα of HII regions (linear sRGB). */
const HII: readonly [number, number, number] = [1, 0.32, 0.5];

function buildGeometry(model: GalaxyModel, count: number): BufferGeometry {
  const rng = createRng(model.params.seed).fork('galaxy-visual-stub');
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const p: [number, number, number] = [0, 0, 0];
  // Fewer particles → proportionally bigger, same radiance: total flux n·s² stays constant.
  const sizeScale = Math.sqrt(REFERENCE_COUNT / count);
  for (let i = 0; i < count; i++) {
    model.samplePosition(rng, p);
    const [x, y, z] = p;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const bulge = model.bulgeFraction(x, y, z);
    const young = model.youngFraction(x, y, z);
    const dust = model.dustDensity(x, y, z);
    const o = i * 3;
    let size = rng.range(700, 1800);
    let brightness = rng.range(0.5, 1.1);
    if (young > 0.35 && rng.chance(0.03 * young)) {
      // HII knot: small, bright, pink.
      colors[o] = HII[0];
      colors[o + 1] = HII[1];
      colors[o + 2] = HII[2];
      size = rng.range(160, 320);
      brightness = 14;
    } else {
      const disk = 5600 + (4200 - 5600) * bulge;
      blackbodyRGBInto(disk + (14_000 - disk) * young * young, colors, o);
      // Blackbody colours are pale: boost chroma about the luminance axis (ARCHITECTURE §9).
      const lum = 0.2126 * colors[o] + 0.7152 * colors[o + 1] + 0.0722 * colors[o + 2];
      for (let c = 0; c < 3; c++) colors[o + c] = Math.max(0, lum + (colors[o + c] - lum) * 1.3);
      if (rng.chance(0.04)) {
        // Compact star clouds give the disk some grain.
        size *= 0.2;
        brightness *= 12;
      }
    }
    brightness *= Math.exp(-2.2 * dust); // dust lanes
    const k = 0.011 * brightness;
    colors[o] *= k;
    colors[o + 1] *= k;
    colors[o + 2] *= k;
    sizes[i] = size * sizeScale;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  return geometry;
}

export class GalaxyVisual implements IGalaxyVisual {
  readonly object: Points<BufferGeometry, ShaderMaterial>;
  private readonly model: GalaxyModel;
  private quality: Quality;
  private readonly uniforms = {
    uPixelsPerRadian: new Uniform(1000),
    uNearFade: new Uniform(0),
    uIntensity: new Uniform(1),
    uMaxPointPx: new Uniform(MAX_SPRITE_PX),
  };

  constructor(model: GalaxyModel, quality: Quality) {
    this.model = model;
    this.quality = quality;
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.object = new Points(buildGeometry(model, PARTICLES[quality]), material);
    this.object.name = 'GalaxyVisual';
    this.object.frustumCulled = false; // the camera usually sits inside the cloud
  }

  setQuality(q: Quality): void {
    if (PARTICLES[q] === PARTICLES[this.quality]) {
      this.quality = q;
      return;
    }
    this.quality = q;
    const old = this.object.geometry;
    this.object.geometry = buildGeometry(this.model, PARTICLES[q]);
    old.dispose();
  }

  update(frame: VisualFrame, o: GalaxyVisualOptions): void {
    this.object.position.set(-o.cameraLy.x, -o.cameraLy.y, -o.cameraLy.z);
    const fovY = (frame.camera.fov * Math.PI) / 180;
    const u = this.uniforms;
    u.uPixelsPerRadian.value = (frame.height * frame.pixelRatio) / (2 * Math.tan(fovY / 2));
    u.uMaxPointPx.value = MAX_SPRITE_PX * frame.pixelRatio;
    u.uNearFade.value = o.nearFadeLy;
    u.uIntensity.value = o.intensity;
    this.object.visible = o.intensity > 0;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
