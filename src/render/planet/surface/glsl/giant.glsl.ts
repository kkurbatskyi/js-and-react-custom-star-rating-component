/**
 * Runtime shader for gas and ice giants: latitude bands with zonal jets, animated turbulence,
 * vortices (great spots), an optional polar hexagon, ice-giant cirrus streaks, thermal glow for hot
 * Jupiters, limb darkening and a soft terminator. Fully analytic: no bake, `ready` immediately.
 *
 * Band structure. A CPU-built 1-D profile texture (`giantProfile.ts`) over latitude holds the band value,
 * the zonal wind and its shear. The wind carries the turbulence pattern in longitude at a latitude-dependent
 * rate, so neighbouring bands slide past each other. A pattern sheared for ever would smear into streaks, so
 * two copies of the flow, half a cycle apart, are cross-faded with triangle weights (the classic "flow map"
 * loop): each copy is invisible exactly when it resets.
 * Vortices twist the sampling position about their centre (Rodrigues rotation, angle falling off with
 * distance), which draws spiral arms in the surrounding bands for free; they drift with the local jet.
 *
 * All vectors are in the body frame (Y = spin axis); see rocky.glsl.ts.
 */
export const giantVertex = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const giantFragment = /* glsl */ `
uniform sampler2D uProfile;
uniform vec3 uColors[5];
uniform int uColorCount;

uniform vec3 uSunDirB;
uniform vec3 uCamB;
uniform vec3 uSunRadiance;
uniform float uIntensity;
uniform vec3 uRadii;
uniform float uSunAng;
uniform vec4 uOcc[4];
uniform int uOccCount;
uniform vec4 uRing;

uniform vec3 uSeed;
uniform float uBandFreq;
uniform float uContrast;
uniform float uTurbulence;
uniform float uJetSpeed;
uniform float uFlow;
uniform float uCycleDays;
uniform float uLite;
uniform vec4 uSpots[4];      // latitude, longitude, radius, swirl
uniform vec4 uSpotCol[4];    // colour, tint weight
uniform int uSpotCount;
uniform float uHexagon;
uniform vec3 uPolarTint;
uniform float uStreaks;
uniform vec3 uGlowColor;
uniform vec2 uGlow;          // night-side, day-side emission
uniform float uLimb;
uniform float uWrap;

in vec3 vDir;
out vec4 fragColor;

/** (band value -1..1, zonal wind -1..1, shear 0..1) at a latitude in radians. */
vec3 profileAt(float lat) {
  vec3 t = texture(uProfile, vec2(lat / PI + 0.5, 0.5)).rgb;
  return vec3(t.r * 2.0 - 1.0, t.g * 2.0 - 1.0, t.b);
}

/** Dark-to-light band palette with eased blending between neighbouring colours. */
vec3 palette(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uColorCount - 1);
  int i = int(min(floor(x), float(uColorCount - 2)));
  float f = smoothstep(0.0, 1.0, x - float(i));
  return mix(uColors[i], uColors[i + 1], f);
}

/**
 * One flow layer: the pattern carried east/west by the local wind for a fraction 'phase' of the cycle.
 * Returns (latitude wobble, fine structure, streak field).
 */
vec3 flowLayer(vec3 p, float wind, float phase, int oct) {
  float ang = wind * uJetSpeed * uCycleDays * (phase - 0.5);
  vec3 pr = rotateY(ang) * p;
  // Stretched along longitude: turbulence in a jet is elongated by the shear.
  vec3 q = vec3(pr.x * 0.55, pr.y * 3.0, pr.z * 0.55) * (uBandFreq * 1.25) + uSeed;
  vec3 warp = vec3(fbm(q * 0.7 + 1.3, 3), fbm(q * 0.7 + 7.9, 3), fbm(q * 0.7 + 15.1, 3));
  vec3 w = q + (0.35 + 0.5 * uTurbulence) * warp;
  float fine = fbm(w * 2.3, oct);
  float streak = fbm(vec3(pr.x * 1.2, pr.y * 30.0, pr.z * 1.2) + uSeed.zxy, 3);
  return vec3(warp.y, fine, streak);
}

void main() {
  vec3 p = normalize(vDir);
  float px = max(length(dFdx(p)), length(dFdy(p)));
  vec3 posB = p * uRadii;
  vec3 nGeo = normalize(p / uRadii);
  vec3 V = normalize(uCamB - posB);
  vec3 L = uSunDirB;
  float mu0 = dot(nGeo, L);
  float mu = saturate(dot(nGeo, V));
  float lat = asin(clamp(p.y, -1.0, 1.0));

  // ---- vortices: swirl the sampling position, gather tint weights
  vec3 ps = p;
  vec3 tintCol = vec3(0.0);
  float tintW = 0.0;
  float collarDark = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uSpotCount) break;
    vec4 s = uSpots[i];
    float windC = profileAt(s.x).y;
    float lonC = s.y + windC * uJetSpeed * uFlow;
    vec3 c = vec3(cos(s.x) * cos(lonC), sin(s.x), cos(s.x) * sin(lonC));
    vec3 eLon = normalize(vec3(c.z, 0.0, -c.x));
    vec3 eLat = cross(c, eLon);
    vec2 d = vec2(dot(p, eLon), dot(p, eLat)) / s.z;
    d.x /= 1.7;
    float r = length(d);
    ps = rotateAxis(c, s.w * (1.0 - smoothstep(0.0, 1.9, r))) * ps;
    float core = (1.0 - smoothstep(0.55, 1.0, r)) * uSpotCol[i].a;
    tintCol += uSpotCol[i].rgb * core;
    tintW += core;
    collarDark = max(collarDark, smoothstep(0.9, 1.2, r) * (1.0 - smoothstep(1.2, 1.7, r)));
  }

  // ---- bands and turbulence
  float wind = profileAt(lat).y;
  int oct = int(clamp(floor(log2(1.0 / max(px * uBandFreq * 6.0, 1e-6))) + 1.0, 3.0, uLite > 0.5 ? 3.0 : 7.0));
  vec3 f;
  if (uLite > 0.5) {
    f = flowLayer(ps, wind, 0.5, oct);
  } else {
    float cyc = uFlow / uCycleDays;
    float t0 = fract(cyc);
    float t1 = fract(cyc + 0.5);
    float w0 = 1.0 - abs(2.0 * t0 - 1.0);
    f = flowLayer(ps, wind, t0, oct) * w0 + flowLayer(ps, wind, t1, oct) * (1.0 - w0);
  }
  float latD = lat + 0.05 * uTurbulence * f.x;
  vec3 prof = profileAt(latD);
  float t = 0.5 + 0.62 * prof.x * uContrast + uTurbulence * (0.12 + 0.30 * prof.z) * f.y;
  t = smoothstep(0.04, 0.96, t);
  vec3 col = palette(clamp(t, 0.0, 1.0));

  // ---- ice-giant cirrus streaks
  if (uStreaks > 0.0) {
    float s = smoothstep(0.42, 0.75, f.z) * uStreaks * smoothstep(0.15, 0.5, abs(lat)) * (1.0 - smoothstep(0.9, 1.2, abs(lat)));
    col = mix(col, palette(1.0) * 1.2, s * 0.7);
  }

  // ---- polar cap tint and Saturn-style hexagon (jet ring at colatitude 0.2 rad, six-fold)
  float colat = 1.5707963 - abs(lat);
  if (uHexagon > 0.5) {
    float lon = atan(p.z, p.x);
    float a = mod(lon, PI / 3.0) - PI / 6.0;
    float rHex = 0.2 * cos(PI / 6.0) / cos(a);
    float inside = 1.0 - smoothstep(rHex - 0.012, rHex + 0.012, colat);
    float rd = (colat - rHex) / 0.010;
    float rim = exp(-rd * rd);
    col = mix(col, uPolarTint, inside * 0.85);
    col *= 1.0 + 0.35 * rim;
  } else {
    col = mix(col, uPolarTint, smoothstep(0.42, 0.14, colat) * 0.6);
  }

  // ---- vortex colour and dark collar
  if (tintW > 0.0) col = mix(col, tintCol / max(tintW, 1e-3), min(tintW, 1.0));
  col *= 1.0 - 0.22 * collarDark;

  // ---- lighting: deep atmosphere => soft terminator, limb darkening; shadows from rings and moons
  float dif = pow(saturate((mu0 + uWrap) / (1.0 + uWrap)), 1.15);
  float limb = 1.0 - uLimb * (1.0 - sqrt(mu));
  float vis = ringShadow(posB, L, uRing);
  for (int i = 0; i < 4; i++) {
    if (i >= uOccCount) break;
    vis = min(vis, eclipseVisibility(posB, L, uOcc[i].xyz, uOcc[i].w, uSunAng));
  }
  vec3 lit = col * uSunRadiance * (dif * limb * vis);

  // ---- thermal emission of hot giants: night side glow, darker (deeper) belts glow brighter
  float night = 1.0 - smoothstep(-0.1, 0.25, mu0);
  vec3 glow = uGlowColor * (uGlow.x * night + uGlow.y) * mix(1.35, 0.6, t);

  fragColor = vec4((lit + glow) * uIntensity, 1.0);
}
`;
