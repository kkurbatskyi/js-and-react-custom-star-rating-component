/**
 * The galaxy's particle layer: one additive `THREE.Points` draw of the particles from
 * ./particles.ts, galaxy-centred (the object is offset by −cameraLy each frame, float64 on the
 * CPU). Shading: ./particles.glsl.ts.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  Points,
  ShaderMaterial,
  Uniform,
  Vector3,
} from 'three';
import type { GalaxyStructure } from '../../gen/galaxy/structure';
import type { VisualFrame } from '../contracts';
import { particleFragment, particleVertex } from './particles.glsl';
import { type GalaxyParticleData, generateGalaxyParticles, type ParticleOptions } from './particles';
import type { GalaxyFieldUniforms } from './uniforms';

function buildGeometry(data: GalaxyParticleData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('aRadiance', new BufferAttribute(data.radiance, 3));
  geometry.setAttribute('aSigma', new BufferAttribute(data.sigma, 1));
  geometry.setAttribute('aKind', new BufferAttribute(data.kind, 1));
  return geometry;
}

export class GalaxyParticles {
  readonly object: Points<BufferGeometry, ShaderMaterial>;
  readonly uniforms = {
    uCameraLy: new Uniform(new Vector3()),
    uPixelsPerRadian: new Uniform(1000),
    uNearFade: new Uniform(0),
    uMinSigmaPx: new Uniform(0.75),
    uMaxSigmaPx: new Uniform(24),
    uEmission: new Uniform(0),
    uKindGain: new Uniform(new Vector3(1, 1, 1)),
    uLosSamples: new Uniform(6),
  };
  private readonly structure: GalaxyStructure;

  constructor(
    structure: GalaxyStructure,
    fields: GalaxyFieldUniforms,
    count: number,
    options: ParticleOptions,
  ) {
    this.structure = structure;
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: { ...fields, ...this.uniforms },
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.object = new Points(
      buildGeometry(generateGalaxyParticles(structure, count, options)),
      material,
    );
    this.object.name = 'GalaxyParticles';
    this.object.frustumCulled = false; // the camera usually sits inside the cloud
  }

  get count(): number {
    return this.object.geometry.getAttribute('position').count;
  }

  /** Regenerate (quality or particle-option change). */
  rebuild(count: number, options: ParticleOptions): void {
    const old = this.object.geometry;
    this.object.geometry = buildGeometry(generateGalaxyParticles(this.structure, count, options));
    old.dispose();
  }

  update(frame: VisualFrame, cameraLy: Vector3): void {
    this.object.position.set(-cameraLy.x, -cameraLy.y, -cameraLy.z);
    this.uniforms.uCameraLy.value.copy(cameraLy);
    const p = frame.camera.projectionMatrix.elements[5] ?? 1; // 1 / tan(fovY / 2) (with zoom)
    // Device px per radian; the drawing buffer is height × pixelRatio tall.
    this.uniforms.uPixelsPerRadian.value = 0.5 * frame.height * frame.pixelRatio * p;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
