/**
 * Orbit-line shaders: a screen-space ribbon of constant pixel width.
 *
 * One INSTANCE is one polyline segment (see orbitGeometry.ts); the four vertices of the base quad
 * pick an end (`position.x`) and a side (`position.y`). Both ends of a segment extrude along the
 * screen-space normal of the curve's ANALYTIC tangent (not of the chord), so neighbouring segments
 * share their edge exactly: no gaps, no overlaps, no mitre joins — hence no kinks, and additive
 * blending never double-lights a joint.
 *
 * Vertex positions are camera-relative, frame S (float32 is precise where the camera is close);
 * the model matrix is only the S → world rotation.
 */

export const orbitVertexShader = /* glsl */ `
uniform vec2 uRes;          // drawing-buffer size, px
uniform float uHalfWidthPx; // half width of the ribbon, px: solid core + antialiasing / halo margin

in vec3 iP0;
in vec4 iT0; // xyz: unit tangent, w: age (rad behind the body)
in vec3 iP1;
in vec4 iT1;

out float vAge;
out float vAcross;
out vec3 vRel;

void main() {
  bool atEnd = position.x > 0.5;
  vec3 p = atEnd ? iP1 : iP0;
  vec4 tt = atEnd ? iT1 : iT0;
  vAge = tt.w;
  vAcross = position.y;
  vRel = p;

  vec4 viewP = modelViewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * viewP;
  vec4 dclip = projectionMatrix * (modelViewMatrix * vec4(tt.xyz, 0.0));
  // Screen-space direction of the curve: d(ndc)/ds = (dclip.xy·w − clip.xy·dclip.w) / w², and only
  // the direction matters (w² > 0), so the division is skipped.
  vec2 dpx = (dclip.xy * clip.w - clip.xy * dclip.w) * uRes;
  float len = length(dpx);
  vec2 dir = len > 0.0 ? dpx / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  // ±half-width px → ndc (2 / res per px) → clip space (× w).
  clip.xy += nrm * (position.y * uHalfWidthPx) * (2.0 / uRes) * clip.w;
  gl_Position = clip;
}
`;

export const orbitFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHalfWidthPx;
uniform float uCorePx;      // half width of the solid core, px
uniform float uGlow;        // 0..1: strength of the soft halo around the core
uniform float uFloor;       // tail brightness one full orbit behind the body
uniform float uGamma;       // tail falloff exponent
uniform vec3 uFocus;        // focused body, camera-relative, frame S
uniform vec2 uFocusZone;    // fully faded inside x, fully visible beyond y (km); y <= x: off
uniform vec2 uDepth;        // (distance from the camera to the orbit's centre, orbit size) in km
uniform float uDepthCue;    // how much dimmer the far side of the ring is

in float vAge;
in float vAcross;
in vec3 vRel;
out vec4 fragColor;

const float INV_TAU = 0.15915494309;
const float LEAD = 0.03; // ramp ahead of the body, as a fraction of the orbit

void main() {
  // Comet tail: 1 at the body, decaying behind it (u = fraction of the orbit since the body was
  // there) towards a faint floor; a short ramp just ahead of the body closes the loop smoothly
  // (u = 1 is the body's own position again).
  float u = vAge * INV_TAU;
  float profile = mix(uFloor, 1.0, pow(clamp(1.0 - u, 0.0, 1.0), uGamma));
  profile = max(profile, smoothstep(1.0 - LEAD, 1.0, u));

  // Coverage: an antialiased core and an optional gaussian-ish halo, in pixels from the centreline.
  float d = abs(vAcross) * uHalfWidthPx;
  float core = 1.0 - smoothstep(uCorePx - 0.5, uCorePx + 0.5, d);
  float halo = uGlow * (1.0 - smoothstep(0.0, uHalfWidthPx, d));
  float cover = max(core, halo * halo);

  float focus = uFocusZone.y > uFocusZone.x
    ? smoothstep(uFocusZone.x, uFocusZone.y, distance(vRel, uFocus))
    : 1.0;
  float far = smoothstep(uDepth.x - uDepth.y, uDepth.x + uDepth.y, length(vRel));
  float depth = 1.0 - uDepthCue * far;

  float a = cover * profile * focus * depth * uOpacity;
  fragColor = vec4(uColor * a, 1.0); // additive: colour × coverage
}
`;
