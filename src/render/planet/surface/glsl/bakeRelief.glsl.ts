/**
 * Bake pass 3 — relief. Writes RGBA8 (linear):
 *   RGB  tangent slope vector in object space, s = uRelief * grad(h), range +-0.7 packed to 0..1
 *        (a vector field interpolates and mip-maps correctly; an octahedral normal would not,
 *        it folds along z = 0). Runtime normal: normalize(p - s).
 *   A    normalised height (encodeHeight): sea-level tests, ocean depth, horizon shadows.
 */
export const bakeReliefGlsl = /* glsl */ `
// ---- planet/bakeRelief ---------------------------------------------------------
uniform float uRelief;
out vec4 fragColor;

void main() {
  vec2 uv = bakeUv();
  vec3 p = normalize(cubeDir(uFace, uv));
  vec3 s = heightGradient(uv, 2.0 / uSize) * uRelief;
  float h = texture(uHeightTex, p).r;
  fragColor = vec4(clamp(s / 1.4 + 0.5, 0.0, 1.0), encodeHeight(h));
}
`;
