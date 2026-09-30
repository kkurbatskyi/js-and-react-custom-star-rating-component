/**
 * Black hole shader: a per-pixel geodesic integration in the Schwarzschild metric (units of the
 * Schwarzschild radius r_s = 1).
 *
 * For each pixel the ray lies in a plane through the hole; with u = 1/r and the polar angle phi
 * around the hole it obeys the photon orbit equation
 *
 *     d²u/dphi² = -u + (3/2) u²           (Schwarzschild, r_s = 1; e.g. Luminet 1979)
 *
 * which is integrated with a leapfrog scheme starting at the camera (u0 = 1/D, du/dphi from the
 * local viewing angle). A ray is *captured* when u reaches 1 (r = r_s) and escapes once u is small
 * again. Crossings of the equatorial plane (the accretion disk, r_in = 3 = ISCO) are found from the
 * sign changes of A cos(phi) + B sin(phi) between steps, so the disk's primary image, the far side
 * lensed over the top of the shadow and the higher-order images all come out of one integration.
 *
 * Disk: thin Novikov-Thorne-like temperature profile T ~ x^(-3/4) (1 - x^(-1/2))^(1/4), Keplerian
 * orbital speed beta = 1/sqrt(2 (r - 1)), relativistic Doppler beaming and gravitational redshift
 * g = delta * sqrt(1 - 1/r): one side brighter and bluer, the colour from the shifted blackbody.
 *
 * The output is premultiplied: alpha = 1 inside the shadow (the background is hidden), the disk's
 * coverage elsewhere, 0 far from the hole. Background sky lensing is the post effect's job (lensing.ts).
 */
import { color } from '../shaders/color.glsl';
import { common } from '../shaders/common.glsl';
import { noise } from '../shaders/noise.glsl';

export const holeVertex = /* glsl */ `
uniform float uQuadKm;       // half size of the quad around the hole, km
uniform float uFullscreen;   // 1: the disk fills the view, cover the whole screen
out vec3 vViewPos;
flat out vec3 vCentre;

void main() {
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vCentre = c.xyz;
  if (uFullscreen > 0.5) {
    vec4 cc = projectionMatrix * c;
    float z = cc.w > 1e-6 ? clamp(cc.z / cc.w, -1.0, 0.999) : 0.0;
    gl_Position = vec4(position.xy, z, 1.0);
    vViewPos = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.0);
  } else {
    vec3 vp = c.xyz + vec3(position.xy * uQuadKm, 0.0);
    vViewPos = vp;
    gl_Position = projectionMatrix * vec4(vp, 1.0);
  }
}
`;

