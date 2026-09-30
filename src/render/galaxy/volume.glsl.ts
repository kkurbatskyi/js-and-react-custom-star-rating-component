/**
 * Volume pass shaders (see ./GalaxyVolume.ts):
 *
 * 1. `marchFragment` — reduced resolution. Emission–absorption raymarch through the galaxy,
 *    bounded by the disk cylinder/slab. Emission ∝ Σ ρ_c L_c (population colours), absorption ∝
 *    dust with per-channel extinction (reddening). Each step integrates exactly for piecewise
 *    constant coefficients: L += T · j · (1 − e^(−α·dt)) / α. Steps adapt to what the ray crosses:
 *      dt = min(kY·(|y| + h)/|d_y|,  kR·(|p| + r0),  kT·t + dtMin)   clamped to [dtMin, dtMax]
 *    — fine near the midplane for rays crossing the disk, fine near the centre, geometric from the
 *    camera when inside the disk — with a per-pixel interleaved-gradient-noise start jitter. In the
 *    second half of the budget steps also stretch to reach the exit. Alpha = emission-weighted
 *    distance (kly) for reprojection.
 * 2. `resolveFragment` — temporal accumulation: reproject the history with that distance, clamp it
 *    to the current 3×3 neighbourhood, blend.
 * 3. `compositeFragment` — full resolution, additive, bilinear upsampling.
 */
import { galaxyFields } from './fields.glsl';

export const fullScreenVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const viewRay = /* glsl */ `
uniform mat3 uCamRot;
uniform mat4 uProjInv;
/** World (galactic-axes) direction of the view ray through screen uv. */
vec3 viewRay(vec2 uv) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  return normalize(uCamRot * (v.xyz / v.w));
}
`;

/** Ray bounds and the deterministic dust column used as the upsampling guide (march + composite). */
const dustGuide = /* glsl */ `
uniform float uBoundR;

/** Ray interval inside the slab |y| < halfY and the cylinder R < uBoundR (empty: x >= y). */
vec2 slabBounds(vec3 ro, vec3 rd, float halfY) {
  float t0 = 0.0;
  float t1 = 1e30;
  if (abs(rd.y) > 1e-8) {
    float a = (-halfY - ro.y) / rd.y;
    float b = (halfY - ro.y) / rd.y;
    t0 = max(t0, min(a, b));
    t1 = min(t1, max(a, b));
  } else if (abs(ro.y) > halfY) {
    return vec2(1.0, 0.0);
  }
  float a = dot(rd.xz, rd.xz);
  if (a < 1e-12) {
    if (dot(ro.xz, ro.xz) > uBoundR * uBoundR) return vec2(1.0, 0.0);
  } else {
    // Closest approach to the axis first (precise for distant cameras; Ray Tracing Gems ch. 7).
    float tc = -dot(ro.xz, rd.xz) / a;
    vec2 f = ro.xz + tc * rd.xz;
    float disc = uBoundR * uBoundR - dot(f, f);
    if (disc < 0.0) return vec2(1.0, 0.0);
    float h = sqrt(disc / a);
    t0 = max(t0, tc - h);
    t1 = min(t1, tc + h);
  }
  return vec2(t0, t1);
}

/**
 * Green optical depth of the (planar, clumped) dust along a ray: 12 stratified sub-segments of
 * the dust slab, the vertical sech^2 integrated analytically per sub-segment. Deterministic, so
 * the low-res march and the full-res composite agree where the dust is smooth.
 */
float dustGuideTau(vec3 ro, vec3 rd, float pixelAngle) {
  vec2 span = slabBounds(ro, rd, 4.0 / uGalInvHDust);
  if (span.x >= span.y) return 0.0;
  float ds = min(span.y - span.x, 3e5) / 12.0;
  float horizontal = length(rd.xz);
  float column = 0.0;
  for (int k = 0; k < 12; k++) {
    float ta = span.x + ds * float(k);
    float tm = ta + 0.5 * ds;
    vec3 q = ro + rd * tm;
    float lod = galMapLod(max(tm * pixelAngle, 0.5 * ds * horizontal));
    column += galDustPlanar(galMap(q.xz, lod))
      * galSech2Segment(ro.y + rd.y * ta, ro.y + rd.y * (ta + ds), ds, uGalInvHDust);
  }
  return column * uGalExtinction.g;
}
`;

