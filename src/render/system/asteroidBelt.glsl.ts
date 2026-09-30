/**
 * Asteroid-belt shaders. One source, two programs (`DUST` define): crisp constant-size rock
 * sprites, and large soft dust sprites that give the belt its glow from afar. Both orbit on the GPU
 * (see beltModel.ts for the maths and the float32 discipline) and are lit by the star at the origin
 * of frame S: a Lambertian-sphere phase function from the angle star–rock–camera, dimmed with
 * distance from the star.
 *
 * "Crowd" compensation: seen from far away thousands of rocks pile up in the same pixel and would
 * add up to a white ring. Each rock is dimmed by 1/(1 + crowd), where crowd ≈ rocks per pixel, so a
 * dense band saturates at a soft dusty level while a sparse one stays a scatter of individual points.
 */
export const beltVertexShader = /* glsl */ `
uniform float uDt;        // days since the epoch (NOT raw simDays)
uniform float uKappa;     // ω = κ·a^−1.5, rad/day
uniform vec3 uCamS;       // camera in frame S (lighting only)
uniform float uPixelRatio;
uniform float uFocalPx;   // projection focal length, device px
uniform float uOpacity;
uniform float uTime;      // seconds, wrapped to the twinkle period
uniform float uCrowd;
uniform float uRefRadius; // km: distance at which the 1/r dimming is 1
uniform vec3 uColor;
uniform float uGain;

in vec4 aOrbit; // a, e, ϖ, vertical amplitude
in vec4 aRock;  // vertical phase, twinkle rate, twinkle phase, tint
in vec4 aLook;  // size (px | km), albedo, radius km
in float aM0;

out vec3 vColor;
out float vSphere;
out vec3 vLight;

const float PI = 3.14159265359;

void main() {
  float a = aOrbit.x;
  float e = aOrbit.y;
  float M = aM0 + uKappa * pow(a, -1.5) * uDt;
  float nu = M + 2.0 * e * sin(M) + aOrbit.z;
  float r = a * (1.0 - e * cos(M));
  vec3 p = vec3(r * cos(nu), aOrbit.w * sin(nu + aRock.x), -r * sin(nu));

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 1.0);

  // Lambertian-sphere phase function of the angle star–rock–camera (1 at full phase, 0 at new).
  vec3 toStar = -p;
  vec3 toCam = uCamS - p;
  float cosA = clamp(dot(toStar, toCam) / max(length(toStar) * length(toCam), 1.0), -1.0, 1.0);
  float alpha = acos(cosA);
  float phase = (sin(alpha) + (PI - alpha) * cos(alpha)) / PI;
  float lit = 0.16 + 0.84 * phase;
  float dim = pow(uRefRadius / r, 0.6);

  float twinkle = 1.0 + 0.2 * sin(uTime * aRock.y + aRock.z);
  float sparkle = 1.0 + 1.6 * pow(max(sin(uTime * aRock.y * 2.0 + aRock.z * 3.0), 0.0), 40.0) * step(0.8, fract(aRock.z * 7.13));

#ifdef DUST
  float px = clamp(2.0 * aLook.x * uFocalPx / depth, 2.0, 64.0);
  gl_PointSize = px * uPixelRatio;
  float cover = min(1.0, (16.0 / px) * (16.0 / px)) * (1.0 - smoothstep(36.0, 64.0, px));
  float k = aLook.y * cover * lit * dim / (1.0 + 0.35 * uCrowd);
  vSphere = 0.0;
#else
  float px = max(aLook.x, 2.0 * aLook.z * uFocalPx / depth / uPixelRatio);
  gl_PointSize = min(px, 32.0) * uPixelRatio;
  vSphere = smoothstep(3.0, 8.0, px);
  float k = aLook.y * lit * dim * twinkle * sparkle / (1.0 + uCrowd);
#endif
  vec3 tint = vec3(1.0 + 0.1 * aRock.w, 1.0, 1.0 - 0.1 * aRock.w);
  vColor = uColor * tint * (k * uGain * uOpacity);
  vLight = normalize((modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz - mv.xyz);
}
`;

export const beltFragmentShader = /* glsl */ `
in vec3 vColor;
in float vSphere;
in vec3 vLight;
out vec4 fragColor;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
#ifdef DUST
  fragColor = vec4(vColor * exp(-3.0 * r2), 1.0);
#else
  // Tiny sprites are soft dots; once a rock is a few pixels wide it becomes a lit sphere.
  vec3 n = vec3(d.x, -d.y, sqrt(1.0 - r2));
  float shaded = 0.08 + 0.92 * clamp(dot(n, vLight), 0.0, 1.0);
  fragColor = vec4(vColor * mix(1.0 - r2, shaded, vSphere), 1.0);
#endif
}
`;
