/**
 * GLSL for the resolved star: an analytic photosphere sphere, the corona/chromosphere/prominence
 * billboard, and the point-source sprite shared with the starfield (see starfield/photometry.ts).
 *
 * Conventions (docs/ARCHITECTURE.md section 5): scene-linear HDR, no tone mapping, additive light.
 * Every mesh is a camera-facing quad expanded around the star centre; none uses vertex positions
 * in world space, so nothing loses precision at 1e10 km.
 */
import { spriteGlsl } from '../starfield/photometry';
import { common } from '../shaders/common.glsl';
import { noise } from '../shaders/noise.glsl';

// ───────────────────────────────────────────────────────────────────── photosphere disc

export const discVertex = /* glsl */ `
uniform float uQuadKm;       // half size of the quad in km (silhouette + margin, before stretch)
out vec3 vViewPos;
flat out vec3 vCentre;

void main() {
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // A sphere off the view axis projects to an ellipse stretched by 1 / cos^2(theta) on the plane
  // through its centre: grow the quad so the silhouette always fits.
  float ct = max(-c.z / length(c.xyz), 0.2);
  vec3 vp = c.xyz + vec3(position.xy * uQuadKm / (ct * ct), 0.0);
  vViewPos = vp;
  vCentre = c.xyz;
  gl_Position = projectionMatrix * vec4(vp, 1.0);
}
`;

