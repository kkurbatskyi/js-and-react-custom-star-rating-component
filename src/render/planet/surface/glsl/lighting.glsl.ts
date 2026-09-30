/**
 * Runtime lighting helpers shared by the rocky, giant and lite surface shaders (GLSL ES 3.00).
 * Pure functions: uniforms live in the shaders that call them. Requires `common.glsl.ts`.
 *
 * Sources: Oren & Nayar (1994) qualitative model; McEwen (1991) lunar-Lambert law; Heitz (2014) GGX
 * height-correlated Smith visibility; Kasten & Young (1989) airmass; two-disc overlap area.
 */
export const lightingGlsl = /* glsl */ `
// ---- planet/lighting -----------------------------------------------------------

/** Oren-Nayar diffuse (qualitative), sigma = surface roughness in radians. Returns the cosine-weighted BRDF*pi. */
float orenNayar(float ndl, float ndv, vec3 n, vec3 l, vec3 v, float sigma) {
  float s2 = sigma * sigma;
  float A = 1.0 - 0.5 * s2 / (s2 + 0.33);
  float B = 0.45 * s2 / (s2 + 0.09);
  float cosMin = min(ndl, ndv);
  float cosMax = max(ndl, ndv);
  float sinA = sqrt(max(1.0 - cosMin * cosMin, 0.0));
  float tanB = sqrt(max(1.0 - cosMax * cosMax, 0.0)) / max(cosMax, 1e-3);
  float gamma = max(dot(v - n * ndv, l - n * ndl), 0.0);
  return ndl * (A + B * gamma * sinA * tanB);
}

/**
 * Lunar-Lambert (McEwen 1991): I = 2 L mu0/(mu0+mu) + (1-L) mu0 with L fading from 1 at full phase to 0
 * at high phase. Brightness stays flat across the disk at full phase, like the full Moon.
 */
float lunarLambert(float mu0, float mu, float phaseAngle) {
  float L = 1.0 - smoothstep(0.0, 1.4, phaseAngle);
  return mu0 * (2.0 * L / max(mu0 + mu, 1e-3) + (1.0 - L));
}

float ggxD(float ndh, float a) {
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

float smithV(float ndl, float ndv, float a) {
  float a2 = a * a;
  float gv = ndl * sqrt(ndv * ndv * (1.0 - a2) + a2);
  float gl = ndv * sqrt(ndl * ndl * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

float fresnelSchlick(float f0, float cosT) {
  float m = 1.0 - saturate(cosT);
  float m2 = m * m;
  return f0 + (1.0 - f0) * m2 * m2 * m;
}

/** Relative optical air mass for cos(zenith) mu (Kasten & Young 1989): 1 at the zenith, ~38 at the horizon. */
float airmass(float mu) {
  float m = saturate(mu);
  float zenithDeg = degrees(acos(m));
  return 1.0 / (m + 0.50572 * pow(max(96.07995 - zenithDeg, 1.0), -1.6364));
}

/** Fraction of the sun's disc (angular radius rs) covered by a disc of angular radius ro at separation d. */
float discOverlap(float rs, float ro, float d) {
  if (d >= rs + ro) return 0.0;
  if (d <= abs(rs - ro)) return ro >= rs ? 1.0 : (ro * ro) / (rs * rs);
  float rs2 = rs * rs;
  float ro2 = ro * ro;
  float a = (d * d + rs2 - ro2) / (2.0 * d * rs);
  float b = (d * d + ro2 - rs2) / (2.0 * d * ro);
  float k = (-d + rs + ro) * (d + rs - ro) * (d - rs + ro) * (d + rs + ro);
  float area = rs2 * acos(clamp(a, -1.0, 1.0)) + ro2 * acos(clamp(b, -1.0, 1.0)) - 0.5 * sqrt(max(k, 0.0));
  return area / (PI * rs2);
}

/** Sunlight visibility at point P (body space, km) past a sphere (centre c, radius r): umbra, penumbra, antumbra. */
float eclipseVisibility(vec3 P, vec3 sunDir, vec3 c, float r, float sunAng) {
  vec3 d = c - P;
  float dist = length(d);
  float along = dot(d, sunDir);
  if (along <= 0.0 || dist < r) return 1.0;
  float rho = asin(min(r / dist, 1.0));
  float sep = acos(clamp(along / dist, -1.0, 1.0));
  return 1.0 - discOverlap(sunAng, rho, sep);
}

/**
 * Radial ring opacity profile u in 0..1 (inner to outer edge): banding, a Cassini-like division and soft
 * edges. Mirrors src/render/planet/rings so the shadow matches the ring the player sees.
 */
float ringProfile(float u, float seed) {
  float bands = 0.6 + 0.22 * sin(u * 37.0 + seed) + 0.14 * sin(u * 113.0 + seed * 1.7) + 0.08 * sin(u * 311.0 + seed * 2.3);
  float gap = 1.0 - 0.9 * (smoothstep(0.58, 0.6, u) - smoothstep(0.64, 0.66, u));
  float edges = smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.92, 1.0, u));
  return max(bands, 0.0) * gap * edges;
}

/**
 * Sunlight transmitted through the ring plane (y = 0 in body space) to point P: ray towards the sun,
 * slant optical depth = tau(r) / |sin(elevation above the ring plane)|. ring = (inner, outer, tau, seed).
 */
float ringShadow(vec3 P, vec3 sunDir, vec4 ring) {
  if (ring.z <= 0.0 || abs(sunDir.y) < 1e-3) return 1.0;
  float t = -P.y / sunDir.y;
  if (t <= 0.0) return 1.0;
  vec3 hit = P + t * sunDir;
  float r = length(hit.xz);
  if (r < ring.x || r > ring.y) return 1.0;
  float tau = ring.z * ringProfile((r - ring.x) / (ring.y - ring.x), ring.w);
  return exp(-tau / max(abs(sunDir.y), 0.03));
}
`;
