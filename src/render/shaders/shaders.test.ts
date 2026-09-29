import { describe, expect, it } from 'vitest';
import { color } from './color.glsl';
import { common } from './common.glsl';
import { hash, noise, simplex } from './noise.glsl';

/**
 * Static checks on the GLSL chunks (no GPU here — dev/shaders.html compiles and exercises them in
 * a real WebGL2 context). These guard the inclusion rules documented in common.glsl.ts.
 */

const chunks: Record<string, string> = { common, color, hash, simplex, noise };

const stripComments = (glsl: string): string =>
  glsl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Function definitions as "name(type,type)" signatures. */
function signatures(glsl: string): string[] {
  const noComments = stripComments(glsl);
  const re = /^\s*(?:[a-z][a-z0-9]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/gm;
  return [...noComments.matchAll(re)].map(([, name, params = '']) => {
    const types = params
      .split(',')
      .map((p) => p.trim().split(/\s+/).slice(0, -1).filter((w) => !['const', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp'].includes(w)).join(' '))
      .filter(Boolean);
    return `${name}(${types.join(',')})`;
  });
}

const names = (glsl: string): Set<string> => new Set(signatures(glsl).map((s) => s.split('(')[0]));

describe('GLSL chunks', () => {
  it.each(Object.entries(chunks))('%s is plain ASCII with balanced delimiters', (_, glsl) => {
    expect(glsl.length).toBeGreaterThan(100);
    // WebGL rejects non-ASCII shader sources in some implementations, even inside comments.
    expect([...glsl].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    const code = stripComments(glsl);
    for (const [open, close] of [
      ['{', '}'],
      ['(', ')'],
      ['[', ']'],
    ] as const) {
      expect(code.split(open).length, `${open}${close} balance`).toBe(code.split(close).length);
    }
  });

  it.each(Object.entries(chunks))('%s is self-contained and merge-safe', (_, glsl) => {
    expect(glsl).not.toMatch(/#include|#version|precision\s/);
    // Global consts would collide when postprocessing merges two effects using the same chunk.
    expect(glsl).not.toMatch(/^const\s/m);
  });

  it('declares the documented functions', () => {
    const expected: Record<string, string[]> = {
      common: [
        'remap',
        'remapClamped',
        'linstep',
        'smootherstep',
        'luminance709',
        'safeNormalize',
        'raySphere',
        'rotate2d',
        'rotateX',
        'rotateY',
        'rotateZ',
        'rotateAxis',
        'quatRotate',
      ],
      color: [
        'srgbToLinear',
        'linearToSrgb',
        'planckianLocusXy',
        'blackbodyUnitLuminance',
        'blackbody',
        'adjustSaturation',
      ],
      hash: ['pcg', 'pcg2d', 'pcg3d', 'pcg4d', 'uintToUnit', 'hash11', 'hash12', 'hash33', 'hash44'],
      simplex: ['snoise', 'snoiseGrad', 'mod289', 'permute', 'taylorInvSqrt', 'grad4'],
      noise: ['fbm', 'fbmGrad', 'ridged', 'worley', 'domainWarp', 'snoise', 'pcg3d'],
    };
    for (const [chunk, fns] of Object.entries(expected)) {
      const declared = names(chunks[chunk] ?? '');
      for (const fn of fns) expect(declared, `${chunk} declares ${fn}`).toContain(fn);
    }
    expect(signatures(noise)).toContain('snoise(vec3)');
    expect(signatures(noise)).toContain('snoise(vec4)');
  });

  it('can be combined in one shader without redefinitions', () => {
    const all = signatures(common + color + noise);
    expect(all.length).toBeGreaterThan(40);
    expect(new Set(all).size).toBe(all.length);
  });

  it('avoids names that three.js or postprocessing already define', () => {
    const reserved = ['luminance', 'rand', 'pow2', 'max3', 'average', 'sRGBToLinear', 'readDepth'];
    const declared = names(common + color + noise);
    for (const name of reserved) expect(declared.has(name), name).toBe(false);
  });
});