export const discFragment = /* glsl */ `
${common}
${noise}

uniform float uRadius;       // km
uniform float uPxKm;         // km per device pixel at the star's distance
uniform float uDiscPx;       // disc radius in device pixels (level of detail)
uniform vec3 uColor;         // saturated blackbody chromaticity, linear
uniform float uTeff;         // effective temperature, K
uniform float uBrightness;   // disc-averaged radiance (HDR)
uniform float uIntensity;    // 0..1 fade
uniform float uTime;
uniform mat3 uBodyFromView;  // view space -> body-fixed axes (spin applied)
uniform vec3 uSeed3;
uniform float uConvection;   // granulation contrast 0..1.3
uniform float uGranScale;    // convection cells per stellar radius
uniform float uActivity;     // starspots / faculae 0..1
uniform float uSpotAnywhere; // 0: spots confined to a sunspot belt, 1: anywhere (fast rotators, M dwarfs)
uniform float uLimbSoft;     // fuzzy limb of extended atmospheres 0..0.5
uniform vec4 uFlare;         // xyz body-fixed direction, w envelope
uniform float uQuality;      // 0 low .. 3 ultra
uniform float uSaturation;   // extra chroma applied to the shaded disc
uniform mat4 projectionMatrix; // (three declares it for the vertex stage only)

in vec3 vViewPos;
flat in vec3 vCentre;
out vec4 fragColor;

// Planck ratio B_lambda(T) / B_lambda(Tref) at the effective wavelengths of linear R, G, B (micrometres).
// Working in temperature keeps limb reddening, dark spots and hot granule cores mutually consistent.
vec3 planckRatio(float T, float Tref) {
  const vec3 lam = vec3(0.600, 0.545, 0.465);
  vec3 x = 14387.77 / (lam * T);
  vec3 xr = 14387.77 / (lam * Tref);
  return (exp(xr) - 1.0) / (exp(x) - 1.0);
}

// Animated Worley cells: (F1, F2, cell hash). Feature points orbit inside their cells, so granules
// boil in place instead of sliding along the surface.
vec3 granules(vec3 p, float t) {
  vec3 ip = floor(p);
  vec3 fp = p - ip;
  float f1 = 9.0;
  float f2 = 9.0;
  vec3 best = ip;
  for (int k = 0; k < 27; k++) {
    vec3 o = vec3(float(k % 3) - 1.0, float((k / 3) % 3) - 1.0, float(k / 9) - 1.0);
    vec3 h = hash33(ip + o);
    vec3 pt = o + 0.5 + 0.36 * sin(t * (0.30 + 0.45 * h.zxy) + 6.2831853 * h);
    vec3 d = pt - fp;
    float dd = dot(d, d);
    if (dd < f1) {
      f2 = f1;
      f1 = dd;
      best = ip + o;
    } else if (dd < f2) {
      f2 = dd;
    }
  }
  return vec3(sqrt(f1), sqrt(f2), hash13(best));
}

void main() {
  vec3 rd = normalize(vViewPos);
  vec3 f = -vCentre;
  float b = dot(f, rd);
  vec3 perp = f - b * rd;
  float d2 = dot(perp, perp);
  // Analytic coverage: exact anti-aliasing of the silhouette down to sub-pixel discs.
  float cover = clamp((uRadius - sqrt(d2)) / uPxKm + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  float h = sqrt(max(uRadius * uRadius - d2, 0.0));
  vec3 hit = rd * (-b - h);
  vec3 n = (hit - vCentre) / uRadius;
  float mu = clamp(dot(n, -rd), 0.0, 1.0);
  vec3 pb = uBodyFromView * n;

  // Limb darkening from the Eddington grey atmosphere: T^4 = 3/4 Teff^4 (tau + 2/3) with tau = mu.
  float tLimb = uTeff * pow(0.75 * (mu + 0.6667), 0.36);
  float dT = 0.0;

  // Convection: granules (Worley cells with dark lanes) on a domain-warped surface so the cells are
  // irregular; a second, finer octave appears as the coarse cells grow large on screen; plus fine
  // turbulence and the larger supergranular mottling.
  if (uConvection > 0.0) {
    float cellPx = uDiscPx / uGranScale;
    float lod = smoothstep(1.5, 5.0, cellPx);
    float towardLimb = 0.35 + 0.65 * mu;
    vec3 pw = pb * uGranScale + uSeed3;
    if (lod > 0.0) {
      vec3 warp = vec3(snoise(pw * 0.5 + 3.1), snoise(pw * 0.5 + 7.7), snoise(pw * 0.5 + 11.3));
      vec3 g = granules(pw + 0.55 * warp, uTime);
      float lw = 0.11 + 0.06 * snoise(pw * 0.9 + 21.0);          // lane width varies
      float lane = smoothstep(0.0, lw, g.y - g.x);
      float depth = 0.8 + 0.45 * snoise(pw * 1.1 + 5.0);         // ...and so does its depth
      float dome = 1.0 - smoothstep(0.0, 0.6, g.x);
      float boil = sin(uTime * 0.31 + 6.2831853 * g.z);
      float dg = -0.075 * (1.0 - lane) * depth + 0.060 * (dome - 0.35) + 0.035 * (g.z - 0.5) + 0.018 * boil * dome;
      dT += uConvection * lod * towardLimb * dg;
      // Finer octave: only worth its cost once the coarse cells are big enough to want detail.
      float lod2 = uQuality > 0.5 ? smoothstep(14.0, 40.0, cellPx) : 0.0;
      if (lod2 > 0.0) {
        vec3 g2 = granules(pw * 3.3 + 17.0 + 0.6 * warp, uTime * 1.3);
        float lane2 = smoothstep(0.0, lw, g2.y - g2.x);
        float dome2 = 1.0 - smoothstep(0.0, 0.6, g2.x);
        dT += uConvection * lod2 * towardLimb * (-0.04 * (1.0 - lane2) * depth + 0.03 * (dome2 - 0.35) + 0.02 * (g2.z - 0.5));
      }
      if (uQuality > 1.5) {
        float fine = snoise(vec4(pw * 2.7, uTime * 0.05)) + 0.5 * snoise(vec4(pw * 5.6, uTime * 0.08));
        dT += uConvection * smoothstep(3.0, 9.0, cellPx) * towardLimb * 0.011 * fine;
      }
    }
    float lodS = smoothstep(1.5, 5.0, uDiscPx / (uGranScale * 0.2));
    float sg = snoise(vec4(pb * (uGranScale * 0.2) + uSeed3, uTime * 0.02));
    dT += uConvection * lodS * 0.016 * sg;
  }

  // Starspots (umbra, penumbra) and faculae. Cooler = darker AND redder through the Planck ratio.
  if (uActivity > 0.02) {
    float lat = abs(pb.y);
    float belt = mix(smoothstep(0.66, 0.30, lat), 1.0, uSpotAnywhere);
    float field = (snoise(vec4(pb * 1.8 + uSeed3 * 1.7, uTime * 0.0035)) + 0.22 * snoise(vec3(pb * 5.3 + uSeed3))) * belt;
    float e = field - (0.78 - 0.55 * uActivity);
    if (e > -0.30) {
      float umbra = smoothstep(0.05, 0.16, e);
      float pen = smoothstep(0.0, 0.06, e);
      if (uQuality > 0.5 && pen > 0.0) {
        pen *= 0.8 + 0.3 * snoise(vec3(pb * 30.0 + uSeed3));
      }
      float fac = smoothstep(-0.30, -0.02, e) * (1.0 - smoothstep(0.0, 0.08, e));
      dT += -0.085 * pen - 0.13 * umbra + 0.045 * fac * pow(1.0 - mu, 1.3) * uActivity;
    }
  }

  vec3 rgb = uColor * uBrightness * planckRatio(tLimb * (1.0 + dT), uTeff);
  // ACES desaturates anything bright; richer chroma keeps a resolved sun warm rather than white.
  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = max(mix(vec3(lum), rgb, uSaturation), 0.0);

  // Flare: a compact white-blue kernel on the surface.
  if (uFlare.w > 0.001) {
    float cs = dot(normalize(pb), uFlare.xyz);
    float k = smoothstep(0.975, 0.999, cs) * uFlare.w;
    rgb += vec3(0.9, 0.95, 1.0) * (k * uBrightness * 1.2);
  }

  cover *= uLimbSoft > 0.0 ? smoothstep(0.0, uLimbSoft, mu) : 1.0;
  float a = cover * uIntensity;
  fragColor = vec4(rgb * a, a);

  // Write the sphere's true depth so planets pass in front of / behind the star correctly; the
  // anti-aliased rim (cover < 0.5) writes far so it cannot occlude the glow drawn around it.
  vec4 clip = projectionMatrix * vec4(hit, 1.0);
  gl_FragDepth = cover > 0.5 ? clamp(0.5 * clip.z / clip.w + 0.5, 0.0, 1.0) : 1.0;
}
`;

