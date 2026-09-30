/**
 * Atmosphere shell shaders (GLSL ES 3.00): analytic single scattering in sphere space.
 *
 * The shell is a back-face sphere slightly larger than the atmosphere: it covers the disc from outside and
 * the whole screen from inside, so one code path serves every camera position. The atmosphere and the planet
 * are intersected analytically (`raySphere`, precise at large distances); the mesh only says WHICH pixels to
 * shade. All ray maths is relative to the interpolated mesh point vQ (which is near the planet), never to the
 * camera, so nothing cancels catastrophically when the camera is millions of km away.
 *
 * Two passes share this program (uPass): 0 writes the view-ray transmittance T (blended dst * T) and 1 the
 * in-scattered radiance (added), giving dst * T + inscatter with per-channel T: a star behind the limb reddens
 * and the surface near the limb is tinted, not just dimmed.
 *
 * Samples are placed by altitude, not length: they cluster around the ray's lowest point (the ground hit, the
 * tangent point of a limb ray, or the camera when looking up) where the density lives, in increasing t so the
 * view transmittance accumulates in order. Sunlight at each sample is one fetch of the transmittance table
 * (transmittance.ts). Depth is written analytically (the first atmosphere point on the ray) so nearer opaque
 * objects (moons) occlude the shell correctly while the planet's own surface is hazed.
 */
import { common } from '../../shaders/common.glsl';

export const atmosphereVertex = /* glsl */ `
uniform float uMeshR;
out vec3 vQ;
out vec3 vView;

void main() {
  vQ = position * uMeshR;              // sphere space (oblateness undone)
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const atmosphereFragment = /* glsl */ `
${common}

uniform sampler2D uLut;
uniform vec4 uLutScale;    // xy: 1 - 1/size, zw: 0.5/size (texel-centre mapping), x: mu axis, y: r axis
uniform vec4 uGeom;        // x: planet radius, y: top radius, z: sqrt(top^2 - planet^2), w: 1 - oblateness
uniform vec3 uCamQ;        // camera, sphere space (km)
uniform vec3 uSun;         // unit vector to the star, sphere space
uniform vec3 uSunE;        // pi * sun radiance * gain
uniform float uSunAng;     // angular radius of the star (rad)
uniform vec3 uBetaR;       // Rayleigh scattering (1/km) at the surface
uniform vec3 uBetaMS;      // Mie scattering
uniform vec3 uBetaME;      // Mie extinction
uniform vec3 uBetaA;       // absorber extinction at its peak
uniform vec4 uProf;        // 1/Hr, 1/Hm, absorber centre (km), 1/absorber width
uniform vec4 uPhase;       // mie g, multiple-scattering blend (rayleigh, mie)
uniform int uSamples;
uniform float uPass;
uniform float uIntensity;
uniform mat4 uProj;

in vec3 vQ;
in vec3 vView;
out vec4 fragColor;

const float INV_4PI = 0.07957747154594767;

float phaseRayleigh(float c) {
  return 0.05968310365946075 * (1.0 + c * c);                 // 3 / (16 pi)
}

/** Cornette & Shanks (1992): Henyey-Greenstein corrected to satisfy Rayleigh at g = 0. */
float phaseMie(float c, float g) {
  float g2 = g * g;
  return 0.11936620731892151 * (1.0 - g2) / (2.0 + g2) * (1.0 + c * c)
       / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);         // 3 / (8 pi)
}

/** 1 - exp(-x), stable for small x. */
vec3 oneMinusExp(vec3 x) {
  vec3 small = x * (1.0 - 0.5 * x * (1.0 - 0.3333333 * x));
  return mix(1.0 - exp(-x), small, vec3(lessThan(x, vec3(1e-3))));
}

/** Optical depth from radius r along zenith cosine mu to the top of the atmosphere (table look-up). */
vec3 sunOpticalDepth(float r, float mu) {
  float rp = uGeom.x;
  float rt = uGeom.y;
  float h = max(r - rp, 0.0);
  float rho = sqrt(h * (2.0 * rp + h));                       // distance to the horizon
  float disc = max(rt * rt - r * r * (1.0 - mu * mu), 0.0);
  float d = -r * mu + sqrt(disc);                             // distance to the top boundary
  float dMin = max(rt - r, 0.0);
  float dMax = rho + uGeom.z;
  float xMu = clamp((d - dMin) / max(dMax - dMin, 1e-4), 0.0, 1.0);
  float xR = clamp(rho / uGeom.z, 0.0, 1.0);
  return texture(uLut, vec2(xMu, xR) * uLutScale.xy + uLutScale.zw).rgb;
}

