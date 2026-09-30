/**
 * Uniforms of `galaxyFields` (./fields.glsl.ts). One instance is shared by every galaxy material:
 * materials spread these `Uniform` objects into their own uniform records, so updating a value
 * here updates all of them.
 */
import { type Texture, Uniform, Vector2, Vector3 } from 'three';
import type { GalaxyStructure } from '../../gen/galaxy/structure';

/** The planar map spans ±MAP_EXTENT × radius (arms and dust end at 1.2 radii). */
export const MAP_EXTENT = 1.2;

export interface GalaxyFieldUniforms {
  readonly [name: string]: Uniform<unknown>;
  uGalMap: Uniform<Texture | null>;
  uGalMapScale: Uniform<number>;
  uGalMapTexelInv: Uniform<number>;
  uGalInvRd: Uniform<number>;
  uGalRmax: Uniform<number>;
  uGalInvEdge: Uniform<number>;
  uGalInvHz: Uniform<number>;
  uGalInvHThick: Uniform<number>;
  uGalThickNorm: Uniform<number>;
  uGalInvHArm: Uniform<number>;
  uGalInvHDust: Uniform<number>;
  uGalArmStrength: Uniform<number>;
  uGalBulge0: Uniform<number>;
  uGalInvBulgeA2: Uniform<number>;
  uGalInvBulgeQ2: Uniform<number>;
  uGalBar0: Uniform<number>;
  uGalBarDir: Uniform<Vector2>;
  uGalInvBarSigma2: Uniform<Vector3>;
  uGalDustDetail: Uniform<number>;
  uGalExtinction: Uniform<Vector3>;
}

export function createFieldUniforms(structure: GalaxyStructure): GalaxyFieldUniforms {
  const g = structure.gpu;
  const inv2 = (s: number): number => (s > 0 ? 1 / (s * s) : 0);
  return {
    uGalMap: new Uniform<Texture | null>(null),
    uGalMapScale: new Uniform(1 / (2 * MAP_EXTENT * g.radiusLy)),
    uGalMapTexelInv: new Uniform(1),
    uGalInvRd: new Uniform(1 / g.diskScaleLengthLy),
    uGalRmax: new Uniform(g.radiusLy),
    uGalInvEdge: new Uniform(1 / g.edgeWidthLy),
    uGalInvHz: new Uniform(1 / g.thinHeightLy),
    uGalInvHThick: new Uniform(1 / g.thickHeightLy),
    uGalThickNorm: new Uniform(g.thickNorm),
    uGalInvHArm: new Uniform(1 / g.armHeightLy),
    uGalInvHDust: new Uniform(1 / g.dustHeightLy),
    uGalArmStrength: new Uniform(g.armStrength),
    uGalBulge0: new Uniform(g.bulge0),
    uGalInvBulgeA2: new Uniform(inv2(g.bulgeALy)),
    uGalInvBulgeQ2: new Uniform(inv2(g.bulgeQ)),
    uGalBar0: new Uniform(g.bar0),
    uGalBarDir: new Uniform(new Vector2(Math.cos(g.barAngleRad), Math.sin(g.barAngleRad))),
    uGalInvBarSigma2: new Uniform(
      new Vector3(inv2(g.barSigmaULy), inv2(g.barSigmaVLy), inv2(g.barSigmaYLy)),
    ),
    uGalDustDetail: new Uniform(0),
    uGalExtinction: new Uniform(new Vector3()),
  };
}

/** Point the field uniforms at a baked map of `size` texels per side. */
export function setFieldMap(
  u: GalaxyFieldUniforms,
  structure: GalaxyStructure,
  texture: Texture,
  size: number,
): void {
  u.uGalMap.value = texture;
  u.uGalMapTexelInv.value = size / (2 * MAP_EXTENT * structure.gpu.radiusLy);
}
