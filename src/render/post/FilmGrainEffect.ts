import { BlendFunction, Effect } from 'postprocessing';
import { Uniform } from 'three';

/**
 * Film grain that never lifts the blacks.
 *
 * postprocessing's NoiseEffect screens a uniform [0, 1] noise over the image, which greys out a
 * black sky. This grain is zero-mean (triangular PDF), multiplicative, and weighted by (1 - L), so
 * deep space stays black, highlights stay clean, and the mid-tones get a fine, filmic texture that
 * also breaks up 8-bit banding in soft gradients. It runs after tone mapping, on display-linear
 * values in [0, 1].
 *
 * The pattern is keyed to the integer pixel and to `time` quantised at 24 Hz, so it animates like
 * film and freezes when the post chain is rendered with dt = 0 (deterministic screenshots).
 */
const fragmentShader = /* glsl */ `
uniform float amount;

uint grainPcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float grainUnit(uint v) {
  return float(grainPcg(v) >> 8u) * (1.0 / 16777216.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  uvec2 px = uvec2(gl_FragCoord.xy);
  uint frame = uint(time * 24.0);
  // Nested 1D hashing (Jarzynski & Olano 2020) keys the noise to (pixel, frame).
  uint key = grainPcg(px.x + grainPcg(px.y + grainPcg(frame)));
  // Sum of two uniforms in [-1, 1]: triangular, zero-mean, std ~0.41.
  float n = grainUnit(key) + grainUnit(key ^ 0x9E3779B9u) - 1.0;
  float l = clamp(dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  outputColor = vec4(inputColor.rgb * (1.0 + n * amount * (1.0 - l)), inputColor.a);
}
`;

export interface FilmGrainOptions {
  /** Peak relative grain amplitude in the mid-tones; 0 disables. Default 0.05. */
  amount?: number;
}

export class FilmGrainEffect extends Effect {
  private readonly amountUniform: Uniform<number>;

  constructor({ amount = 0.05 }: FilmGrainOptions = {}) {
    const amountUniform = new Uniform(amount);
    super('FilmGrainEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([['amount', amountUniform]]),
    });
    this.amountUniform = amountUniform;
  }

  /** Peak relative grain amplitude in the mid-tones; 0 disables. */
  get amount(): number {
    return this.amountUniform.value;
  }

  set amount(value: number) {
    this.amountUniform.value = value;
  }
}
