/**
 * Runtime shader for 'lite' rocky worlds: no bake, no textures, a few octaves of noise per pixel, so a
 * system can show ~30 of them. It evaluates the SAME continental field as the bake (identical seed
 * offsets and domain warp; fewer octaves), so continents, oceans and ice caps line up with the full
 * visual when the engine swaps lite -> full. Clouds are folded into the surface here (the separate cloud
 * shell exists only on full visuals) and a Fresnel rim stands in for the atmosphere shell.
 */
export const liteVertex = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const liteFragment = /* glsl */ `
uniform vec3 uSunDirB;
uniform vec3 uCamB;
uniform vec3 uSunRadiance;
uniform float uIntensity;
uniform vec3 uRadii;
uniform vec4 uRing;
uniform float uTime;

uniform vec3 uSeed;
uniform float uContScale;
uniform float uWarp;
uniform float uSea;
uniform float uEyeball;
uniform int uStyle;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uVeg;
uniform vec3 uSnow;
uniform vec3 uSand;
uniform float uVegAmount;
uniform float uIceLat;
uniform vec3 uOceanDeep;
uniform vec3 uOceanShallow;
uniform float uOceanMode;
uniform float uOceanRough;
uniform float uCraters;
uniform float uCloudCov;
uniform vec3 uCloudColor;
uniform int uEmissiveKind;
uniform float uEmissive;
uniform vec3 uSunTau;
uniform vec3 uSkyColor;
uniform float uAmbient;
uniform float uWrap;
uniform float uAirless;
uniform vec3 uHaze;
uniform float uRim;

in vec3 vDir;
out vec4 fragColor;

void main() {
  vec3 p = normalize(vDir);
  vec3 posB = p * uRadii;
  vec3 nGeo = normalize(p / uRadii);
  vec3 V = normalize(uCamB - posB);
  vec3 L = uSunDirB;
  float mu0 = dot(nGeo, L);
  float mu = saturate(dot(nGeo, V));

  // ---- the bake's continental field, at lite fidelity
  vec3 q = p * uContScale + uSeed;
  vec3 w = q + uWarp * vec3(fbm(q * 1.9 + 5.1, 2), fbm(q * 1.9 + 12.7, 2), fbm(q * 1.9 + 21.3, 2));
  float c = fbm(w, 5, 2.0, 0.46);
  c -= uEyeball * 0.5 * smoothstep(-0.3, 0.9, p.x);
  float hasSea = uSea > -8.0 ? 1.0 : 0.0;
  float land = mix(c, c - uSea, hasSea);
  float geo = 0.5 + 0.5 * fbm(p * 3.0 + uSeed * 1.3, 3);
  float alat = abs(p.y);

  // ---- ground colour by style
  vec3 ground = mix(uC0, uC1, smoothstep(0.25, 0.75, geo));
  if (uStyle == 0) {
    float moist = 0.5 + 0.5 * fbm(q * 1.9 + 77.0, 3);
    float wet = 0.22 * exp(-alat * alat / 0.12) - 0.2 * exp(-(alat - 0.42) * (alat - 0.42) / 0.03);
    float veg = uVegAmount * smoothstep(0.18, 0.48, moist + wet + 0.1) * (1.0 - smoothstep(0.72, 0.9, alat));
    vec3 vegCol = mix(uVeg * 1.5 + vec3(0.03, 0.025, 0.0), uVeg * 0.75, smoothstep(0.45, 0.85, moist));
    float dry = 1.0 - smoothstep(0.2, 0.48, moist + wet);
    ground = mix(ground, uSand, dry * 0.8);
    ground = mix(ground, vegCol, veg);
    ground = mix(ground, mix(uC2, uC3, geo), smoothstep(0.3, 0.6, land) * 0.8);
  } else if (uStyle == 1) {
    ground = mix(mix(uC0, uC2, smoothstep(0.3, 0.8, geo)), uC1, smoothstep(0.62, 0.7, 0.5 + 0.5 * fbm(q * 0.9 + 63.0, 3)) * 0.8);
  } else if (uStyle == 2) {
    ground = mix(mix(uC0, uC1, smoothstep(0.25, 0.75, geo)), uC2, smoothstep(0.55, 0.8, 1.0 - geo) * 0.7);
  } else if (uStyle == 3) {
    ground = mix(uC0, uC1, smoothstep(0.3, 0.7, geo));
  } else if (uStyle == 4) {
    ground = mix(mix(uC0, uC1, smoothstep(0.3, 0.7, geo)), uC2, smoothstep(0.55, 0.8, 0.5 + 0.5 * fbm(p * 5.0 + uSeed * 0.9, 3)) * 0.85);
  } else {
    ground = mix(uC0, uC1, smoothstep(0.15, -0.25, land * 0.5));
  }
  if (uCraters > 0.0 && uStyle != 0) {
    vec2 wv = worley(p * 9.0 + uSeed, 1.0);
    float bowl = smoothstep(0.3, 0.08, wv.x);
    float rim = smoothstep(0.42, 0.3, wv.x) - bowl;
    ground *= 1.0 - 0.28 * bowl * uCraters + 0.16 * rim * uCraters;
  }
  float iceLine = uIceLat + 0.1 * fbm(p * 4.0 + uSeed, 2);
  float ice = uIceLat < 1.0 ? smoothstep(iceLine - 0.03, iceLine + 0.03, alat) : 0.0;
  ground = mix(ground, uSnow, ice);

  // ---- liquid
  float ocean = 0.0;
  if (uOceanMode > 0.5) {
    float aa = max(fwidth(land) * 0.75, 0.002);
    ocean = (1.0 - smoothstep(-aa, aa, land)) * (1.0 - ice);
  }

  // ---- lighting
  vec3 sunT = uAmbient > 0.0 ? exp(-uSunTau * airmass(mu0)) : vec3(1.0);
  vec3 sunLight = uSunRadiance * sunT * ringShadow(posB, L, uRing);
  float skyDay = smoothstep(-0.22, 0.35, mu0);
  vec3 skyLight = uSunRadiance * uSkyColor * (uAmbient * skyDay);
  float vis = uWrap > 0.0 ? smoothstep(-0.02 - 0.1 * uWrap, 0.05 + 0.2 * uWrap, mu0) : 1.0;
  float dif = uAirless > 0.5
    ? lunarLambert(saturate(mu0), max(mu, 0.05), acos(clamp(dot(L, V), -1.0, 1.0)))
    : saturate(mu0);
  vec3 col = ground * (sunLight * (dif * vis) + skyLight);

  if (ocean > 0.001) {
    vec3 waterCol = uOceanMode > 2.5 ? ground * 0.4 : mix(uOceanShallow, uOceanDeep, 1.0 - exp(-max(-land, 0.0) * 5.0));
    vec3 H = normalize(L + V);
    float a = max(uOceanRough, 0.05);
    float spec = min(ggxD(saturate(dot(nGeo, H)), a) * smithV(saturate(mu0), max(mu, 0.02), a)
               * fresnelSchlick(0.02, saturate(dot(H, V))) * saturate(mu0), 20.0);
    vec3 oc = waterCol * (sunLight * (saturate((mu0 + uWrap) / (1.0 + uWrap)) * vis) + skyLight)
            + sunLight * spec * (uOceanMode > 2.5 ? 0.0 : 1.0)
            + fresnelSchlick(0.02, mu) * uSkyColor * uSunRadiance * (0.9 * uAmbient * skyDay);
    col = mix(col, oc, ocean);
  }

  // ---- folded-in clouds (the separate cloud shell exists only on full visuals)
  if (uCloudCov > 0.001) {
    vec3 cq = p * 3.2 + uSeed.yxz + vec3(uTime * 0.0008, 0.0, 0.0);
    float cn = 0.5 + 0.5 * fbm(cq + 0.6 * fbm(cq * 2.0, 2), 4);
    float cloud = uCloudCov >= 0.999 ? 0.85 + 0.15 * cn : 0.8 * smoothstep(1.0 - uCloudCov, 1.4 - uCloudCov, cn);
    float cw = 0.25;
    vec3 cl = uCloudColor * (sunLight * saturate((mu0 + cw) / (1.0 + cw)) + skyLight);
    col = mix(col, cl, cloud);
    ocean *= 1.0 - cloud;
    ice = max(ice, cloud);
  }

  // ---- emissives
  if (uEmissiveKind == 2) {
    vec2 wv = worley(p * 5.0 + uSeed, 1.0);
    float crack = (1.0 - smoothstep(0.0, 0.09, wv.y - wv.x)) * smoothstep(0.1, 0.55, 0.5 + 0.5 * fbm(q * 1.4 + 17.0, 2));
    float e = max(crack * 0.9, uOceanMode > 2.5 ? ocean * 0.8 : 0.0);
    vec3 hot = mix(vec3(0.7, 0.08, 0.01), vec3(1.0, 0.45, 0.08), smoothstep(0.2, 0.9, e));
    col += hot * (2.2 * uEmissive * pow(e, 2.2) * (1.0 - ice));
  } else if (uEmissiveKind == 1) {
    float night = 1.0 - smoothstep(-0.06, 0.05, mu0);
    float cities = smoothstep(0.62, 0.8, 0.5 + 0.5 * fbm(p * 22.0 + uSeed, 3)) * step(0.0, land) * (1.0 - ice);
    col += vec3(1.0, 0.74, 0.42) * (2.0 * uEmissive * cities * night);
  }

  // ---- atmosphere stand-in: a Fresnel rim, brightest on the lit limb
  col += uHaze * uSunRadiance * (pow(1.0 - mu, 3.2) * uRim * skyDay);

  fragColor = vec4(col * uIntensity, 1.0);
}
`;
