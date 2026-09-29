/**
 * Procedural noise for GLSL ES 3.00.
 *
 * Exports, from cheapest to most complete — include exactly ONE of them per shader
 * (each is a superset of the previous; see `common.glsl.ts` for the shared inclusion rules):
 *
 * - `hash`    PCG integer hashes and float wrappers (`pcg*`, `hash11…hash44`, `uintToUnit`).
 * - `simplex` `hash` + 3D/4D simplex noise (`snoise`) + analytic-gradient 3D simplex (`snoiseGrad`).
 * - `noise`   `simplex` + fractals (`fbm`, `fbmGrad`, `ridged`), cellular (`worley`) and
 *             domain warping (`domainWarp`).
 *
 * Every noise function returns roughly [-1, 1] unless documented otherwise.
 *
 * Third-party code: the simplex noise functions are derived from "webgl-noise"
 * (https://github.com/stegu/webgl-noise), used under the MIT licence:
 *
 *   Copyright (C) 2011 Ashima Arts (Ian McEwan). Copyright (C) 2011-2022 Stefan Gustavson.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 *   and associated documentation files (the "Software"), to deal in the Software without
 *   restriction, including without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 *   BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/** PCG-family integer hashes and float wrappers. */
export const hash = /* glsl */ `
// ---- sidereal/hash ------------------------------------------------------------
// PCG hashes: Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020.
// Integer in, integer out; statistically excellent and cheap. Float inputs are hashed by their
// IEEE bit pattern, so every distinct float maps to an independent value (use floor()ed
// coordinates for lattice noise).

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v;
}

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v.w += v.y * v.z;
  return v;
}

// uint -> [0, 1) from the top 24 bits (exactly representable in float32).
float uintToUnit(uint x) { return float(x >> 8u) * (1.0 / 16777216.0); }
vec2 uintToUnit(uvec2 x) { return vec2(x >> 8u) * (1.0 / 16777216.0); }
vec3 uintToUnit(uvec3 x) { return vec3(x >> 8u) * (1.0 / 16777216.0); }
vec4 uintToUnit(uvec4 x) { return vec4(x >> 8u) * (1.0 / 16777216.0); }

// hashNM: N float outputs in [0, 1) from an M-component float input.
float hash11(float p) { return uintToUnit(pcg(floatBitsToUint(p))); }
float hash12(vec2 p) { return uintToUnit(pcg2d(floatBitsToUint(p)).x); }
float hash13(vec3 p) { return uintToUnit(pcg3d(floatBitsToUint(p)).x); }
float hash14(vec4 p) { return uintToUnit(pcg4d(floatBitsToUint(p)).x); }
vec2 hash22(vec2 p) { return uintToUnit(pcg2d(floatBitsToUint(p))); }
vec3 hash33(vec3 p) { return uintToUnit(pcg3d(floatBitsToUint(p))); }
vec4 hash44(vec4 p) { return uintToUnit(pcg4d(floatBitsToUint(p))); }
`;

/** Classic webgl-noise simplex noise (3D, 4D) plus the analytic-gradient 3D variant. */
const simplexOnly = /* glsl */ `
// ---- sidereal/simplex ---------------------------------------------------------
//  Description : Array- and textureless GLSL 3D/4D simplex noise functions.
//       Author : Ian McEwan, Ashima Arts; Stefan Gustavson (gradient variant, 2022 update).
//      License : Copyright (C) 2011 Ashima Arts. Copyright (C) 2011-2022 Stefan Gustavson.
//                Distributed under the MIT License. See LICENSE file.
//                https://github.com/ashima/webgl-noise
//                https://github.com/stegu/webgl-noise
//  Uses the 2022 kernel (radius^2 = 0.5), which removes the faint discontinuities of the
//  original 0.6 kernel.

float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float permute(float x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
float taylorInvSqrt(float r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

/**
 * 3D simplex noise with its analytic gradient: returns vec4(value, d/dx, d/dy, d/dz).
 * Use the gradient for cheap bump-mapped normals (no extra noise evaluations).
 */
vec4 snoiseGrad(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Permutations
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  float n_ = 0.142857142857; // 1/7
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  // Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value and its derivative:
  // n = 105 * sum(m_i^4 * dot(p_i, x_i)), m_i = max(0.5 - |x_i|^2, 0)
  // dn/dv = 105 * sum(m_i^4 * p_i - 8 * m_i^3 * dot(p_i, x_i) * x_i)
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  vec3 grad = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  return 105.0 * vec4(dot(m4, pdotx), grad);
}

/** 3D simplex noise, ~[-1, 1]. */
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec4 grad4(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}

/** 4D simplex noise, ~[-1, 1]. Use (position, time) for smoothly evolving 3D fields. */
float snoise(vec4 v) {
  const vec4 C = vec4(
    0.138196601125011,  // (5 - sqrt(5)) / 20  = G4
    0.276393202250021,  // 2 * G4
    0.414589803375032,  // 3 * G4
    -0.447213595499958  // -1 + 4 * G4
  );
  const float F4 = 0.309016994374947451; // (sqrt(5) - 1) / 4

  // First corner
  vec4 i = floor(v + dot(v, vec4(F4)));
  vec4 x0 = v - i + dot(i, C.xxxx);

  // Other corners. Rank sorting originally contributed by Bill Licea-Kane, AMD (formerly ATI).
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  // i0 now contains the unique values 0, 1, 2, 3 in each channel
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;

  // Permutations
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(
      i.w + vec4(i1.w, i2.w, i3.w, 1.0))
    + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
    + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
    + i.x + vec4(i1.x, i2.x, i3.x, 1.0));

  // Gradients: 7x7x6 points over a cube, mapped onto a 4-cross polytope.
  // 7*7*6 = 294, which is close to the ring size 17*17 = 289.
  vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);

  // Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4, p4));

  // Mix contributions from the five corners
  vec3 m0 = max(0.5 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  vec2 m1 = max(0.5 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;
  return 109.319 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
    + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}
`;

