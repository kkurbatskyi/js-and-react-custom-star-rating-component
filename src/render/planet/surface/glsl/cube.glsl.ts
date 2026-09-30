/**
 * Cube-map plumbing shared by the three bake passes (all GLSL ES 3.00, ASCII only).
 *
 * A bake pass renders one face of a WebGLCubeRenderTarget at a time (or a strip of rows of it).
 * `bakeDir()` recovers the texel's direction from gl_FragCoord with the OpenGL cube-map convention
 * (ES 3.0 spec table 3.19: faces +X -X +Y -Y +Z -Z; t = 0 is framebuffer row 0), so sampling the
 * finished cube with `texture(cube, dir)` returns exactly what was baked for `dir`.
 */
export const cubeGlsl = /* glsl */ `
// ---- planet/cube ---------------------------------------------------------------
uniform int uFace;
uniform float uSize;

/** Direction of face coordinates uv in [-1, 1] (sc, tc of the GL spec). Not normalised. */
vec3 cubeDir(int face, vec2 uv) {
  if (face == 0) return vec3( 1.0, -uv.y, -uv.x);
  if (face == 1) return vec3(-1.0, -uv.y,  uv.x);
  if (face == 2) return vec3( uv.x,  1.0,  uv.y);
  if (face == 3) return vec3( uv.x, -1.0, -uv.y);
  if (face == 4) return vec3( uv.x, -uv.y,  1.0);
  return vec3(-uv.x, -uv.y, -1.0);
}

/** Face coordinates in [-1, 1] of the fragment being baked. */
vec2 bakeUv() {
  return 2.0 * gl_FragCoord.xy / uSize - 1.0;
}

/** Unit direction of the texel centre being baked. */
vec3 bakeDir() {
  return normalize(cubeDir(uFace, bakeUv()));
}

/** Encode a normalised height (about -0.75 .. 1.25) into 0..1 for an 8-bit channel. */
float encodeHeight(float h) {
  return clamp((h + 0.75) * 0.5, 0.0, 1.0);
}
`;
