/**
 * Shared GLSL helpers: constants, remapping, luminance, ray–sphere intersection, rotations.
 *
 * All chunks in `src/render/shaders` target GLSL ES 3.00 (three.js compiles every material as
 * `#version 300 es` under WebGL2) and follow the same inclusion rules:
 *
 * - **Self-contained, no include guards.** Each chunk depends on no other chunk; include each at most
 *   once per shader. (Macro include guards would break postprocessing `Effect`s: when several effects
 *   are merged into one EffectPass, their functions are renamed per effect, but macros are not.)
 * - **Compatible with three.js `#include <common>` placed before them** — which is how postprocessing
 *   builds every effect shader. `PI` and `saturate` are guarded macros, and no function name collides
 *   with a three.js or postprocessing built-in (hence `luminance709`, not `luminance`).
 */
export const common = /* glsl */ `
// ---- sidereal/common --------------------------------------------------------
#ifndef PI
#define PI 3.141592653589793
#endif
#ifndef TAU
#define TAU 6.283185307179586
#endif
#ifndef saturate
#define saturate(a) clamp(a, 0.0, 1.0)
#endif

/** Linear remap of x from [a, b] to [c, d] (unclamped). */
float remap(float x, float a, float b, float c, float d) {
  return c + (x - a) * (d - c) / (b - a);
}

/** Linear remap of x from [a, b] to [c, d], clamped to the output range. */
float remapClamped(float x, float a, float b, float c, float d) {
  return c + saturate((x - a) / (b - a)) * (d - c);
}

/** Linear ramp: 0 at a, 1 at b, clamped (smoothstep without the smoothing). */
float linstep(float a, float b, float x) {
  return saturate((x - a) / (b - a));
}

/** Perlin's C2-continuous quintic step 6t^5 - 15t^4 + 10t^3. */
float smootherstep(float a, float b, float x) {
  float t = saturate((x - a) / (b - a));
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/** Relative luminance of a linear-sRGB colour (Rec. 709 / sRGB primaries, D65). */
float luminance709(vec3 linearRgb) {
  return dot(linearRgb, vec3(0.2126729, 0.7151522, 0.0721750));
}

/** normalize() that returns 0 instead of NaN for zero-length vectors. */
vec3 safeNormalize(vec3 v) {
  float len2 = dot(v, v);
  return len2 > 0.0 ? v * inversesqrt(len2) : vec3(0.0);
}

/**
 * Ray-sphere intersection. rd must be normalised.
 * Returns (tNear, tFar) along the ray; a miss returns the empty interval (1, -1), so test
 * t.x > t.y. tNear < 0 < tFar when the origin is inside the sphere -- clamp tNear to 0 for
 * volumes. The discriminant is computed from the perpendicular offset rather than b*b - c, which
 * avoids catastrophic cancellation when the sphere is far away relative to its radius
 * (Haines et al., "Precision Improvements for Ray/Sphere Intersection", Ray Tracing Gems, ch. 7).
 */
vec2 raySphere(vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 f = ro - center;
  float b = dot(f, rd);
  vec3 perp = f - b * rd;
  float disc = radius * radius - dot(perp, perp);
  if (disc < 0.0) return vec2(1.0, -1.0);
  float h = sqrt(disc);
  return vec2(-b - h, -b + h);
}

/** 2D rotation by angle a (radians, counter-clockwise): rotate2d(a) * v. */
mat2 rotate2d(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, s, -s, c);
}

/** Right-handed rotation matrices about the principal axes (column-major, apply as M * v). */
mat3 rotateX(float a) {
  float s = sin(a), c = cos(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}
mat3 rotateY(float a) {
  float s = sin(a), c = cos(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}
mat3 rotateZ(float a) {
  float s = sin(a), c = cos(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

/** Rotation by angle (radians) about a unit axis (Rodrigues' formula). */
mat3 rotateAxis(vec3 axis, float angle) {
  float s = sin(angle), c = cos(angle), k = 1.0 - c;
  vec3 a = axis;
  return mat3(
    c + a.x * a.x * k,       a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
    a.x * a.y * k - a.z * s, c + a.y * a.y * k,       a.z * a.y * k + a.x * s,
    a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k
  );
}

/** Rotate v by the unit quaternion q = (x, y, z, w), matching THREE.Quaternion. */
vec3 quatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
`;