/** Fractals, cellular noise and domain warping (needs `hash` + simplex). */
const fractalOnly = /* glsl */ `
// ---- sidereal/fractal ---------------------------------------------------------
// Octaves are rotated by an orthonormal matrix (after Inigo Quilez) and offset, which hides the
// simplex lattice and the correlation at the origin that plain p *= 2 octaves show.
// (Guarded macros rather than global consts: postprocessing renames functions per merged effect,
// but not globals, so two effects in one pass must not both declare the same global.)
#ifndef FRACTAL_ROT
#define FRACTAL_ROT mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64)
#endif
#ifndef FRACTAL_SHIFT
#define FRACTAL_SHIFT vec3(17.13, 31.71, 5.37)
#endif

/**
 * Fractional Brownian motion over 3D simplex noise, normalised to ~[-1, 1].
 * lacunarity: frequency multiplier per octave (2.0); gain: amplitude multiplier (0.5).
 */
float fbm(vec3 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  for (int i = 0; i < octaves; i++) {
    sum += amp * snoise(p);
    norm += amp;
    amp *= gain;
    p = FRACTAL_ROT * p * lacunarity + FRACTAL_SHIFT;
  }
  return sum / max(norm, 1e-6);
}

float fbm(vec3 p, int octaves) {
  return fbm(p, octaves, 2.0, 0.5);
}

/**
 * fbm with its analytic gradient: vec4(value, d/dx, d/dy, d/dz), same normalisation as fbm().
 * The gradient accounts for the per-octave rotation and scale (chain rule).
 */
vec4 fbmGrad(vec3 p, int octaves, float lacunarity, float gain) {
  vec4 sum = vec4(0.0);
  float amp = 1.0;
  float norm = 0.0;
  mat3 jacobian = mat3(1.0); // d(octave position) / d(p)
  for (int i = 0; i < octaves; i++) {
    vec4 n = snoiseGrad(p);
    sum += amp * vec4(n.x, transpose(jacobian) * n.yzw);
    norm += amp;
    amp *= gain;
    p = FRACTAL_ROT * p * lacunarity + FRACTAL_SHIFT;
    jacobian = lacunarity * FRACTAL_ROT * jacobian;
  }
  return sum / max(norm, 1e-6);
}

vec4 fbmGrad(vec3 p, int octaves) {
  return fbmGrad(p, octaves, 2.0, 0.5);
}

/**
 * Ridged multifractal (Musgrave, "Texturing & Modeling: A Procedural Approach", 3rd ed., ch. 16):
 * sharp crests where the noise crosses zero; each octave is weighted by the previous one, so
 * detail concentrates on the ridges. Returns ~[0, 1].
 * h: fractal increment (1.0), offset: ridge height (1.0), gain: weight feedback (2.0).
 */
float ridged(vec3 p, int octaves, float lacunarity, float h, float offset, float gain) {
  float sum = 0.0;
  float norm = 0.0;
  float weight = 1.0;
  float freqAmp = 1.0;
  float ampStep = pow(lacunarity, -h);
  for (int i = 0; i < octaves; i++) {
    float signal = offset - abs(snoise(p));
    signal *= signal * weight;
    weight = clamp(signal * gain, 0.0, 1.0);
    sum += signal * freqAmp;
    norm += freqAmp;
    freqAmp *= ampStep;
    p = FRACTAL_ROT * p * lacunarity + FRACTAL_SHIFT;
  }
  return sum / max(norm * offset * offset, 1e-6);
}

float ridged(vec3 p, int octaves) {
  return ridged(p, octaves, 2.0, 1.0, 1.0, 2.0);
}

/**
 * 3D cellular noise (Worley 1996): distances to the nearest (F1) and second-nearest (F2)
 * feature points, one per unit cell, displaced by jitter in [0, 1] (1 = fully random).
 * Returns vec2(F1, F2); F1 is in [0, ~1.2]. Classic uses: F1 craters/cells, F2 - F1 cracks.
 */
vec2 worley(vec3 p, float jitter) {
  vec3 cell = floor(p);
  vec3 f = p - cell;
  float d1 = 1e9;
  float d2 = 1e9;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 feature = o + 0.5 + jitter * (hash33(cell + o) - 0.5);
        vec3 r = feature - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
  }
  return sqrt(vec2(d1, d2));
}

/**
 * Domain warping (Inigo Quilez, "Domain Warping", 2002): displaces p by a vector fbm field.
 * Feed the result into another noise call for swirling, fluid-looking patterns.
 */
vec3 domainWarp(vec3 p, float strength, int octaves) {
  vec3 q = vec3(
    fbm(p, octaves),
    fbm(p + vec3(5.2, 1.3, 2.8), octaves),
    fbm(p + vec3(1.7, 9.2, 4.1), octaves)
  );
  return p + strength * q;
}
`;

/** Hashes + 3D/4D simplex + gradient simplex. */
export const simplex = hash + simplexOnly;

/** Everything: hashes, simplex, fbm/fbmGrad/ridged, worley, domainWarp. */
export const noise = simplex + fractalOnly;
