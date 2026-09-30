/**
 * Travel ("hyperspace") streaks — the fragment shader of TravelEffect.
 *
 * A radial zoom-streak of the image the effect receives, centred on the focus of expansion (the
 * screen point the camera is heading for). Each pixel gathers samples along the ray OUTWARDS from
 * the centre, so a star at radius r lights the pixels between r/(1+len) and r: a tail trailing
 * towards the centre with the bright head at the star. Length grows with radius (image flow is
 * proportional to distance from the focus of expansion) and with intensity².
 *
 * Two accumulators per pixel: a weighted average (the diffuse zoom blur — galaxy, nebulae) and a
 * decayed maximum (the trail, which keeps a point star's peak value instead of averaging it away).
 * Lateral chromatic aberration (R out, B in, growing with radius) and a vignette "pump" complete
 * the look. Everything is scaled by `uIntensity`; at 0 the shader is a copy.
 *
 * Runs on scene-linear HDR, before bloom, so the streaks bloom.
 */
export const travelFragmentShader = /* glsl */ `
uniform vec2 uCenter;      // focus of expansion, uv
uniform float uIntensity;  // 0..1 (eased on the CPU)
uniform float uSign;       // +1 forward (streaks diverge), -1 backward (they converge)

float travelIgn(vec2 p) { // interleaved gradient noise (Jimenez 2014): breaks up step banding
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 travelTap(vec2 suv) {
  vec2 inside = step(vec2(0.0), suv) * step(suv, vec2(1.0));
  return texture2D(inputBuffer, suv).rgb * (inside.x * inside.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float k = uIntensity;
  if (k < 0.0005) {
    outputColor = inputColor;
    return;
  }
  vec2 d = uv - uCenter;
  float r = length(d * vec2(aspect, 1.0)); // radius in screen heights
  float radial = smoothstep(0.02, 0.5, r); // nothing moves at the focus of expansion
  float len = (0.03 + 0.66 * k * k) * radial;
  float ca = 0.0065 * k * k;
  float jitter = travelIgn(gl_FragCoord.xy);
  // Enough taps that a point star's trail stays continuous: ~2 px between samples.
  int steps = int(clamp(len * length(d * resolution) * 0.5, 5.0, 20.0));

  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  vec3 trail = vec3(0.0);
  for (int i = 0; i < 20; ++i) {
    if (i >= steps) break;
    float t = (float(i) + jitter) / float(steps);
    float w = exp(-2.4 * t);
    float s = 1.0 + uSign * t * len;
    vec3 c = vec3(
      travelTap(uCenter + d * (s + ca)).r,
      travelTap(uCenter + d * s).g,
      travelTap(uCenter + d * (s - ca)).b
    );
    sum += c * w;
    wsum += w;
    trail = max(trail, c * w);
  }
  vec3 blur = sum / wsum;

  float ease = smoothstep(0.0, 0.2, k);
  vec3 color = mix(inputColor.rgb, blur, 0.62 * ease);
  color = max(color, trail * (0.6 + 0.4 * k)); // bright heads keep their streak
  // cool tint on the streaks, strongest towards the edge (blue-shift)
  color *= mix(vec3(1.0), vec3(0.86, 0.96, 1.16), 0.5 * k * radial);

  // Vignette pump: the frame closes in with speed and breathes slowly at full tilt.
  float pump = 1.0 + 0.08 * k * k * sin(time * 5.0);
  color *= 1.0 - 0.6 * k * smoothstep(0.32, 1.1, r) * pump;

  outputColor = vec4(color, inputColor.a);
}
`;
