/**
 * Bake shader for the galaxy's planar map. Channels r and g are a line-by-line port of
 * `armPlanar` and the midplane `dust` of src/gen/galaxy/structure.ts (same tables, uploaded as
 * textures, fetched with texelFetch and interpolated exactly like the CPU); b and a are visual
 * detail. `dev/galaxy.html` reads the bake back and reports the error against the CPU model.
 */
import { common } from '../shaders/common.glsl';
import { noise } from '../shaders/noise.glsl';

export const mapBakeVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const mapBakeFragment = /* glsl */ `
precision highp float;
precision highp int;
${common}
${noise}
uniform sampler2D uWiggle;   // R32F, wiggleStride x armSlots
uniform sampler2D uGrid;     // RG32F, gridN x gridN (arm amplitude, dust patchiness)
uniform float uHalf;         // map half extent (ly)
uniform float uArmCount;
uniform float uArmSlots;
uniform float uArmPhase;
uniform float uArmSpacing;
uniform float uCotPitch;
uniform float uSinPitch;
uniform float uLogRStart;
uniform float uEnvLo;
uniform float uEnvHi;
uniform float uFadeStart;
uniform float uOuter;
uniform float uSigma0;
uniform float uSigmaRef;
uniform float uWiggleAmp;
uniform float uFloc;
uniform float uWiggleUMin;
uniform float uWiggleScale;
uniform float uWiggleSize;
uniform float uGridN;
uniform float uGridHalf;
uniform float uRmax;
uniform float uEdge;
uniform float uDustRise;
uniform float uDustInner;
uniform float uDustScale;
uniform float uDustMax;
uniform float uLaneOffset;
uniform float uLaneWidth;
uniform float uDustFloor;
uniform vec3 uNoiseOffset;
uniform float uFilamentScale;
uniform float uClumpScale;

in vec2 vUv;
out vec4 fragColor;

float wiggleAt(float k, float u) {
  float f = clamp((u - uWiggleUMin) * uWiggleScale, 0.0, uWiggleSize - 1e-3);
  float i = floor(f);
  float a = texelFetch(uWiggle, ivec2(int(i), int(k)), 0).r;
  float b = texelFetch(uWiggle, ivec2(int(i) + 1, int(k)), 0).r;
  return mix(a, b, f - i);
}

vec2 gridAt(vec2 xz) {
  float invCell = (uGridN - 1.0) / (2.0 * uGridHalf);
  vec2 f = clamp((xz + uGridHalf) * invCell, 0.0, uGridN - 1.000001);
  vec2 i = floor(f);
  vec2 t = f - i;
  ivec2 c = ivec2(i);
  vec2 g00 = texelFetch(uGrid, c, 0).rg;
  vec2 g10 = texelFetch(uGrid, c + ivec2(1, 0), 0).rg;
  vec2 g01 = texelFetch(uGrid, c + ivec2(0, 1), 0).rg;
  vec2 g11 = texelFetch(uGrid, c + ivec2(1, 1), 0).rg;
  return mix(mix(g00, g10, t.x), mix(g01, g11, t.x), t.y);
}

float armEnvelope(float r) {
  float e = 1.0;
  if (r < uEnvHi) {
    float t = (r - uEnvLo) / (uEnvHi - uEnvLo);
    if (t <= 0.0) return 0.0;
    e = t * t * (3.0 - 2.0 * t);
  }
  if (r > uFadeStart) {
    float t = (r - uFadeStart) / (uOuter - uFadeStart);
    if (t >= 1.0) return 0.0;
    e *= 1.0 - t * t * (3.0 - 2.0 * t);
  }
  return e;
}

float armSigma(float r) {
  return uSigma0 * (0.6 + 0.4 * r / uSigmaRef);
}

/** Signed distance (ly) to the nearest wiggled ridge; > 0 on the concave (inner) side. */
float ridgeOffset(vec2 xz, float r, float sigma) {
  float u = log(r) - uLogRStart;
  float delta = atan(xz.y, xz.x) - uArmPhase - u * uCotPitch;
  float turns = floor(delta / uArmSpacing + 0.5); // Math.round
  delta -= turns * uArmSpacing;
  float k = mod(turns, uArmSlots);
  return r * uSinPitch * delta - uWiggleAmp * sigma * wiggleAt(k, u);
}

void main() {
  vec2 xz = (vUv * 2.0 - 1.0) * uHalf;
  float r = length(xz);
  vec2 grid = gridAt(xz);
  bool arms = uArmCount > 0.5 && r > uEnvLo && r < uOuter;
  float env = arms ? armEnvelope(r) : 0.0;
  float sigma = armSigma(r);
  float d = arms ? ridgeOffset(xz, r, sigma) : 0.0;
  float floc = 1.0 - uFloc + uFloc * grid.x;

  // r: armPlanar
  float arm = 0.0;
  if (env > 0.0) {
    float g = d / sigma;
    float gauss = env * exp(-0.5 * g * g);
    arm = gauss < 1e-9 ? 0.0 : gauss * floc;
  }

  // g: dust(x, 0, z)
  float dust = 0.0;
  if (r < uDustMax) {
    float taper = 1.0 / (1.0 + exp(min((r - uRmax) / uEdge, 80.0)));
    float radial = smoothstep(uDustRise, uDustInner, r)
      * (r > uDustInner ? exp(-(r - uDustInner) / uDustScale) : 1.0) * taper;
    float lane = 0.0;
    if (arms) {
      float t = (d - uLaneOffset * sigma) / (uLaneWidth * sigma);
      lane = env * exp(-0.5 * t * t);
    }
    dust = radial * grid.y * (uDustFloor + (1.0 - uDustFloor) * lane);
  }

  // a: filament noise, domain-warped fbm (visual only)
  vec3 q = vec3(xz / uFilamentScale, 0.0) + uNoiseOffset;
  vec3 w = vec3(fbm(q * 0.5 + 11.3, 3), fbm(q * 0.5 + 37.9, 3), 0.0);
  float fil = clamp(1.45 * fbm(q + 1.6 * w, 6), -1.0, 1.0);

  // b: star-forming ridge between the dust lane and the arm crest, broken into clumps
  float sf = 0.0;
  if (env > 0.0) {
    float t = (d - 0.2 * sigma) / (0.35 * sigma);
    float clumps = smoothstep(0.05, 0.6, fbm(vec3(xz / uClumpScale, 3.7) + uNoiseOffset, 4));
    sf = env * exp(-0.5 * t * t) * floc * clumps * clumps;
  }

  fragColor = vec4(arm, dust, sf, fil);
}
`;
