/**
 * Ring shader (GLSL ES 3.00): single-scattering slab photometry, the planet's shadow, optical-depth
 * transparency.
 *
 * Per pixel of the annulus (body frame, km):
 *   tau     normal optical depth from `ringStructure` (ringProfile.glsl.ts)
 *   mu, mu0 |cosine| of the view and sun directions to the ring normal; the slab is lit from one side
 *   reflection (viewer and sun on the same side), Chandrasekhar / Cuzzi et al. (2002):
 *       I/F = (w P / 4) mu0 / (mu0 + mu) (1 - exp(-tau (1/mu + 1/mu0)))
 *   transmission (viewer on the unlit side):
 *       I/F = (w P / 4) mu0 / (mu0 - mu) (exp(-tau/mu0) - exp(-tau/mu))     (limit tau/mu0 exp(-tau/mu0))
 *   so the dense B ring is dark from the unlit side while the C ring and the gaps glow, and a dusty ring with a
 *   strong forward lobe lights up when the sun is behind it. P is a two-lobe Henyey-Greenstein phase function
 *   (normalised to mean 1) with an opposition surge; `L = sunRadiance * I/F` in the shared "normalised sun"
 *   convention (a white Lambertian surface facing the sun has radiance sunRadiance).
 *   alpha = 1 - exp(-tau/mu): the direct transmittance, so the output composes as dst * (1 - alpha) + radiance.
 * The planet's shadow is the sun disc's overlap with the planet's disc seen from the ring point, so the
 * shadow has a physical penumbra. Oblate planets are handled in sphere space (y / (1 - f)).
 *
 * Two draws share this program: uHalf = +1 keeps the part of the ring behind the plane through the planet's
 * centre perpendicular to the view direction, -1 the part in front (RENDER_ORDER.ringsFar / ringsNear).
 */
import { common } from '../../shaders/common.glsl';
import { skyEclipseGlsl } from '../atmosphere/eclipse.glsl';
import { ringProfileGlsl } from './ringProfile.glsl';

export const ringVertex = /* glsl */ `
out vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ringFragment = /* glsl */ `
${common}
${ringProfileGlsl}
${skyEclipseGlsl}

uniform vec4 uRing;        // inner, outer, peak tau, seed phase
uniform float uHalf;       // +1: far half, -1: near half
uniform vec3 uCam;         // camera, body frame (km)
uniform vec3 uSunL;        // unit vector to the star, body frame
uniform vec3 uSunQ;        // the same in sphere space (oblateness undone)
uniform vec3 uSunRad;      // star colour * intensity
uniform float uSunAng;     // angular radius of the star (rad)
uniform float uPlanetR;    // planet equatorial radius (km)
uniform vec3 uColor;       // particle albedo colour
uniform vec4 uPhase;       // forward g, backward g, backward weight, opposition surge
uniform float uMs;         // multiple-scattering gain
uniform float uIntensity;
uniform vec4 uOcc[4];      // eclipse casters (moons): body frame centre, radius
uniform int uOccCount;

in vec3 vP;
out vec4 fragColor;

float ringHG(float g, float c) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-3), 1.5));
}

vec3 ringRamp(float t) {
  vec3 c = mix(vec3(0.6, 0.57, 0.53), vec3(1.0, 0.88, 0.72), smoothstep(0.0, 0.45, t));
  return mix(c, vec3(0.92, 0.9, 0.86), smoothstep(0.55, 0.95, t));
}

/** Sunlight reaching the ring point P past the planet (umbra, penumbra, antumbra). */
float planetVisibility(vec3 P) {
  vec3 c = -P;
  float dist = length(c);
  float along = dot(c, uSunQ);
  if (along <= 0.0 || dist <= uPlanetR) return 1.0;
  float rho = asin(min(uPlanetR / dist, 1.0));
  float sep = acos(clamp(along / dist, -1.0, 1.0));
  return 1.0 - skyDiscOverlap(uSunAng, rho, sep);
}

void main() {
  float r = length(vP.xz);
  float u = (r - uRing.x) / (uRing.y - uRing.x);
  if (u < 0.0 || u > 1.0) discard;
  float side = dot(vP, uCam);
  if (uHalf > 0.0 ? side > 0.0 : side < 0.0) discard;

  float du = fwidth(r) / (uRing.y - uRing.x);
  vec3 st = ringStructure(u, uRing.w, du, uRing.z);
  float tau = uRing.z * st.x;
  if (tau < 2e-4) discard;

  vec3 V = normalize(uCam - vP);
  float mu = max(abs(V.y), 0.004);
  float mu0 = max(abs(uSunL.y), 0.004);
  bool sameSide = V.y * uSunL.y > 0.0;
  float cosT = -dot(uSunL, V);                       // scattering angle: light travels along -L
  float phase = 4.0 * PI * ((1.0 - uPhase.z) * ringHG(uPhase.x, cosT) + uPhase.z * ringHG(-uPhase.y, cosT));
  float tanHalf = sqrt(max((1.0 - dot(uSunL, V)) / max(1.0 + dot(uSunL, V), 1e-3), 0.0));
  phase *= 1.0 + uPhase.w / (1.0 + tanHalf / 0.06);   // opposition surge

  vec3 albedo = uColor * ringRamp(st.y) * st.z;
  float e0 = exp(-tau / mu0);
  float e1 = exp(-tau / mu);
  float dm = mu0 - mu;
  float slab;
  if (sameSide) slab = mu0 / (mu0 + mu) * (1.0 - e0 * e1);
  else slab = abs(dm) > 2e-3 ? mu0 * (e0 - e1) / dm : (tau / mu0) * e0;
  float multi = 1.0 + uMs * (1.0 - exp(-tau)) * dot(albedo, vec3(0.3333));
  vec3 radiance = albedo * (0.25 * phase * slab * multi) * uSunRad * (planetVisibility(vP) * skyEclipseAll(vP, uSunL, uOcc, uOccCount, uSunAng));

  float alpha = 1.0 - e1;
  fragColor = vec4(radiance, alpha) * uIntensity;   // premultiplied
}
`;