/**
 * Fraction of the star's disc visible from a point at radius r with sun zenith cosine mu: the planet's
 * shadow with a penumbra whose width is the star's angular size at the distance of the tangent point.
 */
float sunVisibility(float r, float mu) {
  if (mu >= 0.0) return 1.0;
  float tangentAlt = r * sqrt(max(1.0 - mu * mu, 0.0)) - uGeom.x;
  float w = uSunAng * r * -mu;
  return smoothstep(-w, w, tangentAlt);
}

vec3 march(vec3 p0, vec3 d, float t0, float t1, float jit, bool scatter, out vec3 tView) {
  tView = vec3(1.0);
  vec3 inscatter = vec3(0.0);
  float rp = uGeom.x;
  float tc = -dot(p0, d);                       // closest approach to the planet centre
  float ts = clamp(tc, t0, t1);                 // lowest point of the segment
  float la = ts - t0;
  float lb = t1 - ts;
  int n = uSamples;
  int nA = (la > 0.0 && lb > 0.0) ? n / 2 : (la > 0.0 ? n : 0);
  int nB = n - nA;
  float cosT = dot(d, uSun);
  float pR = mix(phaseRayleigh(cosT), INV_4PI, uPhase.y);
  float pM = mix(phaseMie(cosT, uPhase.x), INV_4PI, uPhase.z);

  for (int i = 0; i < 24; i++) {
    if (i >= n) break;
    bool sideA = i < nA;
    int k = sideA ? nA - 1 - i : i - nA;
    float cnt = float(sideA ? nA : nB);
    float u0 = float(k) / cnt;
    float u1 = float(k + 1) / cnt;
    float len = sideA ? la : lb;
    float uj = mix(u0, u1, jit);
    float dt = len * (u1 * u1 - u0 * u0);       // quadratic spacing: dense next to the lowest point
    float dist = len * uj * uj;
    vec3 p = p0 + d * (sideA ? ts - dist : ts + dist);

    float r = max(length(p), rp);
    float h = r - rp;
    float dR = exp(-h * uProf.x);
    float dM = exp(-h * uProf.y);
    float dA = exp(-abs(h - uProf.z) * uProf.w);
    vec3 ext = uBetaR * dR + uBetaME * dM + uBetaA * dA;
    vec3 stepT = exp(-ext * dt);
    if (scatter) {
      float mu = dot(p, uSun) / r;
      vec3 sunT = exp(-sunOpticalDepth(r, mu)) * sunVisibility(r, mu);
      vec3 src = sunT * (uBetaR * (dR * pR) + uBetaMS * (dM * pM));
      // Energy-conserving integration of src * exp(-ext s) over the step (Hillaire 2020).
      inscatter += tView * src * oneMinusExp(ext * dt) / max(ext, vec3(1e-8));
    }
    tView *= stepT;
  }
  return inscatter * uSunE;
}

void main() {
  vec3 dq = vQ - uCamQ;
  float camDist = length(dq);
  vec3 d = dq / camDist;

  vec2 ta = raySphere(vQ, d, vec3(0.0), uGeom.y);
  if (ta.x >= ta.y) discard;
  float t0 = max(ta.x, -camDist);               // entry, or the camera itself when inside
  float t1 = ta.y;
  vec2 tp = raySphere(vQ, d, vec3(0.0), uGeom.x);
  if (tp.x < tp.y && tp.y > t0) t1 = min(t1, max(tp.x, t0));
  if (t1 <= t0 + 1e-4) discard;

  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 tView;
  vec3 inscatter = march(vQ, d, t0, t1, jit, uPass > 0.5, tView);
  if (uPass < 0.5) fragColor = vec4(mix(vec3(1.0), tView, uIntensity), 1.0);
  else fragColor = vec4(inscatter * uIntensity, 0.0);

  // Depth of the first atmosphere point on this pixel's ray (true distance: undo the oblate stretch).
  // Slightly nearer than the true entry (1%): a 24-bit depth buffer cannot separate a shell from the surface
  // it hovers over at large distances, and a shell is always in front of its own planet by construction.
  float lam = 0.99 * (t0 + camDist) * length(vec3(d.x, d.y * uGeom.w, d.z));
  float depth = 0.0;
  if (lam > 1e-3) {
    vec4 c = uProj * vec4(normalize(vView) * lam, 1.0);
    depth = clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
  }
  gl_FragDepth = depth;
}
`;