export const marchFragment = /* glsl */ `
precision highp float;
precision highp sampler3D;
${galaxyFields}
${viewRay}
${dustGuide}
uniform vec3 uCameraLy;
uniform float uPixelAngle;
uniform float uFrame;
uniform int uSteps;
uniform float uBoundY;
uniform vec4 uStepK;       // kY, kR, kT, h
uniform vec3 uStepLimits;  // dtMin, dtMax, r0
uniform vec3 uColThin;
uniform vec3 uColThinInner;
uniform vec3 uColThick;
uniform vec3 uColArm;
uniform vec3 uColArmInner;
uniform vec2 uArmDetail;   // arm mottling by the filament noise, beading by star-forming clumps
uniform vec3 uColSpheroid;
uniform vec3 uColHii;
uniform float uMottle;
uniform vec4 uLight;       // light per star: disk, arm, spheroid; colour-gradient radius (ly)
uniform vec2 uKnee;        // knee (unscaled light), gamma
uniform sampler3D uNoise;
uniform vec3 uNear;        // 3D-clump weight at the camera, its fade range (ly), emission near fade (ly)

in vec2 vUv;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragGuide;

/** Emission (radiance per ly) and extinction (per ly) at p; dist = distance from the camera. */
void galaxySample(vec3 p, float lod, float dist, out vec3 emission, out vec3 extinction) {
  float r2 = dot(p.xz, p.xz);
  float r = sqrt(r2);
  vec4 m = galMap(p.xz, lod);
  // Clumping/mottling noise: the map's planar filaments far away; within a few kly a true 3D
  // noise instead. The map's fields are planar x sech^2, so seen from nearby every feature would be
  // a vertical column (stripes in the sky, curtains below the camera).
  float n = m.a;
  float near = uNear.x * exp(-dist / uNear.y);
  if (near > 0.01) {
    float n3 = 0.6 * texture(uNoise, p * (1.0 / 1730.0)).r + 0.4 * texture(uNoise, p.zyx * (1.0 / 410.0)).r;
    n = mix(n, 3.0 * (n3 - 0.5), min(near, 1.0));
  }
  float disk = galDiskRadial(r);
  float ay = abs(p.y);
  float armV = galSech2(ay * uGalInvHArm);
  float thin = disk * galSech2(ay * uGalInvHz);
  float thick = disk * uGalThickNorm * galSech2(ay * uGalInvHThick);
  float arm = disk * uGalArmStrength * m.r * armV;
  float sph = galSpheroid(p, r2);
  // Highlight compression on the light emissivity (identical to the particles' fluxes).
  float light = uLight.x * (thin + thick) + uLight.y * arm + uLight.z * sph;
  float squeeze = light > uKnee.x ? pow(light / uKnee.x, uKnee.y - 1.0) : 1.0;
  // Unresolved light near the camera belongs to the starfield layer: fade it like the particles.
  squeeze *= smoothstep(0.3 * uNear.z, uNear.z, dist);
  // Old, metal-rich inner disk is warmer, and its arms older: blend both colours with radius.
  float outer = smoothstep(0.0, uLight.w, r);
  vec3 thinColor = mix(uColThinInner, uColThin, outer);
  vec3 armColor = mix(uColArmInner, uColArm, outer);
  float armLight = arm * max(0.0, 1.0 - uArmDetail.x * n) + disk * uGalArmStrength * armV * m.b * uArmDetail.y;
  emission = squeeze * (thinColor * (thin * max(0.0, 1.0 - uMottle * n)) + uColThick * thick
    + armColor * armLight + uColSpheroid * sph + uColHii * (disk * m.b * armV));
  float dust = galDustClumped(m.g, n) * galSech2(ay * uGalInvHDust);
  extinction = uGalExtinction * dust;
}

/** Interleaved gradient noise (Jimenez 2014): cheap, well-distributed per-pixel jitter. */
float ign(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 ro = uCameraLy;
  vec3 rd = viewRay(vUv);
  fragGuide = vec4(dustGuideTau(ro, rd, uPixelAngle), 0.0, 0.0, 1.0);
  vec2 span = slabBounds(ro, rd, uBoundY);
  if (span.x >= span.y) {
    fragColor = vec4(0.0, 0.0, 0.0, 1e3);
    return;
  }
  float jitter = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803398875);
  float horizontal = length(rd.xz);
  float invDy = 1.0 / max(abs(rd.y), 1e-4);
  vec3 radiance = vec3(0.0);
  vec3 transmittance = vec3(1.0);
  float wSum = 0.0;
  float dSum = 0.0;
  float t = span.x;
  float halfSteps = 0.5 * float(uSteps);
  for (int i = 0; i < 160; i++) {
    if (i >= uSteps || t >= span.y) break;
    vec3 p = ro + rd * t;
    float dt = min(uStepK.x * (abs(p.y) + uStepK.w) * invDy, uStepK.y * (length(p) + uStepLimits.z));
    dt = min(dt, uStepK.z * t + uStepLimits.x);
    dt = clamp(dt, uStepLimits.x, uStepLimits.y);
    if (float(i) >= halfSteps) dt = max(dt, (span.y - t) / (float(uSteps - i)));
    dt = min(dt, span.y - t);
    float ts = t + dt * jitter;
    vec3 ps = ro + rd * ts;
    float lod = galMapLod(max(ts * uPixelAngle, 0.3 * dt * horizontal));
    vec3 emission;
    vec3 extinction;
    galaxySample(ps, lod, ts, emission, extinction);
    vec3 x = extinction * dt;
    vec3 stepT = exp(-x);
    // (1 - e^-x) / x, with its series near 0 (avoids 0/0 and float cancellation).
    vec3 w = mix((1.0 - stepT) / max(x, vec3(1e-6)), 1.0 - 0.5 * x, lessThan(x, vec3(1e-3)));
    vec3 c = transmittance * emission * w * dt;
    radiance += c;
    float cl = dot(c, vec3(0.2126, 0.7152, 0.0722));
    wSum += cl;
    dSum += cl * ts;
    transmittance *= stepT;
    if (max(transmittance.r, max(transmittance.g, transmittance.b)) < 0.003) break;
    t += dt;
  }
  float depth = wSum > 0.0 ? dSum / wSum : 0.5 * (span.x + span.y);
  fragColor = vec4(radiance, depth * 1e-3);
}
`;

