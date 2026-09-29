import { type Effect, EffectAttribute } from 'postprocessing';

/**
 * What the pass planner needs to know about an effect.
 *
 * postprocessing merges every effect of one `EffectPass` into a single fragment shader that reads
 * the pass input ONCE per pixel and threads the colour through each effect in turn. That is only
 * correct for effects that look at nothing but their own pixel:
 */
export interface EffectTraits {
  /**
   * The effect reads the pass input at *other* pixels — a convolution (SMAA, FXAA, warp, lensing,
   * chromatic aberration) or a render from the input in `update()` (bloom, lens-flare ghosts).
   * It must be FIRST in its pass so that its input already contains everything before it.
   */
  readonly exclusiveInput: boolean;
  /**
   * The effect defines `mainUv`, which re-maps the UV of the whole pass. It gets a pass of its own,
   * so neither earlier nor later effects are distorted with it.
   */
  readonly transformsUv: boolean;
}

/**
 * Split an ordered effect chain into the fewest passes that preserve its meaning.
 *
 * A new pass starts before an effect with `exclusiveInput` or `transformsUv`, and after an effect
 * with `transformsUv`; everything else merges into the current pass. This also satisfies
 * postprocessing's own merge constraints (one convolution effect per pass; UV transforms never
 * share a pass with a convolution).
 */
export function planPasses<T>(chain: readonly T[], traitsOf: (item: T) => EffectTraits): T[][] {
  const passes: T[][] = [];
  let current: T[] = [];
  let sealed = false; // current pass holds a UV-transforming effect: nothing else may join it

  for (const item of chain) {
    const traits = traitsOf(item);
    if (current.length > 0 && (sealed || traits.exclusiveInput || traits.transformsUv)) {
      passes.push(current);
      current = [];
      sealed = false;
    }
    current.push(item);
    sealed = traits.transformsUv;
  }
  if (current.length > 0) passes.push(current);
  return passes;
}

/**
 * Traits of a postprocessing `Effect`: convolution effects are recognised by their
 * `EffectAttribute.CONVOLUTION` flag and UV transforms by a `mainUv` function; `exclusive` lists
 * effects known to render from their input in `update()` (e.g. bloom) or to sample neighbours
 * without declaring it (FXAA).
 *
 * Effect authors: if your effect samples `inputBuffer` anywhere but at `uv`, or renders from it in
 * `update()`, pass `attributes: EffectAttribute.CONVOLUTION` to the Effect constructor.
 */
export function effectTraits(effect: Effect, exclusive: ReadonlySet<Effect>): EffectTraits {
  const convolution = (effect.getAttributes() & EffectAttribute.CONVOLUTION) !== 0;
  return {
    exclusiveInput: convolution || exclusive.has(effect),
    transformsUv: /\bmainUv\b/.test(effect.getFragmentShader() ?? ''),
  };
}
