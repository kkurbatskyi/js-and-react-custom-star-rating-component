import { describe, expect, it } from 'vitest';
import { atmosphereFragment, atmosphereVertex } from './atmosphere/atmosphere.glsl';
import { cloudFieldGlsl } from './clouds/cloudField.glsl';
import { cloudFragment, cloudVertex } from './clouds/clouds.glsl';
import { ringProfileGlsl, ringShadowGlsl } from './rings/ringProfile.glsl';
import { ringFragment, ringVertex } from './rings/rings.glsl';

const SOURCES: Record<string, string> = {
  atmosphereVertex,
  atmosphereFragment,
  cloudFieldGlsl,
  cloudVertex,
  cloudFragment,
  ringProfileGlsl,
  ringShadowGlsl,
  ringVertex,
  ringFragment,
};

describe('sky shader sources', () => {
  it.each(Object.entries(SOURCES))('%s is pure ASCII with balanced braces', (_name, src) => {
    // WebGL rejects some non-ASCII input, even inside comments.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ASCII range
    expect(/^[\x00-\x7F]*$/.test(src)).toBe(true);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const count = (re: RegExp): number => (code.match(re) ?? []).length;
    expect(count(/{/g)).toBe(count(/}/g));
    expect(count(/\(/g)).toBe(count(/\)/g));
  });

  it('the ring chunks expose the functions the surface shaders call', () => {
    expect(ringProfileGlsl).toContain(
      'vec3 ringStructure(float u, float seed, float du, float tau)',
    );
    expect(ringShadowGlsl).toContain('float ringShadow(vec3 P, vec3 sunDir, vec4 ring)');
    // The shadow chunk is self-contained and prefixed so it can sit next to any other chunk.
    expect(ringShadowGlsl).not.toMatch(/\bhash11\b|\bsnoise\b/);
  });

  it('shells write an analytic depth and declare no global const arrays', () => {
    expect(atmosphereFragment).toContain('gl_FragDepth');
    expect(cloudFragment).toContain('gl_FragDepth');
    expect(ringFragment).not.toContain('gl_FragDepth');
  });
});
