import { describe, expect, it } from 'vitest';
import { common } from '../../../shaders/common.glsl';
import { noise } from '../../../shaders/noise.glsl';
import { bakeAlbedoGlsl } from './bakeAlbedo.glsl';
import { bakeReliefGlsl } from './bakeRelief.glsl';
import { bakeTerrainGlsl } from './bakeTerrain.glsl';
import { cubeGlsl } from './cube.glsl';
import { giantFragment, giantVertex } from './giant.glsl';
import { gradientGlsl } from './gradient.glsl';
import { lightingGlsl } from './lighting.glsl';
import { rockyFragment, rockyVertex } from './rocky.glsl';

const chunks = {
  cubeGlsl,
  gradientGlsl,
  bakeTerrainGlsl,
  bakeAlbedoGlsl,
  bakeReliefGlsl,
  lightingGlsl,
  rockyVertex,
  rockyFragment,
  giantVertex,
  giantFragment,
};

describe('planet GLSL sources', () => {
  it('are pure ASCII (WebGL rejects some non-ASCII input, even in comments)', () => {
    for (const [name, src] of Object.entries(chunks)) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII check
      expect(/[^\x09\x0a\x0d\x20-\x7e]/.test(src), name).toBe(false);
    }
  });

  it('never redeclare the shared chunk functions (each shared chunk is included once per shader)', () => {
    const shared = [
      'float fbm(',
      'float ridged(',
      'vec2 worley(',
      'float snoise(vec3',
      'float saturate(',
    ];
    for (const [name, src] of Object.entries(chunks)) {
      for (const decl of shared)
        expect(src.includes(decl), `${name} redeclares ${decl}`).toBe(false);
    }
    expect(common.includes('#define saturate')).toBe(true);
    expect(noise.includes('float fbm(')).toBe(true);
  });

  it('bake shaders share the cube conventions', () => {
    expect(cubeGlsl).toContain('vec3 cubeDir(int face, vec2 uv)');
    expect(bakeAlbedoGlsl).toContain('heightGradient(');
    expect(bakeReliefGlsl).toContain('encodeHeight(');
  });
});
