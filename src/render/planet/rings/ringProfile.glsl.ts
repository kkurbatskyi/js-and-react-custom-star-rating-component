/**
 * Ring radial structure and ring shadow (GLSL ES 3.00) — shared by the ring shader and by the planet's
 * surface shaders, so the shadow the planet receives is exactly the ring the player sees.
 *
 * `ringStructure(u, seed, du, tau)`: u in 0..1 from the inner to the outer edge, `seed` the ring's phase
 * (`(RingSystem.seed % 997) / 97`, see `ringUniformVector`), `du` the pixel footprint in u (band-limits the
 * fine structure), `tau` the ring's peak normal optical depth (selects the layout). Returns
 *     x  optical depth relative to `tau` (peak ~1)
 *     y  colour ramp 0..1 (dim grey C-ring-like -> warm tan B-ring-like -> pale A-ring-like)
 *     z  particle brightness multiplier (~1)
 *
 * Two layouts, chosen by `tau`:
 *   dense (tau > 0.3)  Saturn-like: a faint inner C ring, a tall structured B ring, a Cassini-like division,
 *                      an A ring with an Encke-like gap and a Keeler-like gap, a sharp outer edge. Boundaries
 *                      move with the seed.
 *   faint (tau <= 0.3) Uranus/Jupiter-like: a diffuse dust sheet with a handful of narrow ringlets.
 * Fine structure is 1D value noise in five octaves; an octave fades out when its wavelength drops below
 * about two pixels, so distant rings stay clean instead of shimmering.
 *
 * Self-contained (its own hash, no other chunk needed); every name is prefixed `ring` so it can be included
 * next to any other chunk. Include once per shader.
 */
