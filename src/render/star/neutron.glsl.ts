/**
 * Neutron-star showpieces: pulsar beams (a slowed-down lighthouse) and a faint wind nebula.
 * Beams reuse `spriteVertex` (star.glsl.ts): a quad in screen pixels around the star.
 */
import { common } from '../shaders/common.glsl';
import { noise } from '../shaders/noise.glsl';

export const beamsFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBeam;          // magnetic axis in view space (unit); z > 0 points at the camera
uniform float uLenPx;        // beam length at full side-on projection, CSS px
uniform float uFade;
in vec2 vP;                  // CSS px from the star (screen axes, y up)
out vec4 fragColor;

void main() {
  vec3 col = vec3(0.0);
  for (int s = 0; s < 2; s++) {
    float sg = s == 0 ? 1.0 : -1.0;
    vec3 b = sg * uBeam;
    float l2 = length(b.xy);
    // Shaft: a narrow cone seen from the side, foreshortened when it points along the line of sight.
    if (l2 > 1e-3) {
      vec2 dn = b.xy / l2;
      float along = dot(vP, dn);
      float perp = dot(vP, vec2(-dn.y, dn.x));
      float len = uLenPx * l2;
      float w = 1.1 + 0.075 * max(along, 0.0);
      float shaft = exp(-0.5 * perp * perp / (w * w)) * step(0.0, along)
                  * exp(-along / (0.5 * len + 1.0)) * (1.0 - smoothstep(0.7 * len, len, along));
      float vis = 0.3 + 0.7 * smoothstep(-0.7, 0.7, b.z);   // beams aimed away are seen through the glare only
      col += uColor * shaft * vis * 1.6;
    }
    // Lighthouse flash while the beam sweeps across the line of sight.
    float flash = pow(max(b.z, 0.0), 12.0);
    float r = length(vP);
    col += uColor * flash * (2.6 * exp(-r * r / 160.0) + 1.0 * exp(-r / 30.0));
  }
  fragColor = vec4(col * uFade, 1.0);
}
`;

export const nebulaVertex = /* glsl */ `
uniform float uExtentKm;     // half size, km
out vec2 vUv;

void main() {
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vUv = position.xy;
  gl_Position = projectionMatrix * (c + vec4(position.xy * uExtentKm, 0.0, 0.0));
}
`;

export const nebulaFragment = /* glsl */ `
${common}
${noise}
uniform vec3 uColor;
uniform vec2 uEquator;       // projected equator direction on screen (unit)
uniform float uTilt;         // |axis.z|: 0 = torus seen edge-on, 1 = face-on
uniform float uSeed;
uniform float uTime;
uniform float uFade;
in vec2 vUv;
out vec4 fragColor;

void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  // Coordinates in the nebula's own frame: e along the equator, a along the spin axis.
  vec2 axis = vec2(-uEquator.y, uEquator.x);
  float pe = dot(vUv, uEquator);
  float pa = dot(vUv, axis);
  float squash = 0.18 + 0.82 * uTilt;                 // the equatorial torus foreshortens
  float rt = length(vec2(pe, pa / squash));
  // Termination-shock ring, diffuse filaments, and two polar jets.
  float ring = exp(-pow((rt - 0.34) / 0.05, 2.0));
  float fil = 0.5 + 0.5 * snoise(vec3(vUv * 4.0 + uSeed, uTime * 0.05));
  float fil2 = 0.5 + 0.5 * snoise(vec3(vUv * 9.0 - uSeed, uTime * 0.08 + 4.0));
  float cloud = exp(-rt * rt * 3.2) * (0.35 + 0.65 * fil * fil2);
  float jet = exp(-pow(pe / 0.035, 2.0)) * exp(-abs(pa) * 2.4) * smoothstep(0.03, 0.15, abs(pa));
  float v = 0.55 * ring * (0.5 + 0.5 * fil) + 0.32 * cloud + 0.4 * jet;
  v *= 1.0 - smoothstep(0.6, 1.0, r);
  vec3 tint = mix(uColor, vec3(0.75, 0.9, 1.0), 0.35 * exp(-rt * 3.0));
  fragColor = vec4(tint * (v * 0.2 * uFade), 1.0);
}
`;
