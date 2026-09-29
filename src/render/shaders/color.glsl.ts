/**
 * Colour helpers: blackbody colour, sRGB transfer functions, saturation.
 *
 * Conventions (see docs/ARCHITECTURE.md §5): shaders work in scene-linear, linear-sRGB primaries.
 * `blackbody()` returns a *chromaticity* (brightest channel = 1) — multiply by the emitter's HDR
 * intensity. The CPU twin for data colours lives in `src/core/color.ts`.
 *
 * Self-contained; see `common.glsl.ts` for the inclusion rules shared by all chunks.
 */
export const color = /* glsl */ `
// ---- sidereal/color ---------------------------------------------------------

/** Exact sRGB EOTF (IEC 61966-2-1): display-encoded sRGB -> linear. */
vec3 srgbToLinear(vec3 c) {
  c = max(c, vec3(0.0));
  // mix() with a bvec selects per component (GLSL ES 3.00), so the unused branch cannot leak NaNs.
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThanEqual(c, vec3(0.04045)));
}

/** Exact inverse sRGB EOTF: linear -> display-encoded sRGB. */
vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, lessThanEqual(c, vec3(0.0031308)));
}

/**
 * CIE 1931 xy chromaticity of a blackbody (Planckian locus), cubic-spline approximation of
 * Kim et al. 2002 ("Design of advanced color temperature control system for HDTV applications",
 * J. Korean Phys. Soc. 41(6)). Valid 1667 K - 25000 K; the input is clamped to that range.
 */
vec2 planckianLocusXy(float tempK) {
  float t = 1000.0 / clamp(tempK, 1667.0, 25000.0);
  float t2 = t * t;
  float t3 = t2 * t;
  float x = tempK < 4000.0
    ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.179910
    : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
  float x2 = x * x;
  float x3 = x2 * x;
  float y = tempK < 2222.0
    ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
    : tempK < 4000.0
      ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  return vec2(x, y);
}

/** Linear-sRGB colour of a blackbody with relative luminance Y = 1 (may exceed 1 per channel). */
vec3 blackbodyUnitLuminance(float tempK) {
  vec2 xy = planckianLocusXy(tempK);
  vec3 XYZ = vec3(xy.x / xy.y, 1.0, (1.0 - xy.x - xy.y) / xy.y);
  // CIE XYZ -> linear sRGB (D65), IEC 61966-2-1. GLSL matrices are column-major.
  const mat3 XYZ_TO_SRGB = mat3(
     3.2404542, -0.9692660,  0.0556434,
    -1.5371385,  1.8760108, -0.2040259,
    -0.4985314,  0.0415560,  1.0572252
  );
  // Very cool stars fall slightly outside the sRGB gamut (negative blue): clip.
  return max(XYZ_TO_SRGB * XYZ, vec3(0.0));
}

/** Linear-sRGB chromaticity of a blackbody at tempK, normalised so the brightest channel is 1. */
vec3 blackbody(float tempK) {
  vec3 c = blackbodyUnitLuminance(tempK);
  return c / max(max(c.r, c.g), max(c.b, 1e-6));
}

/**
 * Scale saturation around the colour's own luminance: 0 = grey, 1 = unchanged, >1 = richer.
 * Blackbody colours are pale; the art direction boosts star colours by ~1.25.
 */
vec3 adjustSaturation(vec3 linearRgb, float s) {
  float y = dot(linearRgb, vec3(0.2126729, 0.7151522, 0.0721750));
  return max(mix(vec3(y), linearRgb, s), vec3(0.0));
}
`;
