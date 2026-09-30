/**
 * Cloud layer shaders (GLSL ES 3.00). Like the atmosphere shell, the layer is a back-face sphere that only
 * decides which pixels to shade: the cloud sphere and the planet are intersected analytically from the
 * interpolated mesh point (precise at any distance), the hit is a unit direction n in sphere space (oblate
 * bodies are stretched back to a sphere), and the density field (cloudField.glsl.ts) is evaluated there. The
 * hit's depth is written so nearer opaque objects occlude the layer and the planet's own surface hides it.
 *
 * Lighting, all analytic:
 *   direct    sun * exp(-tauSun * airmass(mu0)): sunlight reddens through the air above the clouds towards the
 *             terminator; wrap-lambert on the bump normal (density gradient) so the fine texture has relief
 *   shadow    one tap of the coarse field towards the sun: taller cloud upstream shades this one
 *   silver    forward scattering: thin cloud edges glow when the sun is behind them
 *   ambient   sky tint, dim on the night side; thick cores are brighter, thin edges greyer
 * Output is premultiplied: (radiance * alpha, alpha).
 */
import { common } from '../../shaders/common.glsl';
import { noise } from '../../shaders/noise.glsl';
import { skyEclipseGlsl } from '../atmosphere/eclipse.glsl';
import { cloudFieldGlsl } from './cloudField.glsl';

export const cloudVertex = /* glsl */ `
uniform float uMeshR;
out vec3 vQ;
out vec3 vView;

void main() {
  vQ = position * uMeshR;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const cloudFragment = /* glsl */ `
${common}
${noise}
${cloudFieldGlsl}
${skyEclipseGlsl}

uniform vec4 uGeom;        // x: cloud sphere radius, y: planet radius, z: 1 - oblateness
uniform vec3 uCamQ;
uniform vec3 uSun;         // sphere space
uniform vec3 uSunRad;
uniform mat4 projectionMatrix;   // three.js sets it per render call (each depth slice has its own near/far)
uniform vec3 uColor;
uniform vec3 uSunTau;
uniform vec3 uSky;
uniform vec4 uLook;        // max opacity, intensity, shadow tap (0/1), bump strength
uniform float uSunAng;     // angular radius of the star (rad)
uniform vec4 uOcc[4];      // eclipse casters (body frame centre, radius)
uniform int uOccCount;

in vec3 vQ;
in vec3 vView;
out vec4 fragColor;

/** Kasten & Young (1989) relative air mass for cos(zenith) mu. */
float cloudAirmass(float mu) {
  float m = clamp(mu, 0.0, 1.0);
  float zenithDeg = degrees(acos(m));
  return 1.0 / (m + 0.50572 * pow(max(96.07995 - zenithDeg, 1.0), -1.6364));
}

void main() {
  vec3 dq = vQ - uCamQ;
  float camDist = length(dq);
  vec3 d = dq / camDist;
  float rc = uGeom.x;
  bool inside = dot(uCamQ, uCamQ) < rc * rc;

  vec2 tc = raySphere(vQ, d, vec3(0.0), rc);
  bool valid = tc.x < tc.y;
  float tHit = inside ? tc.y : tc.x;
  vec2 tp = raySphere(vQ, d, vec3(0.0), uGeom.y);
  if (tp.x < tp.y && tp.x < tHit && tp.y > -camDist) valid = false;   // the ground is in front
  vec3 pHit = vQ + d * (valid ? tHit : 0.0);
  vec3 n = normalize(pHit);
  float fp = length(fwidth(n));                 // pixel footprint on the unit sphere (rad)
  if (!valid) discard;

  // The pattern lives in the body frame: the sphere-space direction is also the body-frame direction up
  // to the oblate stretch, which the field ignores (the cloud shell follows the sphere).
  vec3 grad;
  float m = cloudMask(n, fp, 1.0, grad);
  float soft = uCloudA.z > 0.5 ? 0.24 : 0.12;
  float dens = smoothstep(-soft, soft, m);
  if (uCloudA.w > 0.5) dens = mix(0.92, 1.0, dens);   // overcast: never a hole, only thinner and thicker
  if (dens <= 0.002) discard;
  float thick = clamp(m / 0.45, 0.0, 1.0);

  // Lighting
  float mu0 = dot(n, uSun);
  vec3 gt = grad - n * dot(grad, n);
  vec3 nb = normalize(n - uLook.w * gt);
  float wrap = 0.25;
  float diffuse = mix(
    clamp((mu0 + wrap) / (1.0 + wrap), 0.0, 1.0),
    clamp((dot(nb, uSun) + wrap) / (1.0 + wrap), 0.0, 1.0),
    0.65
  );
  float shadow = 1.0;
  if (uLook.z > 0.5 && mu0 > -0.1) {
    // Coarse field one step towards the sun (tangent part of the sun direction, longer at low sun).
    vec3 lt = uSun - n * mu0;
    float len = 0.014 / max(mu0 + 0.15, 0.15);
    vec3 ns = normalize(n + lt * len);
    vec3 g2;
    float ms = cloudMask(ns, fp, 0.0, g2);
    shadow = clamp(1.0 - 1.5 * max(ms - m, 0.0), 0.25, 1.0);
  }
  float horizon = smoothstep(-0.12, 0.03, mu0) * skyEclipseAll(pHit, uSun, uOcc, uOccCount, uSunAng);
  vec3 sunT = exp(-uSunTau * cloudAirmass(mu0));
  vec3 view = -d;
  // Forward scattering: thin cloud edges glow when the sun is behind them (view direction against the sun).
  float silver = pow(clamp(-dot(view, uSun), 0.0, 1.0), 6.0) * (1.0 - 0.7 * thick);
  vec3 direct = uSunRad * sunT * (diffuse * shadow * horizon);
  vec3 rim = uSunRad * sunT * (0.7 * silver * horizon);
  vec3 ambient = uSky * uSunRad * (0.02 + 0.09 * clamp(mu0 + 0.25, 0.0, 1.0)) * mix(vec3(1.0), sunT, 0.5);
  float bright = mix(uCloudA.w > 0.5 ? 0.6 : 0.8, 1.0, thick);
  vec3 lit = uColor * bright * (direct + rim + ambient);
  if (inside) lit *= 0.45;                       // seen from below: light through the deck

  float alpha = uLook.x * dens;
  fragColor = vec4(lit * alpha, alpha) * uLook.y;

  // Slightly nearer than the true hit (1%): a 24-bit depth buffer cannot separate a shell from the surface
  // it hovers over at large distances, and a shell is always in front of its own planet by construction.
  float lam = 0.99 * (tHit + camDist) * length(vec3(d.x, d.y * uGeom.z, d.z));
  float depth = 0.0;
  if (lam > 1e-3) {
    vec4 c = projectionMatrix * vec4(normalize(vView) * lam, 1.0);
    depth = clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
  }
  gl_FragDepth = depth;
}
`;
