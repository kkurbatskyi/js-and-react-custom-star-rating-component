/**
 * The map bake (./map.glsl.ts) ports `armPlanar` and the midplane dust from the structure to GLSL
 * using only `structure.gpu`. This test runs the same formulas in TypeScript — line by line as in
 * the shader (texelFetch + manual interpolation of the uploaded tables) — against the CPU model.
 * `dev/galaxy.html?validate=1` checks the actual GPU bake the same way.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { createGalaxyParams } from '../../gen/galaxy/params';
import { type GalaxyGpuData, getGalaxyStructure } from '../../gen/galaxy/structure';

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function port(g: GalaxyGpuData) {
  const wiggle = Float32Array.from(g.wiggleLut); // uploaded as R32F
  const wiggleAt = (k: number, u: number): number => {
    const f = Math.min(Math.max((u - g.wiggleUMin) * g.wiggleScale, 0), g.wiggleSize - 1e-3);
    const i = Math.floor(f);
    const a = wiggle[k * g.wiggleStride + i] as number;
    const b = wiggle[k * g.wiggleStride + i + 1] as number;
    return a + (b - a) * (f - i);
  };
  const gridAt = (x: number, z: number): [number, number] => {
    const invCell = (g.gridN - 1) / (2 * g.gridHalfLy);
    const fx = Math.min(Math.max((x + g.gridHalfLy) * invCell, 0), g.gridN - 1.000001);
    const fz = Math.min(Math.max((z + g.gridHalfLy) * invCell, 0), g.gridN - 1.000001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (i: number, j: number, c: number): number =>
      g.noiseGrid[(j * g.gridN + i) * 2 + c] as number;
    const lerp2 = (c: number): number => {
      const a = at(ix, iz, c) + (at(ix + 1, iz, c) - at(ix, iz, c)) * tx;
      const b = at(ix, iz + 1, c) + (at(ix + 1, iz + 1, c) - at(ix, iz + 1, c)) * tx;
      return a + (b - a) * tz;
    };
    return [lerp2(0), lerp2(1)];
  };
  const envelope = (r: number): number => {
    let e = 1;
    if (r < g.envHiLy) {
      const t = (r - g.envLoLy) / (g.envHiLy - g.envLoLy);
      if (t <= 0) return 0;
      e = t * t * (3 - 2 * t);
    }
    if (r > g.armFadeStartLy) {
      const t = (r - g.armFadeStartLy) / (g.armOuterLy - g.armFadeStartLy);
      if (t >= 1) return 0;
      e *= 1 - t * t * (3 - 2 * t);
    }
    return e;
  };
  const sigmaAt = (r: number): number => g.armSigma0Ly * (0.6 + (0.4 * r) / g.armSigmaRefLy);
  const ridge = (x: number, z: number, r: number, sigma: number): number => {
    const u = Math.log(r) - g.logRStart;
    let delta = Math.atan2(z, x) - g.armPhaseRad - u * g.cotPitch;
    const turns = Math.floor(delta / g.armSpacingRad + 0.5);
    delta -= turns * g.armSpacingRad;
    const k = turns - g.armSlots * Math.floor(turns / g.armSlots); // GLSL mod()
    return r * g.sinPitch * delta - g.armWiggle * sigma * wiggleAt(k, u);
  };
  return (x: number, z: number): { arm: number; dust: number } => {
    const r = Math.hypot(x, z);
    const [amp, patch] = gridAt(x, z);
    const arms = g.armCount > 0 && r > g.envLoLy && r < g.armOuterLy;
    const env = arms ? envelope(r) : 0;
    const sigma = sigmaAt(r);
    const d = arms ? ridge(x, z, r, sigma) : 0;
    let arm = 0;
    if (env > 0) {
      const gauss = env * Math.exp(-0.5 * (d / sigma) ** 2);
      arm = gauss < 1e-9 ? 0 : gauss * (1 - g.flocculence + g.flocculence * amp);
    }
    let dust = 0;
    if (r < g.dustMaxRadiusLy) {
      const taper = 1 / (1 + Math.exp(Math.min((r - g.radiusLy) / g.edgeWidthLy, 80)));
      const radial =
        smoothstep(g.dustRiseStartLy, g.dustInnerLy, r) *
        (r > g.dustInnerLy ? Math.exp(-(r - g.dustInnerLy) / g.dustScaleLy) : 1) *
        taper;
      const t = (d - g.dustLaneOffset * sigma) / (g.dustLaneWidth * sigma);
      const lane = arms ? env * Math.exp(-0.5 * t * t) : 0;
      dust = radial * patch * (g.dustFloor + (1 - g.dustFloor) * lane);
    }
    return { arm, dust };
  };
}

describe('GPU port of the planar fields', () => {
  it.each([20260929, 1, 3, 42])('matches armFactor and midplane dust (seed %i)', (seed) => {
    const structure = getGalaxyStructure(createGalaxyParams(seed));
    const field = port(structure.gpu);
    const rng = createRng(seed ^ 0x5eed);
    const extent = 1.2 * structure.gpu.radiusLy;
    let armErr = 0;
    let dustErr = 0;
    for (let i = 0; i < 4000; i++) {
      const x = rng.range(-extent, extent);
      const z = rng.range(-extent, extent);
      const f = field(x, z);
      armErr = Math.max(armErr, Math.abs(f.arm - structure.armFactor(x, 0, z)));
      dustErr = Math.max(dustErr, Math.abs(f.dust - structure.dust(x, 0, z)));
    }
    // The CPU model uses float64 LUTs for the radial profiles (relative error < 1e-4).
    expect(armErr).toBeLessThan(1e-5);
    expect(dustErr).toBeLessThan(2e-4);
  });
});
