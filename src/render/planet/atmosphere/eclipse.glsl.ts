/**
 * Eclipse shadows for the sky shaders (GLSL ES 3.00): the fraction of the star's disc left visible from a
 * point P past an occluding sphere (a moon), i.e. umbra, penumbra and antumbra with the exact overlap area of
 * two discs (the same physics the surface shader uses for its own eclipses). Unique names (`sky` prefix), no
 * dependencies except `PI` from the common chunk. Include once per shader.
 */
export const skyEclipseGlsl = /* glsl */ `
// ---- sky/eclipse ----------------------------------------------------------------------------------
/** Fraction of the star's disc (angular radius rs) covered by a disc of angular radius ro at separation d. */
float skyDiscOverlap(float rs, float ro, float d) {
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

/** Sunlight visibility at P past a sphere (centre c, radius r); sunDir = unit vector towards the star. */
float skyEclipse(vec3 P, vec3 sunDir, vec3 c, float r, float sunAng) {
  vec3 d = c - P;
  float dist = length(d);
  float along = dot(d, sunDir);
  if (along <= 0.0 || dist <= r) return 1.0;
  float rho = asin(min(r / dist, 1.0));
  float sep = acos(clamp(along / dist, -1.0, 1.0));
  return 1.0 - skyDiscOverlap(max(sunAng, 1e-5), rho, sep);
}

/** Product over the (up to 4) occluders: count of them are valid, xyz = centre relative to the body, w = radius. */
float skyEclipseAll(vec3 P, vec3 sunDir, vec4 occ[4], int count, float sunAng) {
  float v = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= count) break;
    v *= skyEclipse(P, sunDir, occ[i].xyz, occ[i].w, sunAng);
  }
  return v;
}
`;
