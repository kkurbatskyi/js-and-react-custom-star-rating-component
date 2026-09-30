/**
 * Bake pass 1 — terrain. One fragment per cube texel; writes RGBA16F:
 *   R  height (normalised: 0 = sea level on worlds with liquid; about -0.75 .. 1.25)
 *   G  moisture 0..1 (low-frequency wetness, refined by latitude in the albedo pass)
 *   B  "special" mask, meaning depends on the style: mare (regolith), lineae/chaos (icy),
 *      crack/patera heat (volcanic)
 *   A  crater freshness / ejecta-ray brightness 0..1 (regolith, dwarf, icy)
 *
 * Everything is a function of the direction only, so the result is seamless across cube faces and
 * deterministic. Components are weighted by uniforms (no per-instance defines): a terran world
 * enables continents/mountains/hills, a moon enables craters/mare, an ice moon lineae and chaos...
 *
 * Height budget. Heights are in units of `uRelief` radii, so their gradient is the physical slope.
 * Crater depth follows depth ~ 0.026 D^0.63 (D in radii): d/D falls from ~0.2 for small simple craters
 * to ~0.03 for basins (Pike 1977, softened so basins remain visible under a low sun).
 */
export const bakeTerrainGlsl = /* glsl */ `
// ---- planet/bakeTerrain --------------------------------------------------------
uniform vec3 uSeed;
uniform float uContScale;
uniform float uWarp;
uniform float uSea;
uniform float uContAmp;
uniform float uMountains;
uniform float uHills;
uniform float uCraters;
uniform float uCraterSize;
uniform float uMare;
uniform float uRifts;
uniform float uVolcanoes;
uniform float uLineae;
uniform float uChaos;
uniform float uRelief;
uniform float uEyeball;
uniform float uRays;
uniform int uStyle;

out vec4 fragColor;

/** Radial crater cross-section: x = distance / radius. depth-normalised (bowl floor = -depth). */
float craterProfile(float x, float age, float flatness, float peaky) {
  float depth = mix(1.0, 0.4, age);
  float floorShape = mix(2.0, 4.5, flatness);
  float bowl = x < 1.0 ? -depth * (1.0 - pow(x, floorShape)) : 0.0;
  float rimW = mix(0.10, 0.24, age);
  float rt = (x - 1.0) / rimW;
  float rim = 0.45 * depth * exp(-rt * rt);
  float ej = 0.2 * depth * pow(max(x, 1.0), -3.2) * smoothstep(0.9, 1.15, x);
  float pk = x / 0.14;
  float peak = x < 0.5 ? peaky * 0.5 * depth * exp(-pk * pk) : 0.0;
  return bowl + rim + ej + peak;
}

/**
 * One octave of a crater population. Lattice points (frequency f: spacing 1/f radians) jittered by
 * +-0.25; each holds a crater with probability 'density'. Radii <= 0.46 lattice units, so the 8
 * surrounding lattice points always suffice. Because the lattice is 3D, a lattice point that lies
 * off the sphere yields a smaller, shallower crater: a natural size spread for free.
 * Returns (height in normalised units, freshness brightness, pit mask).
 */
vec3 craterOctave(vec3 q, float f, float density, float seedOff, float ageBase, float flatness, float peaky) {
  vec3 cell = floor(q);
  float H = 0.0;
  float bright = 0.0;
  float pit = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 id = cell + o;
    vec3 r1 = hash33(id + seedOff);
    if (r1.x > density) continue;
    vec3 r2 = hash33(id * 1.618 + seedOff + 19.7);
    vec3 c = id + (r2 - 0.5) * 0.5;
    float rq = mix(0.16, 0.46, r1.y * r1.y);
    float x = length(q - c) / rq;
    if (x > 2.6) continue;
    float age = clamp(ageBase + (r1.z - 0.5) * 0.6, 0.0, 1.0);
    float radRad = rq / f;
    float depthR = 0.026 * pow(2.0 * radRad, 0.63) / uRelief;
    H += craterProfile(x, age, flatness, peaky) * depthR;
    bright += (1.0 - age) * (1.0 - age) * smoothstep(2.6, 1.0, x);
    pit = max(pit, 1.0 - smoothstep(0.75, 1.0, x));
  }
  return vec3(H, bright, pit);
}

/** Sparse, fresh, bright-rayed craters (Tycho, Copernicus): brightness 0..1 out to ~ 1 lattice unit. */
float rayCraters(vec3 p) {
  vec3 centre = uSeed * 3.1;
  vec3 q = p * 1.7 + centre;
  vec3 cell = floor(q);
  float b = 0.0;
  for (int k = 0; k < 27; k++) {
    vec3 id = cell + vec3(float(k % 3) - 1.0, float((k / 3) % 3) - 1.0, float(k / 9) - 1.0);
    vec3 r1 = hash33(id + 71.3);
    if (r1.x > uRays) continue;
    vec3 c = id + 0.5 + (hash33(id * 1.9 + 3.1) - 0.5) * 0.6;
    float surf = abs(length(c - centre) - 1.7);   // distance of the crater's lattice point from the sphere
    if (surf > 0.4) continue;
    vec3 d3 = q - c;
    float d = length(d3);
    if (d > 1.2) continue;
    vec3 n = normalize(c - centre);
    vec3 t1 = normalize(cross(n, vec3(0.31, 0.93, 0.2)));
    vec3 t2 = cross(n, t1);
    float ang = atan(dot(d3, t2), dot(d3, t1));
    float rays = 0.5 + 0.5 * sin(ang * (7.0 + floor(r1.y * 9.0)) + r1.z * 40.0 + 2.5 * snoise(d3 * 3.0 + r1));
    rays = pow(rays, 3.0);
    float halo = smoothstep(0.3, 0.04, d);
    float reach = smoothstep(1.2, 0.12, d);
    b += (0.35 + 0.65 * r1.z) * (halo + 0.75 * rays * reach) * (1.0 - surf / 0.4);
  }
  return clamp(b, 0.0, 1.0);
}

/** Shield volcanoes: broad cones with summit calderas. Returns height in normalised units. */
float shieldVolcanoes(vec3 p, float amount) {
  vec3 q = p * 1.3 + uSeed * 1.7;
  vec3 cell = floor(q);
  float H = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 id = cell + o;
    vec3 r1 = hash33(id + 133.7);
    if (r1.x > amount * 0.55) continue;
    vec3 c = id + (hash33(id * 1.3 + 9.1) - 0.5) * 0.5;
    float rq = mix(0.22, 0.46, r1.y);
    float x = length(q - c) / rq;
    if (x > 1.0) continue;
    float cone = pow(1.0 - smoothstep(0.0, 1.0, x), 1.5);
    float caldera = 0.34 * smoothstep(0.17, 0.0, x);
    H += (0.5 + 0.7 * r1.z) * (cone - caldera);
  }
  return H;
}

/** Dominant canyon system (Valles Marineris): a warped great-circle trench of limited length. */
float canyon(vec3 p) {
  vec3 axis = normalize(hash33(uSeed * 1.13 + 5.0) * 2.0 - 1.0 + vec3(0.001));
  float g = dot(p, axis) + 0.045 * fbm(p * 4.0 + uSeed, 3);
  vec3 t = normalize(cross(axis, vec3(0.0, 1.0, 0.1) + 0.5 * hash33(uSeed.zxy)));
  float along = dot(p, t);
  float width = 0.038 * (0.55 + 0.9 * (0.5 + 0.5 * fbm(p * 8.0 + uSeed * 2.0, 3)));
  float lengthMask = smoothstep(-0.6, -0.2, along) * smoothstep(0.7, 0.3, along);
  return smoothstep(width, width * 0.15, abs(g)) * lengthMask;
}

void main() {
  vec3 p = bakeDir();
  vec3 q = p * uContScale + uSeed;

  // ---- continents: an 8-octave domain-warped fBm; coastlines come from where it crosses the sea level
  vec3 w = q + uWarp * vec3(fbm(q * 1.9 + 5.1, 3), fbm(q * 1.9 + 12.7, 3), fbm(q * 1.9 + 21.3, 3));
  float c = fbm(w, 7, 2.0, 0.44);
  c -= uEyeball * 0.5 * smoothstep(-0.3, 0.9, p.x);          // liquid basin under the substellar point
  float hasSea = uSea > -8.0 ? 1.0 : 0.0;
  float land = mix(c, c - uSea, hasSea);
  float coastal = mix(1.0, smoothstep(0.0, 0.14, land), hasSea);
  // Seafloor: a narrow continental shelf that drops quickly to flat abyssal basins (Earth's shelves are ~5% of the ocean).
  float macro = 0.55 * land * uContAmp;
  if (hasSea > 0.5 && land < 0.0) macro = -0.7 * (1.0 - exp(4.5 * land)) * uContAmp;

  // ---- mountain belts: ridged multifractal clustered by a low-frequency 'orogeny' mask
  float mountains = 0.0;
  if (uMountains > 0.0) {
    float oro = smoothstep(0.42, 0.78, 0.5 + 0.5 * fbm(q * 1.15 + 41.0, 3) + 0.2 * coastal);
    float ridge = ridged(w * 2.4 + 9.0, 7);
    mountains = ridge * ridge * oro * coastal * uMountains;
  }
  float hills = uHills > 0.0 ? fbm(w * 4.0 + 21.0, 5) * uHills * coastal * 0.11 : 0.0;
  float h = macro + mountains * 0.95 + hills;

  float special = 0.0;
  float aux = 0.0;

  // ---- mare: dark, smooth basalt basins that flood old terrain
  float mare = 0.0;
  if (uMare > 0.0) {
    float m = 0.5 + 0.5 * fbm(q * 0.9 + 63.0 + 0.35 * fbm(q * 2.3, 2), 4);
    mare = smoothstep(0.72 - 0.5 * uMare, 0.77 - 0.5 * uMare, m);
    h = h * (1.0 - 0.85 * mare) - 0.12 * mare;
    special = mare;
  }

  // ---- impact craters: seven octaves of the lattice population, largest (oldest) first
  if (uCraters > 0.0) {
    float f0 = 0.5 / uCraterSize;
    float dens = clamp(uCraters, 0.0, 1.0) * 0.75;
    for (int k = 0; k < 7; k++) {
      float t = float(k) / 6.0;
      float f = f0 * exp2(float(k));
      vec3 cr = craterOctave(p * f + uSeed + float(k) * 13.7, f, dens, 3.1 + float(k) * 7.3,
                             mix(0.75, 0.1, t), mix(1.0, 0.0, smoothstep(0.0, 0.6, t)), k < 3 ? 1.0 : 0.0);
      float flood = k < 3 ? 1.0 - 0.9 * mare : 1.0 - 0.4 * mare;
      h += cr.x * flood;
      aux = max(aux, min(1.0, cr.y * 0.35));
    }
  }
  if (uRays > 0.0) aux = max(aux, rayCraters(p));

  // ---- shield volcanoes and canyons (Mars-like / Venus-like worlds)
  if (uVolcanoes > 0.0 && uStyle != 4) h += 0.9 * shieldVolcanoes(p, uVolcanoes);
  if (uRifts > 0.0) h -= 0.85 * uRifts * canyon(p);

  // ---- ice shells: lineae (cracks) and chaos terrain
  if (uLineae > 0.0) {
    vec3 lq = w * 1.7 + 3.3;
    float a = 1.0 - abs(snoise(lq));
    float b = 1.0 - abs(snoise(lq * 2.3 + 8.0));
    float lin = max(pow(a, 40.0), 0.7 * pow(b, 50.0)) * uLineae;
    h -= 0.12 * lin;
    special = max(special, lin);
  }
  if (uChaos > 0.0) {
    float m = smoothstep(0.35, 0.6, 0.5 + 0.5 * fbm(q * 1.3 + 99.0, 3));
    float blocks = floor((0.5 + 0.5 * fbm(q * 11.0, 3)) * 4.0) / 4.0;
    h += m * uChaos * 0.22 * blocks;
    special = max(special, m * uChaos * 0.7);
  }

  // ---- volcanic style (Io-like): paterae (flat-floored calderas) and a glowing crack network
  if (uStyle == 4) {
    float pit = 0.0;
    float pdens = clamp(uVolcanoes * 0.5, 0.0, 0.9);
    for (int k = 0; k < 3; k++) {
      float f = 3.2 * exp2(float(k));
      vec3 cr = craterOctave(p * f + uSeed * 2.1 + float(k) * 5.3, f, pdens, 41.0 + float(k) * 3.0,
                             0.8, 1.0, 0.0);
      h += 0.5 * cr.x;
      pit = max(pit, cr.z);
    }
    vec3 cq = (p + 0.06 * vec3(fbm(p * 5.0 + uSeed, 3), fbm(p * 5.0 + uSeed + 7.0, 3), fbm(p * 5.0 + uSeed + 13.0, 3))) * 4.2 + uSeed;
    vec2 wv = worley(cq, 1.0);
    float crack = 1.0 - smoothstep(0.0, 0.07, wv.y - wv.x);
    float activity = smoothstep(0.1, 0.55, 0.5 + 0.5 * fbm(q * 1.4 + 17.0, 3));
    float lake = smoothstep(0.62, 0.8, 0.5 + 0.5 * fbm(q * 3.1 + 5.0, 3));   // only some paterae hold a lava lake
    special = max(crack * activity * 0.85, pit * lake * 0.7);
    aux = pit;
    h -= 0.06 * crack;
  }

  float moist = 0.5 + 0.5 * fbm(q * 1.9 + 77.0, 4);
  fragColor = vec4(h, moist, special, aux);
}
`;