export const ringProfileGlsl = /* glsl */ `
// ---- sky/ringProfile ------------------------------------------------------------------------
float ringHash1(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

/** Smooth 1D value noise in [-1, 1]. */
float ringNoise1(float x) {
  float i = floor(x);
  float f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(ringHash1(i), ringHash1(i + 1.0), f) * 2.0 - 1.0;
}

/** Band-limited fBm in [-1, 1]: base frequency f0 (cycles across the ring); du = pixel footprint in u. */
float ringFbm(float u, float seed, float du, float f0) {
  float sum = 0.0;
  float norm = 0.0;
  float f = f0;
  float a = 1.0;
  for (int i = 0; i < 5; i++) {
    float w = 1.0 - smoothstep(0.2, 0.5, du * f);
    if (w <= 0.0) break;                    // finer octaves are below the pixel too
    sum += a * w * ringNoise1(u * f + seed * (7.31 + float(i)) + float(i) * 17.0);
    norm += a;
    f *= 2.7;
    a *= 0.62;
  }
  // Keep the amplitude of the octaves that are gone (they average to zero): normalise by the full sum.
  norm = 0.0;
  a = 1.0;
  for (int i = 0; i < 5; i++) {
    norm += a;
    a *= 0.62;
  }
  return sum / norm;
}

/** 1 inside |u - c| < w, softening over s (never narrower than the pixel footprint). */
float ringBand(float u, float c, float w, float s, float du) {
  return 1.0 - smoothstep(w, w + max(s, du), abs(u - c));
}

vec3 ringDense(float u, float seed, float du) {
  float j1 = ringHash1(seed * 3.7 + 1.0);
  float j2 = ringHash1(seed * 5.3 + 2.0);
  float j3 = ringHash1(seed * 2.9 + 3.0);
  float j4 = ringHash1(seed * 4.1 + 4.0);
  float c1 = 0.265 + 0.03 * j1;                 // C | B
  float b1 = 0.655 + 0.035 * j2;                // B | division
  float a0 = b1 + 0.055 + 0.02 * j3;            // division | A
  float enc = a0 + (0.99 - a0) * (0.68 + 0.14 * j4);
  float s1 = max(0.012, du);
  float s2 = max(0.004, du);
  float s3 = max(0.003, du);
  float sC = 1.0 - smoothstep(c1 - s1, c1 + s1, u);
  float sB = smoothstep(c1 - s1, c1 + s1, u) * (1.0 - smoothstep(b1 - s2, b1 + s2, u));
  float sG = smoothstep(b1 - s2, b1 + s2, u) * (1.0 - smoothstep(a0 - s3, a0 + s3, u));
  float sA = smoothstep(a0 - s3, a0 + s3, u);

  float nLow = ringFbm(u, seed, du, 34.0);
  float nHigh = ringFbm(u, seed + 11.0, du, 190.0);
  float nFine = ringFbm(u, seed + 23.0, du, 900.0);
  float ramp = smoothstep(c1, c1 + 0.14, u);
  float tauC = 0.12 * (1.0 + 0.7 * nLow + 0.3 * nHigh);
  float tauB = mix(0.6, 0.86, ramp) * (1.0 + 0.28 * nLow + 0.34 * nHigh + 0.2 * nFine);
  float tauG = 0.055 * (1.0 + 0.9 * nHigh);
  float tauA = 0.4 * (1.0 + 0.3 * nLow + 0.36 * nHigh + 0.2 * nFine);
  float tau = sC * tauC + sB * tauB + sG * tauG + sA * tauA;

  tau *= 1.0 - 0.95 * ringBand(u, enc, 0.0045, 0.003, du);          // Encke-like gap ...
  tau += 0.35 * ringBand(u, enc, 0.0009, 0.0006, du);               // ... with a ringlet in it
  tau *= 1.0 - 0.92 * ringBand(u, 0.962, 0.0018, 0.002, du);        // Keeler-like gap
  tau *= smoothstep(0.0, 0.006, u) * (1.0 - smoothstep(0.984, 0.992, u));
  tau = max(tau, 0.0);

  float tint = clamp(sC * 0.0 + sB * (0.42 + 0.1 * nLow) + sG * 0.12 + sA * (0.92 + 0.08 * nHigh), 0.0, 1.0);
  float bright = 1.0 + 0.2 * nHigh + 0.1 * nFine;
  return vec3(tau, tint, bright);
}

vec3 ringFaint(float u, float seed, float du) {
  float sheet = smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.84, 1.0, u));
  float tau = 0.2 * sheet * (1.0 + 0.4 * ringFbm(u, seed, du, 22.0));
  for (int k = 0; k < 7; k++) {
    float fk = float(k);
    float pos = 0.07 + 0.88 * ringHash1(seed * 1.7 + fk * 3.13 + 0.5);
    float w = 0.0025 + 0.012 * ringHash1(seed * 2.3 + fk * 5.71 + 1.5);
    float amp = 0.4 + 0.6 * ringHash1(seed * 3.1 + fk * 7.9 + 2.5);
    tau += amp * ringBand(u, pos, w, 0.0015, du);
  }
  tau *= smoothstep(0.0, 0.01, u) * (1.0 - smoothstep(0.985, 1.0, u));
  float n = ringFbm(u, seed + 5.0, du, 160.0);
  return vec3(max(tau * (1.0 + 0.25 * n), 0.0), 0.3 + 0.2 * n, 1.0 + 0.1 * n);
}

vec3 ringStructure(float u, float seed, float du, float tau) {
  return tau > 0.3 ? ringDense(u, seed, du) : ringFaint(u, seed, du);
}
`;

/**
 * Sunlight transmitted through the ring plane (y = 0 in body space) to a point P: the ray towards the sun
 * crosses the plane at the ring radius, slant optical depth = tau(r) / |sin(elevation of the sun over the ring
 * plane)|. ring = (inner radius, outer radius, peak tau, seed phase). Band-limited so the shadow does not
 * shimmer on the planet. Drop-in replacement for the surface shaders' `ringProfile` + `ringShadow` pair.
 */
export const ringShadowGlsl = /* glsl */ `
${ringProfileGlsl}
float ringShadow(vec3 P, vec3 sunDir, vec4 ring) {
  // Derivatives first, in uniform control flow: the pixel footprint on the ring plane band-limits the profile.
  float t = -P.y / (abs(sunDir.y) < 1e-4 ? 1e-4 : sunDir.y);
  vec3 hit = P + t * sunDir;
  float r = length(hit.xz);
  float du = max(fwidth(r) / max(ring.y - ring.x, 1.0), 0.0015);
  if (ring.z <= 0.0 || abs(sunDir.y) < 1e-3 || t <= 0.0 || r < ring.x || r > ring.y) return 1.0;
  float u = (r - ring.x) / (ring.y - ring.x);
  float tau = ring.z * ringStructure(u, ring.w, du, ring.z).x;
  return exp(-tau / max(abs(sunDir.y), 0.03));
}
`;
