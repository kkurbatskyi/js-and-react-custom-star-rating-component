/**
 * OrbitLines — STUB (integration phase). The system specialist replaces the internals; the public
 * API (`IOrbitLines`) stays.
 *
 * One closed polyline per planet from `orbitPathKm` (frame S, km), under a group positioned at the
 * camera-relative star centre and rotated by `eclipticToWorld`. Additive, faint blue-grey; the
 * highlighted planet's orbit (or a highlighted moon's parent's) turns stellar gold. Lines fade out
 * near the focused body — within a radius proportional to the camera's distance from it — so
 * they never slice across a planet you are looking at (and float32/chord error stays invisible).
 * Moon orbits are not drawn yet.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  Group,
  Line,
  ShaderMaterial,
  Uniform,
  Vector3,
} from 'three';
import type { Planet, StarSystem } from '../../core/types';
import { orbitPathKm } from '../../sim/kepler';
import type { IOrbitLines, OrbitLinesOptions, Quality, VisualFrame } from '../contracts';

const SEGMENTS: Readonly<Record<Quality, number>> = {
  low: 128,
  medium: 256,
  high: 384,
  ultra: 512,
};
const BASE_COLOR = new Color(0.34, 0.5, 0.72);
const HIGHLIGHT_COLOR = new Color(1, 0.78, 0.42);
const BASE_ALPHA = 0.42;
const HIGHLIGHT_ALPHA = 0.9;

const vertexShader = /* glsl */ `
out vec3 vWorld;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uFocus;
uniform float uFadeNear;
uniform float uFadeFar;

in vec3 vWorld;
out vec4 fragColor;

void main() {
  float fade = uFadeFar > 0.0 ? smoothstep(uFadeNear, uFadeFar, distance(vWorld, uFocus)) : 1.0;
  fragColor = vec4(uColor * (uOpacity * fade), 1.0); // additive
}
`;

interface OrbitLine {
  planet: Planet;
  line: Line<BufferGeometry, ShaderMaterial>;
}

export class OrbitLines implements IOrbitLines {
  readonly object = new Group();
  private readonly lines: OrbitLine[] = [];
  private readonly focus = new Vector3();

  constructor(system: StarSystem, quality: Quality) {
    this.object.name = `OrbitLines:${system.id}`;
    for (const planet of system.planets) {
      const geometry = new BufferGeometry();
      // `segments + 1` vertices with the last repeating the first: a closed THREE.Line.
      geometry.setAttribute(
        'position',
        new BufferAttribute(orbitPathKm(planet.orbit, SEGMENTS[quality]), 3),
      );
      geometry.computeBoundingSphere();
      const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: {
          uColor: new Uniform(BASE_COLOR.clone()),
          uOpacity: new Uniform(BASE_ALPHA),
          uFocus: new Uniform(this.focus),
          uFadeNear: new Uniform(0),
          uFadeFar: new Uniform(0),
        },
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      const line = new Line(geometry, material);
      line.name = `orbit:${planet.id}`;
      this.lines.push({ planet, line });
      this.object.add(line);
    }
  }

  update(_frame: VisualFrame, o: OrbitLinesOptions): void {
    this.object.position.copy(o.starPositionKm);
    this.object.quaternion.copy(o.eclipticToWorld);
    this.object.visible = o.opacity > 0.001;
    if (!this.object.visible) return;
    const focusDist = o.focusPositionKm ? o.focusPositionKm.length() : 0;
    if (o.focusPositionKm) this.focus.copy(o.focusPositionKm);
    for (const { planet, line } of this.lines) {
      const u = line.material.uniforms;
      const hit =
        o.highlightId !== null &&
        (o.highlightId === planet.id || o.highlightId.startsWith(`${planet.id}.`));
      (u.uColor.value as Color).copy(hit ? HIGHLIGHT_COLOR : BASE_COLOR);
      u.uOpacity.value = o.opacity * (hit ? HIGHLIGHT_ALPHA : BASE_ALPHA);
      u.uFadeNear.value = focusDist * 0.15;
      u.uFadeFar.value = focusDist * 0.9;
    }
  }

  dispose(): void {
    for (const { line } of this.lines) {
      line.geometry.dispose();
      line.material.dispose();
    }
  }
}