export const holeFragment = /* glsl */ `
${common}
${color}
${noise}

uniform float uD;            // camera distance from the hole, in r_s
uniform vec3 uAxis;          // disk normal (spin axis) in view space
uniform float uInner;        // ISCO radius, r_s
uniform float uOuter;        // visible outer edge of the disk, r_s
uniform float uTmax;         // peak disk temperature, K
uniform float uGain;         // disk radiance scale (0 = no disk)
uniform float uBeaming;      // 0..1 strength of Doppler beaming
uniform float uTime;
uniform float uIntensity;
uniform float uSteps;
uniform float uShadowPx;     // shadow radius in device px (edge anti-aliasing)

in vec3 vViewPos;
flat in vec3 vCentre;
out vec4 fragColor;

const float BC = 2.598076;   // critical impact parameter 3 sqrt(3) / 2, in r_s

// Turbulent streaks that shear with the Keplerian angular velocity.
float discTexture(float rc, float thd) {
  float om = 2.2 * pow(rc, -1.5);
  float a = thd - om * uTime;
  vec3 q = vec3(log(rc) * 6.0, cos(a) * 2.0, sin(a) * 2.0);
  float n = snoise(q) * 0.55 + snoise(q * 2.7 + 3.0) * 0.3;
  float bands = 0.5 + 0.5 * sin(rc * 6.5 + 1.8 * n);
  return clamp(0.78 + 0.35 * n + 0.14 * bands, 0.2, 1.6);
}

void main() {
  vec3 rd = normalize(vViewPos);
  vec3 e1 = -normalize(vCentre);                 // hole -> camera
  float cosOut = dot(rd, e1);                    // > 0: the ray heads away from the hole
  vec3 tr = rd - cosOut * e1;
  float sinPsi = length(tr);
  float u = 1.0 / uD;
  float sqrtF = sqrt(max(1.0 - u, 1e-3));
  float b = uD * sinPsi / sqrtF;                 // impact parameter, r_s
  // Rays that cannot touch the disk or the shadow are transparent.
  if (b > uOuter * 1.6 || (cosOut > 0.0 && uD > uOuter * 1.2)) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 e2 = sinPsi > 1e-5
    ? tr / sinPsi
    : normalize(cross(e1, abs(e1.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  float v = u * sqrtF * (-cosOut) / max(sinPsi, 1e-5);   // du/dphi at the camera
  float A = dot(e1, uAxis);
  float B = dot(e2, uAxis);
  vec3 ex = normalize(cross(uAxis, abs(uAxis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 ey = cross(uAxis, ex);

  float dphi = 3.6 / uSteps;
  float cd = cos(dphi);
  float sd = sin(dphi);
  float cph = 1.0;
  float sph = 0.0;
  float hPrev = A;
  vec3 col = vec3(0.0);
  float T = 1.0;
  bool captured = false;
  int hits = 0;

  for (int i = 0; i < 200; i++) {
    if (float(i) >= uSteps) break;
    float acc = -u + 1.5 * u * u;
    v += 0.5 * dphi * acc;
    float uPrev = u;
    u += dphi * v;
    acc = -u + 1.5 * u * u;
    v += 0.5 * dphi * acc;
    float cn = cph * cd - sph * sd;
    sph = sph * cd + cph * sd;
    cph = cn;
    if (u >= 1.0) {
      captured = true;
      break;
    }
    float h = A * cph + B * sph;
    if (h * hPrev < 0.0 && hits < 3 && uGain > 0.0) {
      float t = hPrev / (hPrev - h);
      float uc = mix(uPrev, u, t);
      float rc = 1.0 / max(uc, 1e-3);
      if (rc > uInner * 0.98 && rc < uOuter) {
        float pc = dphi * (float(i) + t);
        float cc = cos(pc);
        float sc = sin(pc);
        vec3 rhat = cc * e1 + sc * e2;
        vec3 phat = -sc * e1 + cc * e2;
        vec3 pos = rc * rhat;
        float thd = atan(dot(pos, ey), dot(pos, ex));
        float x = rc / uInner;
        float f = pow(x, -0.75) * pow(max(1.0 - inversesqrt(x), 0.0), 0.25) * 2.049;  // / 0.488
        float tLoc = uTmax * f;
        // Doppler + gravitational shift of gas on a circular orbit, seen along the photon direction.
        float beta = min(inversesqrt(2.0 * max(rc - 1.0, 0.05)), 0.7);
        vec3 vorb = normalize(cross(uAxis, pos));
        float sinXi = clamp(b * uc * sqrt(max(1.0 - uc, 0.0)), 0.0, 1.0);
        float cosXi = sqrt(1.0 - sinXi * sinXi);
        vec3 kph = (v > 0.0 ? 1.0 : -1.0) * cosXi * rhat - sinXi * phat;
        float gam = inversesqrt(1.0 - beta * beta);
        float dop = 1.0 / (gam * (1.0 - beta * dot(vorb, kph)));
        float g = dop * sqrt(max(1.0 - 1.0 / rc, 0.02)) / sqrtF;
        float intensity = uGain * pow(f, 2.2) * discTexture(rc, thd) * mix(1.0, g * g * g, uBeaming);
        vec3 c = blackbody(clamp(tLoc * g, 1500.0, 40000.0)) * intensity;
        float al = 0.9 * smoothstep(uInner * 0.98, uInner * 1.12, rc) * (1.0 - smoothstep(uOuter * 0.7, uOuter, rc));
        col += T * al * c;
        T *= 1.0 - al;
        hits++;
      }
    }
    hPrev = h;
    if (u < 0.008 && v < 0.0) break;
  }

  float bRatio = b / BC;
  float w = clamp(1.5 / max(uShadowPx, 1.0), 0.004, 0.2);
  float sh = 1.0 - smoothstep(1.0 - w, 1.0 + w, bRatio);
  float alpha = 1.0;
  if (!captured) {
    // Photon ring: the thin bright line hugging the critical curve.
    float ring = exp(-pow((bRatio - 1.0 - 0.6 * w) / (0.02 + 0.8 * w), 2.0)) * step(1.0 - w, bRatio);
    col += T * ring * blackbody(clamp(uTmax * 0.9, 1500.0, 40000.0)) * (uGain * 1.1);
    alpha = max(1.0 - T, sh);
    col *= 1.0 - sh;
  }
  fragColor = vec4(col * uIntensity, alpha * uIntensity);
}
`;
