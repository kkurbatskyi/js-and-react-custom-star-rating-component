/**
 * Ring material parameters by composition, the uniform vector shared with the planet surface shaders,
 * and the annulus geometry.
 */
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { RGB, RingSystem } from '../../../core/types';

export interface RingMaterialParams {
  /** Base albedo colour of the particles (linear). */
  color: RGB;
  /** Henyey-Greenstein asymmetry of the forward lobe (light scattered towards where it was going). */
  phaseForward: number;
  /** Asymmetry magnitude of the backscatter lobe. */
  phaseBackward: number;
  /** Share of the backscatter lobe in the phase function. */
  backwardWeight: number;
  /** Opposition surge amplitude (Seeliger effect): the ring flares when the sun is behind the viewer. */
  surge: number;
  /** Multiple-scattering gain: bright icy particles scatter many times in a dense layer. */
  multiScatter: number;
}

/**
 * Ice: bright, warm white, moderately forward scattering (Saturn's B ring, I/F ~ 0.5 at low phase).
 * Rock: dark brown, weakly forward. Dust: micron grains, very strongly forward scattering, so a faint dusty
 * ring is nearly invisible front-lit and glows when the sun is behind it (Jupiter's and Uranus's rings).
 */
const MATERIALS: Readonly<Record<RingSystem['composition'], RingMaterialParams>> = {
  ice: {
    color: [0.94, 0.9, 0.82],
    phaseForward: 0.55,
    phaseBackward: 0.35,
    backwardWeight: 0.38,
    surge: 0.8,
    multiScatter: 1.6,
  },
  rock: {
    color: [0.46, 0.38, 0.3],
    phaseForward: 0.35,
    phaseBackward: 0.25,
    backwardWeight: 0.5,
    surge: 0.5,
    multiScatter: 0.5,
  },
  dust: {
    color: [0.62, 0.52, 0.44],
    phaseForward: 0.78,
    phaseBackward: 0.2,
    backwardWeight: 0.15,
    surge: 0.2,
    multiScatter: 0.3,
  },
};

export function deriveRingMaterial(rings: RingSystem): RingMaterialParams {
  return MATERIALS[rings.composition];
}

/** Seed phase fed to the GLSL structure functions (`ringProfile.glsl.ts`). */
export function ringSeedPhase(rings: Pick<RingSystem, 'seed'>): number {
  return (rings.seed % 997) / 97;
}

/**
 * The `vec4` the planet's surface shaders use to receive ring shadows:
 * (inner radius km, outer radius km, peak optical depth, seed phase).
 */
export function ringUniformVector(rings: RingSystem): [number, number, number, number] {
  return [rings.innerRadiusKm, rings.outerRadiusKm, rings.opticalDepth, ringSeedPhase(rings)];
}

/** Radial margin of the coverage mesh around [inner, outer]; the fragment shader trims to the true edges. */
export const RING_MESH_MARGIN = 0.02;

/**
 * Flat annulus in the XZ plane (body-fixed equatorial plane, normal +Y), positions in km. Slightly larger
 * than the ring on both sides so the polygonal outline never clips it.
 */
export function createRingGeometry(
  innerKm: number,
  outerKm: number,
  segments: number,
): BufferGeometry {
  const r0 = innerKm * (1 - RING_MESH_MARGIN);
  const r1 = outerKm * (1 + RING_MESH_MARGIN);
  const positions = new Float32Array(segments * 2 * 3);
  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.set([c * r0, 0, s * r0, c * r1, 0, s * r1], i * 6);
    const n = (i + 1) % segments;
    const a0 = i * 2;
    const b0 = i * 2 + 1;
    const a1 = n * 2;
    const b1 = n * 2 + 1;
    index.push(a0, b0, b1, a0, b1, a1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}