// ───────────────────────────────────────────────────────────────────── corona billboard

export const coronaVertex = /* glsl */ `
uniform float uExtent;       // half size in stellar radii
uniform float uRadius;       // km
out vec2 vUv;

void main() {
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vUv = position.xy * uExtent;
  gl_Position = projectionMatrix * (c + vec4(position.xy * uExtent * uRadius, 0.0, 0.0));
}
`;

export const coronaFragment = /* glsl */ `
${common}
${noise}

uniform vec3 uColor;         // star chromaticity, linear
uniform vec3 uHotColor;      // prominence / chromosphere colour
uniform float uBrightness;   // disc radiance
uniform float uIntensity;
uniform float uTime;
uniform float uSeed;
uniform float uPxPerR;       // device px per stellar radius (level of detail)
uniform vec2 uEquator;       // projected equator direction on screen (unit)
uniform float uGain;         // corona radiance at the limb, relative to uBrightness
uniform float uFall;         // radial falloff exponent
uniform float uHaloGain;     // wide glow (giants, hot stars)
uniform float uStreamer;     // 0 smooth .. 1 strongly streamed
uniform float uChromo;       // chromosphere ring strength
uniform float uProm;         // prominence activity 0..1
uniform float uFlareBoost;   // flare envelope 0..1 (brightens loops)
uniform float uCoronaVis;    // 0..1 fade while the disc is only a few pixels wide

in vec2 vUv;
out vec4 fragColor;

float wrapAngle(float a) {
  return a - TAU * floor((a + PI) / TAU);
}

void main() {
  float r = length(vUv);
  if (r < 0.985 || uCoronaVis <= 0.0) discard;
  vec2 dir = vUv / r;
  float phi = atan(vUv.y, vUv.x);
  float x = max(r, 1.0);

  // K-corona: bright, steep near the limb, shallower far out; streamers on top.
  float fall = pow(1.0 / x, uFall);
  float sn = snoise(vec4(dir * 2.7 + uSeed, x * 0.11, uSeed * 0.5 + uTime * 0.012));
  float belt = pow(abs(dot(dir, uEquator)), 1.6);
  float st = clamp(0.5 + 0.6 * sn + 0.3 * belt - 0.12, 0.0, 1.0);
  float streamers = mix(1.0, 0.08 + 3.4 * st * st * st, uStreamer);
  float corona = uGain * fall * streamers;
  corona += uHaloGain * pow(1.0 / x, 2.4);

  vec3 tint = mix(uColor, vec3(1.0), 0.55);
  vec3 rgb = tint * (uBrightness * corona);

  // Thin chromosphere rim with spicule-like flicker along the limb.
  float px = uPxPerR;
  if (uChromo > 0.0 && px > 30.0) {
    float rim = exp(-pow((r - 1.004) / 0.012, 2.0));
    float spic = 0.65 + 0.55 * snoise(vec3(dir * 26.0, uTime * 0.25 + uSeed));
    rgb += uHotColor * (uBrightness * 0.55 * uChromo * rim * spic * smoothstep(30.0, 90.0, px));
  }

  // Prominences: glowing arches anchored on the limb, each with its own life cycle.
  if (uProm > 0.02 && r < 1.9) {
    float acc = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float period = 34.0 + 26.0 * hash11(fi * 3.17 + uSeed);
      float ti = uTime / period + hash11(fi * 7.31 + uSeed * 1.3);
      float cyc = floor(ti);
      float u = ti - cyc;
      float seed = fi * 11.7 + cyc * 5.93 + uSeed;
      float ang = TAU * hash11(seed);
      float span = 0.05 + 0.10 * hash11(seed + 1.7);
      float height = (0.14 + 0.42 * hash11(seed + 3.1)) * (0.5 + 0.7 * uProm);
      float env = smoothstep(0.0, 0.2, u) * (1.0 - smoothstep(0.5, 1.0, u));
      float hgt = height * (0.3 + 0.7 * smoothstep(0.0, 0.55, u));
      float a = abs(wrapAngle(phi - ang)) / span;
      if (a < 1.0) {
        float c = cos(a * 1.5707963);
        float rArch = 1.0 + hgt * pow(c, 0.7);
        float thick = 0.010 + 0.022 * hgt;
        float dr = r - rArch;
        float line = exp(-dr * dr / (thick * thick));
        float haze = (dr < 0.0 && r > 1.0) ? 0.16 * smoothstep(0.0, 0.5, c) * exp(dr / (0.5 * hgt + 0.01)) : 0.0;
        float thread = 0.7 + 0.3 * sin(phi * 240.0 + fi * 3.0 + uTime * 0.7);
        acc += env * (line * thread + haze) * (0.6 + 0.8 * hash11(seed + 5.3));
      }
    }
    float lodP = smoothstep(20.0, 60.0, px);
    rgb += uHotColor * (uBrightness * 0.9 * (0.3 + 0.7 * uProm) * (1.0 + 1.5 * uFlareBoost) * acc * lodP);
  }

  // Flares light the whole limb region a little.
  rgb *= 1.0 + 0.6 * uFlareBoost * exp(-(x - 1.0) * 1.2);

  float fade = uIntensity * uCoronaVis;
  fragColor = vec4(rgb * fade, 1.0);
}
`;

// ───────────────────────────────────────────────────────────────────── point-source sprite

export const spriteVertex = /* glsl */ `
uniform vec2 uViewport;      // device px
uniform float uPixelRatio;
uniform float uExtentPx;     // CSS px
out vec2 vP;

void main() {
  vec4 c = projectionMatrix * (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0));
  vec2 offPx = position.xy * uExtentPx;
  vP = offPx;
  if (c.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = c;
  gl_Position.xy += offPx * uPixelRatio * 2.0 / uViewport * c.w;
}
`;

export const spriteFragment = /* glsl */ `
${spriteGlsl}
uniform vec3 uColor;
uniform float uPeak;
uniform float uSigma;
uniform float uHaloR;
uniform float uHaloGain;
uniform float uSpikeLen;
uniform float uSpikeGain;
uniform float uExtent;
uniform float uFade;         // 0..1: sprite weight (fades while the disc resolves) times fade-in
in vec2 vP;
out vec4 fragColor;

void main() {
  float v = starPsf(vP, uSigma, uHaloR, uHaloGain, uSpikeLen, uSpikeGain, uExtent);
  fragColor = vec4(uColor * (uPeak * v * uFade), 1.0);
}
`;
