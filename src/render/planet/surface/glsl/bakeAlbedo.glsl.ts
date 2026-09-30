/**
 * Bake pass 2 — albedo. Reads the terrain cube (pass 1) and writes RGBA8 in sRGB storage:
 *   RGB  linear albedo (the hardware converts to/from sRGB, so 8 bits stay perceptually even)
 *   A    0.5 + 0.5 * emissive - 0.5 * ice   (ice suppresses lights and lava, so the two share a channel;
 *        0.5 is neutral, and the packing interpolates and mip-maps sensibly)
 *
 * The world's climate drives the palette: a zonal temperature table (from obliquity, atmosphere and
 * tidal locking; see appearance.ts) plus a lapse rate gives Tk, and the ice line is the coverage
 * quantile of that table, so polar caps reproduce `iceCoverage`. Terran worlds use a Whittaker-style
 * biome model (temperature x moisture, Hadley-cell wet/dry latitude bands, coastal moisture, rock on
 * steep or high ground, beaches, tundra, treeline).
 */
export const bakeAlbedoGlsl = /* glsl */ `
// ---- planet/bakeAlbedo ---------------------------------------------------------
uniform vec3 uSeed;
uniform int uStyle;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uVeg;
uniform vec3 uSnow;
uniform vec3 uSand;
uniform vec3 uSeabed;
uniform float uVegAmount;
uniform float uHasSea;
uniform float uRelief;
uniform float uLut[17];
uniform float uLocked;
uniform float uIceTemp;
uniform float uLapse;
uniform int uEmissiveKind;
uniform float uAo;

out vec4 fragColor;

float lutAt(float x) {
  float f = clamp(x, 0.0, 1.0) * 16.0;
  int i = int(floor(f));
  int j = min(i + 1, 16);
  return mix(uLut[i], uLut[j], f - float(i));
}

/** LUT coordinate: |latitude| / 90 degrees, or the substellar angle / 180 degrees on locked worlds. */
float lutCoord(vec3 p) {
  return uLocked > 0.5
    ? acos(clamp(p.x, -1.0, 1.0)) / 3.14159265
    : asin(clamp(abs(p.y), 0.0, 1.0)) / 1.57079633;
}

/** Night-side city lights 0..1: coastal lowlands with a comfortable climate, in regional clusters. */
float cityLights(vec3 p, float h, float Tk, float ice, float slope) {
  float coast = exp(-max(h, 0.0) / 0.10);
  float lowland = 1.0 - smoothstep(0.3, 0.7, h);
  float climate = smoothstep(272.0, 285.0, Tk) * (1.0 - smoothstep(308.0, 322.0, Tk));
  float region = 0.5 + 0.5 * fbm(p * 5.0 + uSeed * 2.3, 4);
  float dots = 1.0 - smoothstep(0.0, 0.34, worley(p * 46.0 + uSeed, 1.0).x);
  float dens = (0.25 + 0.75 * coast) * lowland * climate * (1.0 - ice) * (1.0 - smoothstep(0.1, 0.3, slope));
  float lights = dens * (0.16 * smoothstep(0.3, 0.8, region) + 0.95 * smoothstep(0.5, 0.9, region) * dots);
  return clamp(lights, 0.0, 1.0);
}

void main() {
  vec2 uv = bakeUv();
  vec3 p = normalize(cubeDir(uFace, uv));
  vec4 t = texture(uHeightTex, p);
  float h = t.r;
  float moist = t.g;
  float spec = t.b;
  float aux = t.a;
  vec3 g = heightGradient(uv, 2.0 / uSize);
  float slope = length(g) * uRelief;

  float geo = 0.5 + 0.5 * fbm(p * 3.0 + uSeed * 1.3, 4);
  float fine = fbm(p * 24.0 + uSeed * 0.7, 3);
  float Tk = lutAt(lutCoord(p)) + 3.0 * fbm(p * 6.0 + uSeed, 3) - uLapse * clamp(h, 0.0, 1.5);
  bool isSea = uHasSea > 0.5 && h < 0.0;

  vec3 col = uC0;
  float ice = 0.0;

  if (uStyle == 0) {
    // ---- biomes: temperature x moisture, rock on slopes/altitude, beaches, tundra, snow
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float alat = abs(lat);
    float lw = uLocked > 0.5 ? 0.0 : 1.0;
    float wet = 0.26 * exp(-alat * alat / 0.10)
              + 0.14 * exp(-(alat - 0.85) * (alat - 0.85) / 0.06)
              - 0.26 * exp(-(alat - 0.46) * (alat - 0.46) / 0.035);
    float M = clamp(moist + lw * wet + 0.22 * (1.0 - smoothstep(0.0, 0.3, h)) + 0.08, 0.0, 1.0);
    vec3 soil = mix(uC0, uC1, smoothstep(0.25, 0.75, geo));
    float dry = 1.0 - smoothstep(0.2, 0.48, M);
    vec3 ground = mix(soil, uSand, dry * 0.8);
    vec3 rock = mix(uC2, uC3, geo);
    float rockW = clamp(smoothstep(0.12, 0.3, slope) + 0.8 * smoothstep(0.55, 0.95, h), 0.0, 1.0);
    float vegT = smoothstep(268.0, 286.0, Tk) * (1.0 - smoothstep(318.0, 336.0, Tk));
    float veg = vegT * smoothstep(0.14, 0.4, M) * (1.0 - rockW) * uVegAmount;
    vec3 vegCol = mix(uVeg * 1.55 + vec3(0.035, 0.028, 0.0), uVeg * 0.75, smoothstep(0.45, 0.85, M));
    vegCol *= 0.85 + 0.3 * fine;
    vec3 c = mix(ground, vegCol, veg);
    float tundra = smoothstep(252.0, 266.0, Tk) * (1.0 - vegT) * uVegAmount;
    c = mix(c, mix(uC0, uVeg * 1.3, 0.35), tundra * 0.65);
    c = mix(c, rock, rockW);
    float beach = (1.0 - smoothstep(0.0, 0.03, h)) * (h >= 0.0 ? 1.0 : 0.0) * (1.0 - veg * 0.6);
    c = mix(c, uSand * 1.35, beach * 0.85);
    float iceT = 1.0 - smoothstep(uIceTemp - 3.0, uIceTemp + 3.0, Tk + 2.0 * fine);
    ice = iceT * (1.0 - 0.7 * smoothstep(0.18, 0.45, slope));
    c = mix(c, uSnow, ice);
    col = c;
    if (isSea) {
      float si = 1.0 - smoothstep(uIceTemp + 1.0, uIceTemp + 6.0, Tk + 2.0 * fine);
      ice = si;
      col = mix(uSeabed, uSnow, si);
    }
  } else if (uStyle == 1) {
    // ---- regolith (Moon, Mercury): bright highlands, dark mare, fresh bright ejecta
    vec3 hi = mix(uC0, uC2, smoothstep(-0.1, 0.7, geo - 0.15 + 0.3 * h));
    col = mix(hi, uC1, spec);
    col *= 0.86 + 0.28 * fine;
    col = mix(col, uC2 * 1.3, clamp(aux, 0.0, 1.0) * 0.8);
    col *= 1.0 + 0.3 * smoothstep(0.15, 0.5, slope);
  } else if (uStyle == 2) {
    // ---- dust worlds (Mars, Venus): bright dust over dark basalt, exposed rock on slopes
    float region = 0.5 + 0.5 * fbm(p * 1.7 + uSeed * 0.5 + 0.3 * fbm(p * 4.0 + uSeed, 2), 3);
    float dust = smoothstep(0.3, 0.7, geo + 0.25 * (moist - 0.5));
    col = mix(uC0, uC1, dust);
    float dark = smoothstep(0.42, 0.62, 1.0 - region + 0.25 * (fine + 0.3 * h));
    col = mix(col, uC2, dark * 0.85);
    col = mix(col, uC2 * 0.8, smoothstep(0.12, 0.3, slope) * 0.6);
    col *= 0.9 + 0.2 * fine;
    col = mix(col, uC1 * 1.15, aux * 0.3);
  } else if (uStyle == 3) {
    // ---- ice shells (Europa, Enceladus): bright ice, brown lineae and chaos, bright fresh craters
    col = mix(uC0, uC1, smoothstep(0.3, 0.7, geo));
    col = mix(col, uC2, clamp(spec * 0.95, 0.0, 1.0));
    col *= 0.92 + 0.16 * fine;
    col = mix(col, vec3(max(uC0.r, 0.6)), clamp(aux, 0.0, 1.0) * 0.5);
  } else if (uStyle == 4) {
    // ---- volcanic (Io, lava worlds): patchy sulphur/basalt with dark paterae
    col = mix(uC0, uC1, smoothstep(0.3, 0.7, geo));
    col = mix(col, uC2, smoothstep(0.55, 0.8, 0.5 + 0.5 * fbm(p * 5.0 + uSeed * 0.9, 3)) * 0.85);
    col = mix(col, uC3, clamp(aux * 1.2, 0.0, 1.0));
    col *= 0.85 + 0.3 * fine;
  } else {
    // ---- dwarf planets (Pluto): bright plains in the lowlands, dark tholin belt near the equator
    float plains = smoothstep(0.15, -0.25, h);
    col = mix(uC0, uC1, plains);
    float belt = 1.0 - smoothstep(0.1, 0.6, abs(p.y) - 0.1 + 0.3 * fbm(p * 2.5 + uSeed, 3));
    col = mix(col, uC2, belt * (1.0 - plains * 0.7) * smoothstep(0.35, 0.65, geo) * 0.8);
    col *= 0.9 + 0.2 * fine;
    col = mix(col, uC1 * 1.2, clamp(aux, 0.0, 1.0) * 0.5);
  }

  // Frost on the non-biome styles (polar caps, cold traps): the same ice-line temperature.
  if (uStyle != 0 && uIceTemp > 0.0) {
    float f = 1.0 - smoothstep(uIceTemp - 3.0, uIceTemp + 3.0, Tk + 2.0 * fine);
    f *= 1.0 - 0.7 * smoothstep(0.15, 0.4, slope);
    col = mix(col, uSnow, f);
    ice = max(ice, f);
  }
  if (isSea && uStyle != 0) col = uSeabed;

  // ---- emissive: magma seas and glowing cracks, or city lights
  float emis = 0.0;
  if (uEmissiveKind == 2) {
    float seaEmis = 0.0;
    if (isSea) {
      vec2 wv = worley(p * 16.0 + uSeed, 1.0);
      float crackLine = 1.0 - smoothstep(0.0, 0.1, wv.y - wv.x);
      seaEmis = mix(0.18, 1.0, crackLine);
      col = uC0 * 0.45;
    }
    emis = max(seaEmis, spec * 0.95);
  } else if (uEmissiveKind == 1) {
    emis = isSea ? 0.0 : cityLights(p, h, Tk, ice, slope);
  }
  emis *= 1.0 - ice;

  // ---- baked cavity occlusion: bowls darker, crests lighter
  if (!isSea) col *= clamp(1.0 - uAo * cavity(uv, h), 0.5, 1.3);

  fragColor = vec4(col, 0.5 + 0.5 * emis - 0.5 * ice);
}
`;