export const resolveFragment = /* glsl */ `
precision highp float;
${viewRay}
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform mat4 uPrevViewProj;
uniform vec3 uCamDelta;
uniform float uAlpha;

in vec2 vUv;
out vec4 fragColor;

void main() {
  ivec2 size = textureSize(uCurrent, 0);
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 cur = texelFetch(uCurrent, ip, 0);
  vec3 lo = cur.rgb;
  vec3 hi = cur.rgb;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec3 c = texelFetch(uCurrent, clamp(ip + ivec2(i, j), ivec2(0), size - 1), 0).rgb;
      lo = min(lo, c);
      hi = max(hi, c);
    }
  }
  vec3 result = cur.rgb;
  if (uAlpha < 1.0) {
    vec3 x = viewRay(vUv) * (cur.a * 1e3) + uCamDelta;
    vec4 clip = uPrevViewProj * vec4(x, 1.0);
    if (clip.w > 0.0) {
      vec2 puv = clip.xy / clip.w * 0.5 + 0.5;
      if (all(greaterThanEqual(puv, vec2(0.0))) && all(lessThanEqual(puv, vec2(1.0)))) {
        vec3 pad = 0.1 * (hi - lo);
        vec3 history = clamp(texture(uHistory, puv).rgb, lo - pad, hi + pad);
        result = mix(history, cur.rgb, uAlpha);
      }
    }
  }
  fragColor = vec4(result, cur.a);
}
`;

export const compositeFragment = /* glsl */ `
precision highp float;
${galaxyFields}
${viewRay}
${dustGuide}
uniform sampler2D uVolume;   // resolved radiance, low resolution
uniform sampler2D uGuide;    // low-res dust optical depth (this frame's march)
uniform vec3 uCameraLy;
uniform float uPixelAngleFull;
uniform float uGuided;
uniform float uGain;
in vec2 vUv;
out vec4 fragColor;

void main() {
  if (uGuided < 0.5) {
    fragColor = vec4(texture(uVolume, vUv).rgb * uGain, 1.0);
    return;
  }
  // Joint bilateral upsampling guided by dust: the 2x2 low-res taps are weighted by how similar
  // their optical depth is to this pixel's, so lane edges stay sharp at full resolution.
  float tau = dustGuideTau(uCameraLy, viewRay(vUv), uPixelAngleFull);
  ivec2 size = textureSize(uVolume, 0);
  vec2 st = vUv * vec2(size) - 0.5;
  vec2 base = floor(st);
  vec2 f = st - base;
  vec3 sum = vec3(0.0);
  float wSum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 c = clamp(ivec2(base) + ivec2(i, j), ivec2(0), size - 1);
      float tapTau = texelFetch(uGuide, c, 0).r;
      float bilinear = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      float w = bilinear * exp(-2.0 * abs(tapTau - tau)) + 1e-5;
      sum += texelFetch(uVolume, c, 0).rgb * w;
      wSum += w;
    }
  }
  fragColor = vec4(sum / wSum * uGain, 1.0);
}
`;
