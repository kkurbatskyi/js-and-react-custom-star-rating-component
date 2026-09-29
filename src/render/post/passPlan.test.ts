import {
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  FXAAEffect,
  SMAAEffect,
  ToneMappingEffect,
  VignetteEffect,
} from 'postprocessing';
import { describe, expect, it } from 'vitest';
import { FilmGrainEffect } from './FilmGrainEffect';
import { type EffectTraits, effectTraits, planPasses } from './passPlan';

type Item = { name: string } & EffectTraits;

const plain = (name: string): Item => ({ name, exclusiveInput: false, transformsUv: false });
const conv = (name: string): Item => ({ name, exclusiveInput: true, transformsUv: false });
const uvWarp = (name: string): Item => ({ name, exclusiveInput: false, transformsUv: true });

const plan = (chain: Item[]): string[][] =>
  planPasses(chain, (item) => item).map((pass) => pass.map((item) => item.name));

describe('planPasses', () => {
  it('merges per-pixel effects into one pass', () => {
    expect(plan([plain('a'), plain('b'), plain('c')])).toEqual([['a', 'b', 'c']]);
  });

  it('starts a new pass at every exclusive-input effect', () => {
    expect(plan([plain('a'), conv('bloom'), plain('tone'), conv('smaa'), plain('v')])).toEqual([
      ['a'],
      ['bloom', 'tone'],
      ['smaa', 'v'],
    ]);
  });

  it('never merges two convolution effects', () => {
    expect(plan([conv('a'), conv('b')])).toEqual([['a'], ['b']]);
  });

  it('isolates UV-transforming effects on both sides', () => {
    expect(plan([plain('a'), uvWarp('lens'), plain('b'), plain('c')])).toEqual([
      ['a'],
      ['lens'],
      ['b', 'c'],
    ]);
    expect(plan([uvWarp('x'), uvWarp('y')])).toEqual([['x'], ['y']]);
  });

  it('handles an empty chain', () => {
    expect(plan([])).toEqual([]);
  });
});

describe('effectTraits', () => {
  const bloom = new BloomEffect();
  const exclusive = new Set<Effect>([bloom]);

  it('flags convolution effects and explicitly exclusive ones', () => {
    expect(effectTraits(new SMAAEffect(), exclusive).exclusiveInput).toBe(true);
    expect(effectTraits(new ChromaticAberrationEffect(), exclusive).exclusiveInput).toBe(true);
    expect(effectTraits(bloom, exclusive).exclusiveInput).toBe(true);
    expect(effectTraits(new FXAAEffect(), exclusive).exclusiveInput).toBe(false);
  });

  it('treats per-pixel effects as mergeable', () => {
    for (const effect of [new ToneMappingEffect(), new VignetteEffect(), new FilmGrainEffect()]) {
      expect(effectTraits(effect, exclusive)).toEqual({
        exclusiveInput: false,
        transformsUv: false,
      });
    }
  });

  it('detects mainUv as a UV transform', () => {
    const warp = new Effect('Warp', 'void mainUv(inout vec2 uv) { uv *= 0.5; }');
    expect(effectTraits(warp, exclusive).transformsUv).toBe(true);
  });
});
