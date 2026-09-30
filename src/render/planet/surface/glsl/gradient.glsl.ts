/**
 * Tangent-plane gradient of the baked height (channel R of `uHeightTex`) at the texel being baked.
 *
 * The four neighbours sit exactly one texel away in face coordinates (so they land on texel centres;
 * across face edges the cube sampler continues into the adjacent face). Because the gnomonic
 * mapping makes the two face axes non-orthogonal on the sphere, the gradient g is solved from
 *   g . a = dh_u,  g . b = dh_v,  g . n = 0     (a, b = chord vectors of the two central differences)
 * with the reciprocal basis  g = (dh_u (b x n) + dh_v (n x a)) / (a . (b x n)).
 * Units: height per unit of sphere arc (per radian). Multiply by `uRelief` for the dimensionless slope.
 * Requires `cube.glsl.ts`.
 */
export const gradientGlsl = /* glsl */ `
// ---- planet/gradient -----------------------------------------------------------
uniform samplerCube uHeightTex;

vec3 heightGradient(vec2 uv, float du) {
  vec3 p0 = normalize(cubeDir(uFace, uv));
  vec3 pu1 = normalize(cubeDir(uFace, uv + vec2(du, 0.0)));
  vec3 pu0 = normalize(cubeDir(uFace, uv - vec2(du, 0.0)));
  vec3 pv1 = normalize(cubeDir(uFace, uv + vec2(0.0, du)));
  vec3 pv0 = normalize(cubeDir(uFace, uv - vec2(0.0, du)));
  float hu = texture(uHeightTex, pu1).r - texture(uHeightTex, pu0).r;
  float hv = texture(uHeightTex, pv1).r - texture(uHeightTex, pv0).r;
  vec3 a = pu1 - pu0;
  vec3 b = pv1 - pv0;
  vec3 ra = cross(b, p0);
  vec3 rb = cross(p0, a);
  return (hu * ra + hv * rb) / dot(a, ra);
}

/**
 * Multi-scale cavity in height units: how far the texel sits below the mean of a ring of neighbours at 4,
 * 12 and 36 texels. Bowls are positive, crests negative. Baked into the albedo as ambient occlusion so
 * craters and valleys read even when the sun is behind the camera.
 */
float cavity(vec2 uv, float h0) {
  float d = 8.0 / uSize;
  float acc = 0.0;
  for (int s = 0; s < 3; s++) {
    float m = 0.25 * (
      texture(uHeightTex, cubeDir(uFace, uv + vec2(d, 0.0))).r +
      texture(uHeightTex, cubeDir(uFace, uv - vec2(d, 0.0))).r +
      texture(uHeightTex, cubeDir(uFace, uv + vec2(0.0, d))).r +
      texture(uHeightTex, cubeDir(uFace, uv - vec2(0.0, d))).r);
    acc += m - h0;
    d *= 3.0;
  }
  return acc / 3.0;
}
`;
