/**
 * GLSL twin of the galaxy structure's smooth fields (src/gen/galaxy/README.md), shared by the
 * volume raymarch and the particle vertex shader. The planar parts that need tables (arm factor,
 * midplane dust) come from the baked map (./GalaxyMap.ts); the rest is analytic. Densities are the
 * structure's UNSCALED densities. All uniforms are set by `GalaxyUniforms` (./uniforms.ts).
 *
 * Map channels: r = arm factor A(x,z) · g = midplane dust (exactly the model's dustDensity(x,0,z))
 * · b = star-formation ridge density (visual) · a = signed filament noise n ∈ ~[−1, 1] (visual).
 */
export const galaxyFields = /* glsl */ `
// ---- sidereal/galaxy-fields -----------------------------------------------------
uniform sampler2D uGalMap;
uniform float uGalMapScale;
uniform float uGalMapTexelInv;
uniform float uGalInvRd;
uniform float uGalRmax;
uniform float uGalInvEdge;
uniform float uGalInvHz;
uniform float uGalInvHThick;
uniform float uGalThickNorm;
uniform float uGalInvHArm;
uniform float uGalInvHDust;
uniform float uGalArmStrength;
uniform float uGalBulge0;
uniform float uGalInvBulgeA2;
uniform float uGalInvBulgeQ2;
uniform float uGalBar0;
uniform vec2 uGalBarDir;
uniform vec3 uGalInvBarSigma2;
uniform float uGalDustDetail;
uniform vec3 uGalExtinction;

/** sech^2(u), overflow-safe. */
float galSech2(float u) {
  float e = exp(-2.0 * abs(u));
  return 4.0 * e / ((1.0 + e) * (1.0 + e));
}

/** Map lookup at galactic (x, z) with an explicit mip level. */
vec4 galMap(vec2 xz, float lod) {
  return textureLod(uGalMap, xz * uGalMapScale + 0.5, lod);
}

/** Mip level for a sampling footprint of footprintLy. */
float galMapLod(float footprintLy) {
  return log2(max(footprintLy * uGalMapTexelInv, 1.0));
}

/** exp(-R/Rd) with the logistic taper at the visible edge. */
float galDiskRadial(float r) {
  return exp(-r * uGalInvRd) / (1.0 + exp(min((r - uGalRmax) * uGalInvEdge, 80.0)));
}

/** Log-normal clumping of dust density d by a unit-variance-ish noise n (see galDustPlanar). */
float galDustClumped(float d, float n) {
  float k = uGalDustDetail;
  return d * exp(k * n - 0.08 * k * k);
}

/**
 * Planar dust with visual clumps (multiply by sech^2(y/h_d) for the density). Turbulent ISM
 * densities are log-normal: exp(k n - k^2 s^2 / 2) with n ~ N(0, s^2), s ~ 0.4 (the filament
 * noise), keeps the mean dust while opening clear gaps between dense clouds.
 */
float galDustPlanar(vec4 m) {
  return galDustClumped(m.g, m.a);
}

/** Flattened Plummer bulge + triaxial Gaussian bar; r2 = x^2 + z^2. */
float galSpheroid(vec3 p, float r2) {
  float t = 1.0 + (r2 + p.y * p.y * uGalInvBulgeQ2) * uGalInvBulgeA2;
  float rho = uGalBulge0 / (t * t * sqrt(t));
  if (uGalBar0 > 0.0) {
    float u = dot(p.xz, uGalBarDir);
    float v = p.z * uGalBarDir.x - p.x * uGalBarDir.y;
    float s = u * u * uGalInvBarSigma2.x + v * v * uGalInvBarSigma2.y + p.y * p.y * uGalInvBarSigma2.z;
    rho += uGalBar0 * exp(-0.5 * min(s, 80.0));
  }
  return rho;
}

/**
 * Integral of sech^2(y(s)/h) ds over a straight sub-segment of length ds on which y runs linearly
 * from y0 to y1: ds * h * (tanh(y1/h) - tanh(y0/h)) / (y1 - y0), or the midpoint rule when flat.
 */
float galSech2Segment(float y0, float y1, float ds, float invH) {
  float dy = (y1 - y0) * invH;
  if (abs(dy) < 0.05) return galSech2(0.5 * (y0 + y1) * invH) * ds;
  return (tanh(y1 * invH) - tanh(y0 * invH)) / dy * ds;
}
`;
