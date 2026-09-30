/**
 * The galaxy's planar map: a mipmapped RGBA16F texture over ±MAP_EXTENT disk radii holding the
 * arm factor, the midplane dust (both exactly the CPU model's), a star-formation ridge density and
 * a filament noise (see ./fields.glsl.ts). Baked once on the GPU from the structure's own tables,
 * so the painted galaxy and the star catalogue agree.
 */
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  FloatType,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RedFormat,
  RGBAFormat,
  RGFormat,
  Scene,
  ShaderMaterial,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { hash32, hashToUnit } from '../../core/hash';
import type { GalaxyStructure } from '../../gen/galaxy/structure';
import { mapBakeFragment, mapBakeVertex } from './map.glsl';
import { MAP_EXTENT } from './uniforms';

/** Feature sizes of the visual channels (ly). */
const FILAMENT_SCALE_LY = 2600;
const CLUMP_SCALE_LY = 900;

/** A clip-space triangle covering the viewport (shared by every full-screen pass). */
export function fullScreenTriangle(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  return geometry;
}

export class GalaxyMap {
  readonly size: number;
  readonly halfExtentLy: number;
  readonly target: WebGLRenderTarget;
  private readonly structure: GalaxyStructure;
  private readonly wiggle: DataTexture;
  private readonly grid: DataTexture;
  private readonly material: ShaderMaterial;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera();
  private readonly geometry = fullScreenTriangle();
  private baked = false;

  constructor(structure: GalaxyStructure, size: number) {
    const g = structure.gpu;
    this.structure = structure;
    this.size = size;
    this.halfExtentLy = MAP_EXTENT * g.radiusLy;

    this.wiggle = new DataTexture(
      Float32Array.from(g.wiggleLut),
      g.wiggleStride,
      g.armSlots,
      RedFormat,
      FloatType,
    );
    this.grid = new DataTexture(
      Float32Array.from(g.noiseGrid),
      g.gridN,
      g.gridN,
      RGFormat,
      FloatType,
    );
    for (const t of [this.wiggle, this.grid]) {
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
    }

    const seed = structure.shape.seed;
    const offset = (i: number): number => 200 * hashToUnit(hash32(seed, 0x6a1a, i)) - 100;
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: mapBakeVertex,
      fragmentShader: mapBakeFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uWiggle: { value: this.wiggle },
        uGrid: { value: this.grid },
        uHalf: { value: this.halfExtentLy },
        uArmCount: { value: g.armCount },
        uArmSlots: { value: g.armSlots },
        uArmPhase: { value: g.armPhaseRad },
        uArmSpacing: { value: g.armSpacingRad },
        uCotPitch: { value: g.cotPitch },
        uSinPitch: { value: g.sinPitch },
        uLogRStart: { value: g.logRStart },
        uEnvLo: { value: g.envLoLy },
        uEnvHi: { value: g.envHiLy },
        uFadeStart: { value: g.armFadeStartLy },
        uOuter: { value: g.armOuterLy },
        uSigma0: { value: g.armSigma0Ly },
        uSigmaRef: { value: g.armSigmaRefLy },
        uWiggleAmp: { value: g.armWiggle },
        uFloc: { value: g.flocculence },
        uWiggleUMin: { value: g.wiggleUMin },
        uWiggleScale: { value: g.wiggleScale },
        uWiggleSize: { value: g.wiggleSize },
        uGridN: { value: g.gridN },
        uGridHalf: { value: g.gridHalfLy },
        uRmax: { value: g.radiusLy },
        uEdge: { value: g.edgeWidthLy },
        uDustRise: { value: g.dustRiseStartLy },
        uDustInner: { value: g.dustInnerLy },
        uDustScale: { value: g.dustScaleLy },
        uDustMax: { value: g.dustMaxRadiusLy },
        uLaneOffset: { value: g.dustLaneOffset },
        uLaneWidth: { value: g.dustLaneWidth },
        uDustFloor: { value: g.dustFloor },
        uNoiseOffset: { value: [offset(0), offset(1), offset(2)] },
        uFilamentScale: { value: FILAMENT_SCALE_LY },
        uClumpScale: { value: CLUMP_SCALE_LY },
      },
    });
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.target = new WebGLRenderTarget(size, size, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.target.texture.name = 'GalaxyMap';
  }

  get ready(): boolean {
    return this.baked;
  }

  /** Render the map (once) and build its mipmaps. Restores the renderer's target. */
  bake(renderer: WebGLRenderer): void {
    if (this.baked) return;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
    this.baked = true;
    // The source tables are only needed for the bake.
    this.wiggle.dispose();
    this.grid.dispose();
  }

  /**
   * Dev check: read an n×n grid of texels back and compare channels r/g with the CPU model's
   * `armFactor` / midplane `dust`. Returns the largest absolute errors.
   */
  validate(renderer: WebGLRenderer, n = 24): { arm: number; dust: number } {
    const half = new Uint16Array(4);
    let arm = 0;
    let dust = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const px = Math.floor(((i + 0.5) / n) * this.size);
        const py = Math.floor(((j + 0.5) / n) * this.size);
        renderer.readRenderTargetPixels(this.target, px, py, 1, 1, half);
        const x = (((px + 0.5) / this.size) * 2 - 1) * this.halfExtentLy;
        const z = (((py + 0.5) / this.size) * 2 - 1) * this.halfExtentLy;
        arm = Math.max(
          arm,
          Math.abs(DataUtils.fromHalfFloat(half[0] ?? 0) - this.structure.armFactor(x, 0, z)),
        );
        dust = Math.max(
          dust,
          Math.abs(DataUtils.fromHalfFloat(half[1] ?? 0) - this.structure.dust(x, 0, z)),
        );
      }
    }
    return { arm, dust };
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.geometry.dispose();
    this.wiggle.dispose();
    this.grid.dispose();
  }
}
