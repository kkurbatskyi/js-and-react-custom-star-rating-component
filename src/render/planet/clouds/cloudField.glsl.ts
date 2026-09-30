/**
 * The cloud density field (GLSL ES 3.00), shared by the cloud layer and the `cloudShadow` chunk a surface
 * shader can include, so the shadows fall exactly under the clouds the player sees.
 *
 * `cloudMask(n, fp, seedShift, detail, gradOut)` takes a unit direction n in the body frame and returns the
 * signed "cloudiness" m: a cloud where m > 0, thicker as m grows (the caller turns it into opacity). Layers:
 *   1. drift: the whole pattern turns about the spin axis (winds) and evolves slowly through the noise;
 *   2. cyclones: the sample direction is twisted about a few vortex centres, so the noise curls into spiral
 *      arms (angle = strength * exp(-(d / size)^2), sign by hemisphere) and the vortex core gets denser;
 *   3. cover: a zonal envelope (ITCZ, dry subtropics, storm tracks) sets the local cover; the threshold
 *      follows from it by the logistic approximation of the normal quantile, so the global cover matches
 *      `appearance.cloudCoverage`;
 *   4. structure: 3D simplex fBm for weather systems plus a finer fBm for cumulus texture, or (wisps)
 *      noise stretched along the latitude circles. Octaves fade out below the pixel footprint `fp` (rad).
 * Requires the `noise` chunk (snoise, snoiseGrad, FRACTAL_ROT, FRACTAL_SHIFT) and `common`.
 */
export const cloudFieldGlsl = /* glsl */ `
// ---- sky/cloudField ----------------------------------------------------------------------------
uniform vec4 uCloudA;        // cover, zonal mean, wisp (0/1), overcast (0/1)
uniform vec4 uCloudB;        // drift angle (rad), evolution phase, detail amplitude, unused
uniform vec3 uCloudSeed;
uniform int uCloudOctBase;
uniform int uCloudOctDetail;
uniform int uCloudVortexCount;
uniform vec4 uCloudVortexA[4];   // centre xyz (unit, body frame), angular size (rad)
uniform vec4 uCloudVortexB[4];   // twist at the centre (rad), unused

float cloudZonalEnvelope(float s) {
  float a = abs(s);
  float g0 = a / 0.16;
  float g1 = (a - 0.42) / 0.12;
  float g2 = (a - 0.75) / 0.14;
  return max(1.0 + 0.6 * exp(-g0 * g0) - 0.4 * exp(-g1 * g1) + 0.5 * exp(-g2 * g2), 0.1);
}

/** fBm of snoise with octaves fading out below the pixel footprint fp (radians of arc per pixel). */
float cloudFbm(vec3 p, int octaves, float fp, float f0) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  float f = f0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    float w = 1.0 - smoothstep(0.12, 0.45, fp * f * 0.15915494);
    if (w <= 0.0) break;
    sum += amp * w * snoise(p);
    norm += amp;
    amp *= 0.5;
    p = FRACTAL_ROT * p * 2.0 + FRACTAL_SHIFT;
    f *= 2.0;
  }
  return sum / max(norm, 1e-3);
}

/** Same with the analytic gradient: (value, d/dp0) where p0 is the first octave's position. */
vec4 cloudFbmGrad(vec3 p, int octaves, float fp, float f0) {
  vec4 sum = vec4(0.0);
  float amp = 1.0;
  float norm = 0.0;
  float f = f0;
  mat3 jac = mat3(1.0);
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    float w = 1.0 - smoothstep(0.12, 0.45, fp * f * 0.15915494);
    if (w <= 0.0) break;
    vec4 n = snoiseGrad(p);
    sum += amp * w * vec4(n.x, transpose(jac) * n.yzw);
    norm += amp;
    amp *= 0.5;
    p = FRACTAL_ROT * p * 2.0 + FRACTAL_SHIFT;
    jac = 2.0 * FRACTAL_ROT * jac;
    f *= 2.0;
  }
  return sum / max(norm, 1e-3);
}

/**
 * Cloudiness at the unit body-frame direction n. detail = 0 skips the fine texture (cheap: shadows).
 * grad receives d(m)/dn of the fine texture (for bump lighting) when detail = 1.
 */
float cloudMask(vec3 n, float fp, float detail, out vec3 grad) {
  grad = vec3(0.0);
  // 1. drift and 2. cyclones (pattern space: undo the drift, then twist about each centre)
  vec3 pn = rotateY(-uCloudB.x) * n;
  float boost = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uCloudVortexCount) break;
    vec4 va = uCloudVortexA[i];
    float k = length(pn - va.xyz) / va.w;
    float w = exp(-k * k);
    pn = rotateAxis(va.xyz, uCloudVortexB[i].x * w) * pn;
    boost = max(boost, w);
  }

  // 3. local cover -> threshold
  float cover = uCloudA.x * cloudZonalEnvelope(pn.y) / uCloudA.y;
  cover = clamp(cover + 0.18 * boost, 0.0, 0.985);
  cover = max(cover, 0.015);
  float threshold = 0.125 * log((1.0 - cover) / cover);

  // 4. structure
  vec3 p1;
  vec3 p2;
  float detailFreq;
  if (uCloudA.z > 0.5) {
    // wisps: stretch along the latitude circles
    vec3 z = vec3(normalize(pn.xz + vec2(1e-5)) * 2.4, asin(clamp(pn.y, -1.0, 1.0)) * 7.0);
    p1 = z * 0.9 + uCloudSeed;
    p2 = z * 4.0 + uCloudSeed * 1.7;
    detailFreq = 4.0;
  } else {
    p1 = pn * 2.5 + uCloudSeed + vec3(0.0, 0.0, uCloudB.y);
    p2 = pn * 21.0 + uCloudSeed * 1.7 + vec3(0.0, uCloudB.y * 2.0, 0.0);
    detailFreq = 21.0;
  }
  float base = cloudFbm(p1, uCloudOctBase, fp, 2.5);
  if (uCloudA.w > 0.5) base += 0.22 * sin(pn.y * 9.0 + 2.2 * base); // overcast: subtle banding
  float m = base - threshold;
  if (detail > 0.5) {
    vec4 dg = cloudFbmGrad(p2, uCloudOctDetail, fp, detailFreq);
    m += uCloudB.z * dg.x;
    grad = uCloudB.z * detailFreq * dg.yzw;
  } else {
    m += uCloudB.z * 0.5 * snoise(p2);
  }
  return m;
}
`;
