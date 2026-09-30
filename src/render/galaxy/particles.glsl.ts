/**
 * Galaxy particle shaders. Each particle is a Gaussian of world σ (ly) whose peak radiance
 * `aRadiance` is set so its flux matches its share of the galaxy's light (./particles.ts):
 * - constant surface brightness while resolved; below `uMinSigmaPx` the sprite keeps a stable
 *   minimum footprint and dims by the area ratio (flux conserved); above `uMaxSigmaPx` it is capped
 *   (fill rate) without brightening;
 * - line-of-sight dust: the camera→particle segment is clipped to the dust slab and integrated in
 *   `uLosSamples` sub-segments — planar dust from the map at each midpoint, the vertical sech²
 *   profile integrated analytically (`galSech2Segment`), so a few samples suffice at any angle;
 * - near fade: particles closer than `uNearFade` fade out (the starfield takes over).
 */
import { galaxyFields } from './fields.glsl';

export const particleVertex = /* glsl */ `
${galaxyFields}
uniform vec3 uCameraLy;
uniform float uPixelsPerRadian;
uniform float uNearFade;
uniform float uMinSigmaPx;
uniform float uMaxSigmaPx;
uniform float uEmission;
uniform vec3 uKindGain;
uniform int uLosSamples;

in vec3 aRadiance;
in float aSigma;
in float aKind;

out vec3 vColor;

/** Dust column (planar dust x sech^2, ly) along the segment a -> b. */
float losDust(vec3 a, vec3 b) {
  float slab = 5.0 / uGalInvHDust;
  vec3 d = b - a;
  float s0 = 0.0;
  float s1 = 1.0;
  if (abs(d.y) > 1e-3) {
    float ta = (-slab - a.y) / d.y;
    float tb = (slab - a.y) / d.y;
    s0 = max(s0, min(ta, tb));
    s1 = min(s1, max(ta, tb));
  } else if (abs(a.y) > slab) {
    return 0.0;
  }
  if (s1 <= s0) return 0.0;
  float len = length(d);
  float n = float(uLosSamples);
  float ds = (s1 - s0) * len / n;
  float lod = galMapLod(ds * length(d.xz) / max(len, 1e-3));
  float column = 0.0;
  for (int k = 0; k < 16; k++) {
    if (k >= uLosSamples) break;
    float sa = mix(s0, s1, float(k) / n);
    float sb = mix(s0, s1, float(k + 1) / n);
    vec3 q = a + d * (0.5 * (sa + sb));
    column += galDustPlanar(galMap(q.xz, lod))
      * galSech2Segment(a.y + d.y * sa, a.y + d.y * sb, ds, uGalInvHDust);
  }
  return column;
}

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(length(mv.xyz), 1e-3);
  float fade = smoothstep(0.35 * uNearFade, uNearFade, dist);
  float gain = aKind < 0.5 ? uKindGain.x : (aKind < 1.5 ? uKindGain.y : uKindGain.z);
  float sigmaPx = aSigma * uPixelsPerRadian / dist;
  float drawPx = clamp(sigmaPx, uMinSigmaPx, uMaxSigmaPx);
  float area = min(1.0, (sigmaPx * sigmaPx) / (drawPx * drawPx));
  vec3 color = aRadiance * (uEmission * gain * fade * area);
  if (max(color.r, max(color.g, color.b)) < 2e-5) {
    // Invisible: skip the dust integral and the fragments.
    vColor = vec3(0.0);
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vColor = color * exp(-uGalExtinction * losDust(uCameraLy, position));
  gl_PointSize = 5.0 * drawPx; // +-2.5 sigma
}
`;

export const particleFragment = /* glsl */ `
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 25.0; // (radius in sigma)^2
  if (r2 > 6.25) discard;
  fragColor = vec4(vColor * exp(-0.5 * r2), 1.0);
}
`;
