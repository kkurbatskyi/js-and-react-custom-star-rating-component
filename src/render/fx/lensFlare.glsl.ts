/**
 * Lens flare — the fragment shader of LensFlareEffect.
 *
 * Purely analytic, per source, in aspect-corrected screen space (unit = screen height, origin at
 * the centre): additive light on top of the image, so it needs no access to neighbouring pixels.
 * Four elements, after what a real multi-element lens does with a very bright point:
 *
 *  - veiling glare: a wide, faint glow (scatter in the optics)
 *  - starburst: six broad diffraction spikes plus a fan of fine irregular needles (aperture blades
 *    and dust/scratches); the spike frame rotates with the source's angle around the optical axis
 *  - ghosts: internal reflections. They sit on the line through the source and the optical axis
 *    (screen centre) at fixed multiples of the source's offset, each a soft disc with a brighter
 *    rim, tinted by its coating (teal, amber, violet…). They converge on the centre as the source
 *    does, and vanish there.
 *  - halo: a faint ring around the source with dispersion (red outside, blue inside), brighter on
 *    the side facing the optical axis
 *
 * Everything fades to nothing as the source nears the screen edge, so nothing pops when a star
 * leaves the frame. An optional faint anamorphic streak adds the cinematic horizontal line.
 */
export const lensFlareFragmentShader = /* glsl */ `
#define FLARE_MAX_SOURCES 4
uniform vec4 uSrc[FLARE_MAX_SOURCES]; // xy: uv, z: intensity (0 = unused)
uniform vec3 uCol[FLARE_MAX_SOURCES]; // linear tint
uniform float uGain;
uniform float uAnamorphic;

const float FLARE_TAU = 6.28318530718;

// Ghost layout: multiple of the source offset (−1 = mirror image through the centre), radius
// (screen heights), strength, and tint.
const int FLARE_GHOSTS = 5;
const float GHOST_F[5] = float[5](-0.38, -0.74, 0.46, -1.42, -2.3);
const float GHOST_R[5] = float[5](0.034, 0.062, 0.026, 0.105, 0.05);
const float GHOST_A[5] = float[5](0.9, 0.55, 0.7, 0.32, 0.4);
const vec3 GHOST_C[5] = vec3[5](
  vec3(0.35, 0.75, 1.0),
  vec3(1.0, 0.62, 0.28),
  vec3(0.55, 0.4, 1.0),
  vec3(0.3, 1.0, 0.75),
  vec3(1.0, 0.45, 0.35)
);

float flareGhost(vec2 p, vec2 c, float rad) {
  float d = length(p - c) / rad;
  float disc = 1.0 - smoothstep(0.82, 1.0, d);
  float rim = smoothstep(0.62, 0.96, d) * (1.0 - smoothstep(0.96, 1.08, d));
  return 0.32 * disc + 0.68 * rim;
}

vec3 flareOne(vec2 p, vec4 src, vec3 tint) {
  vec2 s = (src.xy - 0.5) * vec2(aspect, 1.0);
  float I = src.z;
  vec2 e = min(src.xy, 1.0 - src.xy);
  float edge = smoothstep(0.0, 0.14, min(e.x, e.y));
  float strength = I * edge;
  if (strength <= 0.0) return vec3(0.0);

  vec2 q = p - s;
  float r = length(q);
  float a = atan(q.y, q.x);
  float sAngle = atan(s.y, s.x);
  float sDist = length(s);
  vec3 sum = vec3(0.0);

  // veiling glare
  sum += tint * (0.055 / (1.0 + pow(r / 0.15, 2.0)));

  // starburst: broad spikes + fine needles
  float rot = 0.5 * sAngle;
  float spikes = pow(abs(cos(3.0 * (a - rot))), 70.0);
  float needles = pow(0.5 + 0.5 * sin(a * 41.0 + 4.0 * sin(a * 7.0 + 2.0 * sAngle)), 14.0);
  needles *= 0.5 + 0.5 * sin(a * 13.0 + 1.7);
  float burst = spikes * exp(-r / 0.30) / (1.0 + 9.0 * r) * 0.34 + needles * exp(-r / 0.14) * 0.12;
  sum += mix(tint, vec3(1.0), 0.35) * burst;

  // halo: dispersed ring around the source, stronger towards the optical axis
  vec2 toAxis = sDist > 1e-4 ? -s / sDist : vec2(1.0, 0.0);
  float facing = 0.5 + 0.5 * dot(q / max(r, 1e-4), toAxis);
  float ringW = 0.011;
  float ringR = 0.20;
  vec3 ring = vec3(
    smoothstep(ringW, 0.0, abs(r - ringR * 1.03)),
    smoothstep(ringW, 0.0, abs(r - ringR)),
    smoothstep(ringW, 0.0, abs(r - ringR * 0.97))
  );
  sum += ring * facing * facing * 0.06;

  // ghosts along the axis
  float axisFade = smoothstep(0.03, 0.35, sDist);
  for (int i = 0; i < FLARE_GHOSTS; ++i) {
    vec2 g = s * GHOST_F[i];
    float shape = flareGhost(p, g, GHOST_R[i] * (0.7 + 0.6 * sDist));
    sum += mix(tint, GHOST_C[i], 0.7) * (shape * GHOST_A[i] * 0.085 * axisFade);
  }

  // anamorphic streak
  float streak = exp(-pow(q.y / 0.0035, 2.0)) * exp(-abs(q.x) / 0.55);
  sum += vec3(0.45, 0.68, 1.0) * (streak * 0.06 * uAnamorphic);

  return sum * strength;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 flare = vec3(0.0);
  for (int i = 0; i < FLARE_MAX_SOURCES; ++i) {
    if (uSrc[i].z > 0.0) flare += flareOne(p, uSrc[i], uCol[i]);
  }
  outputColor = vec4(inputColor.rgb + flare * uGain, inputColor.a);
}
`;
