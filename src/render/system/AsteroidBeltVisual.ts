/**
 * AsteroidBeltVisual — STUB (integration phase). The system specialist replaces the internals;
 * the public API (`IAsteroidBeltVisual`) stays.
 *
 * A static ring of point sprites in frame S (km) under a group positioned at the camera-relative
 * star centre and rotated by `eclipticToWorld`. Radii follow a triangular distribution peaking
 * mid-belt, heights a Gaussian of σ = thickness/4; each rock has its own size and albedo.
 * Constant pixel size (rocks are always sub-pixel at system scale), additive and faint.
 * Known limit: rocks do not orbit yet (the belt does not know its star's mass).
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, GLSL3, Points, ShaderMaterial, Uniform } from 'three';
import { TAU } from '../../core/math';
import { createRng } from '../../core/rng';
import type { AsteroidBelt, RGB } from '../../core/types';
import type { IAsteroidBeltVisual, Quality, SystemFurnitureOptions, VisualFrame } from '../contracts';

const COUNT_SCALE: Readonly<Record<Quality, number>> = { low: 0.35, medium: 0.6, high: 1, ultra: 1.5 };
const MAX_ROCKS = 20_000;
const COLORS: Readonly<Record<AsteroidBelt['composition'], RGB>> = {
  rock: [0.55, 0.47, 0.4],
  metal: [0.6, 0.6, 0.62],
  ice: [0.62, 0.7, 0.8],
};

const vertexShader = /* glsl */ `
uniform float uPixelRatio;
uniform float uOpacity;
uniform vec3 uColor;

in float aSize;
in float aAlbedo;
out vec3 vColor;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  vColor = uColor * (aAlbedo * uOpacity);
}
`;

const fragmentShader = /* glsl */ `
in vec3 vColor;
out vec4 fragColor;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  fragColor = vec4(vColor * (1.0 - r2), 1.0);
}
`;

export class AsteroidBeltVisual implements IAsteroidBeltVisual {
  readonly object: Points<BufferGeometry, ShaderMaterial>;
  private readonly uniforms = {
    uPixelRatio: new Uniform(1),
    uOpacity: new Uniform(1),
    uColor: new Uniform(new Color()),
  };

  constructor(belt: AsteroidBelt, quality: Quality) {
    const n = Math.min(MAX_ROCKS, Math.round(belt.count * COUNT_SCALE[quality]));
    const rng = createRng(belt.seed).fork('belt-visual-stub');
    const positions = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const albedo = new Float32Array(n);
    const width = belt.outerRadiusKm - belt.innerRadiusKm;
    for (let i = 0; i < n; i++) {
      const r = belt.innerRadiusKm + width * 0.5 * (rng.next() + rng.next()); // triangular
      const theta = rng.range(0, TAU);
      positions[i * 3] = r * Math.cos(theta);
      positions[i * 3 + 1] = Math.max(-2, Math.min(2, rng.normal())) * belt.thicknessKm * 0.25;
      positions[i * 3 + 2] = r * Math.sin(theta);
      sizes[i] = rng.chance(0.04) ? rng.range(2.2, 3) : rng.range(1.1, 1.9);
      albedo[i] = rng.range(0.25, 0.6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlbedo', new BufferAttribute(albedo, 1));
    geometry.computeBoundingSphere();
    const [cr, cg, cb] = COLORS[belt.composition];
    this.uniforms.uColor.value.setRGB(cr, cg, cb);
    this.object = new Points(
      geometry,
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: this.uniforms,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.object.name = 'AsteroidBeltVisual';
  }

  update(frame: VisualFrame, o: SystemFurnitureOptions): void {
    this.object.position.copy(o.starPositionKm);
    this.object.quaternion.copy(o.eclipticToWorld);
    this.object.visible = o.opacity > 0.001;
    this.uniforms.uOpacity.value = o.opacity;
    this.uniforms.uPixelRatio.value = frame.pixelRatio;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
