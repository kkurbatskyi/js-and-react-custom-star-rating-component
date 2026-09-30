/**
 * Runtime shader for baked rocky worlds (terran, ocean, desert, barren, ice, lava, dwarf, hothouse).
 *
 * Everything is evaluated in the BODY frame (Y = spin axis): the CPU hands over the sun direction,
 * the camera position and the eclipse casters already rotated into it (float64 on the CPU), so the
 * shader never needs the model matrix and stays precise at any camera distance. The mesh is the unit
 * sphere scaled by the ellipsoid radii; the fragment's direction `p` indexes the baked cube maps.
 *
 * Pipeline: baked albedo/relief -> sub-texel detail octaves (3D simplex, faded by pixel footprint) ->
 * land shading (Oren-Nayar, or lunar-Lambert on airless bodies) or ocean shading (GGX sun glint, Fresnel
 * sky reflection, depth-tinted water, wave normals, coast AA) -> sunlight extinction and skylight ->
 * shadows (planet horizon march over the baked height, eclipses, ring shadow) -> emissives.
 */
export const rockyVertex = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const rockyFragment = /* glsl */ `
uniform samplerCube uAlbedoTex;
uniform samplerCube uReliefTex;

uniform vec3 uSunDirB;
uniform vec3 uCamB;
uniform vec3 uSunRadiance;
uniform float uIntensity;
uniform vec3 uRadii;
uniform float uSunAng;
uniform vec4 uOcc[4];
uniform int uOccCount;
uniform vec4 uRing;
uniform float uTime;

uniform vec3 uSeed;
uniform float uRelief;
uniform float uBakeTexel;
uniform float uDetailOctaves;
uniform float uDetailSlope;
uniform float uDetailAlbedo;

uniform vec3 uOceanDeep;
uniform vec3 uOceanShallow;
uniform float uOceanMode;   // 0 none, 1 water, 2 hydrocarbon, 3 magma
uniform float uOceanRough;
uniform int uEmissiveKind;  // 0 none, 1 city lights, 2 lava
uniform float uEmissive;
uniform vec3 uSunTau;
uniform vec3 uSkyColor;
uniform float uAmbient;
uniform float uWrap;
uniform float uAirless;
uniform float uRough;
uniform int uDebug;

in vec3 vDir;
out vec4 fragColor;

/** Blackbody-ish lava ramp: deep red crust glow -> orange -> yellow-white, e in 0..1. */
vec3 lavaColor(float e) {
  vec3 c = mix(vec3(0.55, 0.04, 0.01), vec3(1.0, 0.32, 0.04), smoothstep(0.15, 0.6, e));
  return mix(c, vec3(1.0, 0.72, 0.28), smoothstep(0.65, 1.0, e));
}

/**
 * Terrain shadows: march towards the sun along the surface over the baked height (8 bit, in radii via
 * uRelief). The sun ray rises above the sphere as phi tan(e) + phi^2/2 (curvature helps); the smoothstep
 * width models the penumbra (sun angular size) plus the height quantisation.
 */
float horizonShadow(vec3 p, vec3 L, float hp) {
  float mu = dot(p, L);
  if (mu > 0.55) return 1.0;
  if (mu < -0.3) return 0.0;
  vec3 t = L - mu * p;
  float tl = length(t);
  if (tl < 1e-4) return 1.0;
  t /= tl;
  float tanE = mu / sqrt(max(1.0 - mu * mu, 1e-4));
  float shadow = 1.0;
  float phi = 0.0025;
  for (int i = 0; i < 11; i++) {
    vec3 q = p * cos(phi) + t * sin(phi);
    float ht = (texture(uReliefTex, q).a * 2.0 - 0.75) * uRelief;
    float ray = hp + phi * tanE + 0.5 * phi * phi;
    float soft = phi * uSunAng * 2.0 + uRelief * 0.012 + 1e-4;
    shadow = min(shadow, smoothstep(-soft, soft, ray - ht));
    phi *= 1.55;
  }
  return shadow;
}

void main() {
  vec3 p = normalize(vDir);
  float px = max(length(dFdx(p)), length(dFdy(p)));   // one pixel on the unit sphere, in radians
  vec3 posB = p * uRadii;                              // km, body frame
  vec3 nGeo = normalize(p / uRadii);
  vec3 V = normalize(uCamB - posB);
  vec3 L = uSunDirB;
  float mu0 = dot(nGeo, L);

  vec4 A = texture(uAlbedoTex, p);
  vec4 B = texture(uReliefTex, p);
  float h = B.a * 2.0 - 0.75;
  float ice = saturate((0.5 - A.a) * 2.0);
  float emis = saturate((A.a - 0.5) * 2.0);
  vec3 slopeV = (B.rgb - 0.5) * 1.4;
  vec3 albedo = A.rgb;

  // ---- sub-texel detail: octaves of 3D simplex above the bake resolution, faded out by pixel footprint
  vec3 dslope = vec3(0.0);
  float dalb = 0.0;
  float dcoast = 0.0;
  if (uDetailOctaves > 0.5) {
    for (int k = 0; k < 5; k++) {
      if (float(k) >= uDetailOctaves) break;
      float wl = 4.0 * uBakeTexel * exp2(-float(k));
      float fade = smoothstep(1.5 * px, 4.0 * px, wl);
      if (fade <= 0.001) break;
      vec4 nz = snoiseGrad(p / wl + uSeed * (1.0 + 0.37 * float(k)));
      float amp = fade * exp2(-0.35 * float(k));
      dslope += amp * nz.yzw;
      dalb += amp * nz.x;
      if (k == 1) dcoast = nz.x * fade;
    }
  }
  float rough = uDetailSlope * (0.6 + 1.5 * length(slopeV));
  vec3 sd = dslope * rough;
  sd -= dot(sd, p) * p;
  albedo *= max(0.0, 1.0 + uDetailAlbedo * dalb * (1.0 - 0.6 * ice));

  vec3 n = normalize(p - slopeV - sd);

  // ---- liquid coverage (baked height crossing sea level, anti-aliased by the height derivative)
  float hc = h + 0.02 * dcoast;
  float ocean = 0.0;
  if (uOceanMode > 0.5) {
    float w = max(fwidth(hc) * 0.75, 0.0015);
    ocean = (1.0 - smoothstep(-w, w, hc)) * (1.0 - ice);
  }

  // ---- sunlight at the ground: extinction by the atmosphere, then shadows
  vec3 sunT = vec3(1.0);
  if (uAmbient > 0.0) sunT = exp(-uSunTau * airmass(mu0));
  float shadow = 1.0;
  if (mu0 > -0.3 && ocean < 0.99) shadow = horizonShadow(p, L, h * uRelief);
  float eclipse = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uOccCount) break;
    eclipse = min(eclipse, eclipseVisibility(posB, L, uOcc[i].xyz, uOcc[i].w, uSunAng));
  }
  float ringS = ringShadow(posB, L, uRing);
  vec3 sunLight = uSunRadiance * sunT * (eclipse * ringS);
  float skyDay = smoothstep(-0.22, 0.35, mu0);
  vec3 skyLight = uSunRadiance * uSkyColor * (uAmbient * skyDay * max(eclipse, 0.15) * mix(0.55, 1.0, ringS));
  float vis = uWrap > 0.0 ? smoothstep(-0.02 - 0.1 * uWrap, 0.05 + 0.2 * uWrap, mu0) : 1.0;

  // ---- land
  float ndl = dot(n, L);
  float ndv = max(dot(n, V), 0.05);
  float dif;
  if (uAirless > 0.5) {
    dif = lunarLambert(saturate(ndl), ndv, acos(clamp(dot(L, V), -1.0, 1.0)));
  } else {
    dif = orenNayar(saturate(ndl), ndv, n, L, V, uRough);
  }
  vec3 land = albedo * (sunLight * (dif * shadow * vis) + skyLight);

  // ---- ocean
  vec3 col = land;
  if (ocean > 0.001) {
    vec3 oceanCol;
    if (uOceanMode > 2.5) {
      oceanCol = albedo * (sunLight * saturate(dot(nGeo, L)) * shadow * 0.5 + skyLight);
    } else {
      vec3 nW = nGeo;
      float windRough = uOceanRough;
      float wind = 0.5 + 0.5 * snoise(p * 2.7 + uSeed * 1.3 + vec3(0.0, uTime * 0.0015, 0.0));
      windRough = uOceanRough * (0.65 + 0.7 * wind);
      vec3 ws = vec3(0.0);
      for (int k = 0; k < 3; k++) {
        float wl = 10.0 * uBakeTexel * exp2(-float(k) * 1.3);
        float fade = smoothstep(1.5 * px, 5.0 * px, wl);
        if (fade <= 0.001) break;
        vec4 nz = snoiseGrad(p / wl + uSeed * 1.9 + vec3(uTime * 0.01 * exp2(float(k)), 0.0, 0.0));
        ws += fade * nz.yzw * exp2(-0.5 * float(k));
      }
      ws *= 0.05 + 0.09 * wind;
      ws -= dot(ws, p) * p;
      nW = normalize(nGeo - ws);

      float depth = max(-hc, 0.0);
      float shelf = exp(-depth * 9.0);
      vec3 waterCol = mix(uOceanDeep, uOceanShallow, exp(-depth * 3.5));
      waterCol = mix(waterCol, albedo * 0.5 + uOceanShallow * 0.7, shelf * shelf * 0.75);
      waterCol *= 1.0 + 0.16 * snoise(p * 7.0 + uSeed) * (1.0 - shelf);

      float f0 = uOceanMode > 1.5 ? 0.04 : 0.02;
      vec3 H = normalize(L + V);
      float ndlW = saturate(dot(nW, L));
      float ndvW = max(dot(nW, V), 0.02);
      float ndh = saturate(dot(nW, H));
      float a = max(windRough, 0.03);
      float Fs = fresnelSchlick(f0, saturate(dot(H, V)));
      float spec = min(ggxD(ndh, a) * smithV(ndlW, ndvW, a) * Fs * ndlW, 40.0);
      float Fv = fresnelSchlick(f0, ndvW);
      float wetDif = saturate((mu0 + uWrap) / (1.0 + uWrap));
      oceanCol = waterCol * (sunLight * (wetDif * shadow * vis) * (1.0 - Fv) + skyLight)
               + sunLight * (spec * shadow)
               + Fv * uSkyColor * uSunRadiance * (0.3 * uAmbient * skyDay * 3.0);
    }
    col = mix(land, oceanCol, ocean);
  }

  // ---- emissives: lava glow and city lights (only where it is dark)
  if (uEmissiveKind == 2) {
    float e = emis;
    if (uOceanMode > 2.5) e = max(e, ocean * 0.9);
    col += lavaColor(e) * (3.4 * uEmissive * e * e);
  } else if (uEmissiveKind == 1) {
    float night = 1.0 - smoothstep(-0.06, 0.05, mu0);
    col += vec3(1.0, 0.74, 0.42) * (2.6 * uEmissive * emis * night);
  }

  if (uDebug == 1) col = albedo;
  else if (uDebug == 2) col = n * 0.5 + 0.5;
  else if (uDebug == 3) col = vec3(h * 0.5 + 0.375);
  fragColor = vec4(col * uIntensity, 1.0);
}
`;
