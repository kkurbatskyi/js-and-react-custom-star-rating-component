/**
 * GLSL chunk verification — compiles every chunk in src/render/shaders in a real WebGL2 context and
 * checks the maths numerically on the GPU (float render targets read back on the CPU).
 *
 * 1. Raw WebGL2: each chunk alone and all together, with every function called (so nothing is
 *    dead-code eliminated), plus compile+link time.
 * 2. three.js ShaderMaterial with `#include <common>` before the chunks.
 * 3. Two postprocessing Effects using the same chunks merged into ONE EffectPass (function renaming).
 * 4. Numerics: noise ranges, analytic vs finite-difference gradients, hash uniformity, blackbody
 *    chromaticity vs CIE illuminant A, sRGB round trip, ray–sphere precision, rotations.
 *
 * Results render as a table and are exposed on `window.__SHADER_TESTS__`; `window.__READY__` is set
 * when done. `node scripts/shot.mjs http://127.0.0.1:<port>/dev/shaders.html out.png
 *   --eval="window.__SHADER_TESTS__.summary"`
 */
import { Effect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import * as THREE from 'three';
import { blackbodyRGBExact } from '../src/core/color';
import { color } from '../src/render/shaders/color.glsl';
import { common } from '../src/render/shaders/common.glsl';
import { hash, noise, simplex } from '../src/render/shaders/noise.glsl';

interface TestResult {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}

declare global {
  interface Window {
    __READY__?: boolean;
    __SHADER_TESTS__?: { summary: string; passed: number; failed: number; results: TestResult[] };
  }
}

const results: TestResult[] = [];
const record = (group: string, name: string, ok: boolean, detail: string): void => {
  results.push({ group, name, ok, detail });
};

// ── probes: statements that call every function of a chunk, accumulating into `acc` ─────────────
const PROBES = {
  common: /* glsl */ `
    acc.x += remap(0.5, 0.0, 1.0, 2.0, 4.0) + remapClamped(2.0, 0.0, 1.0, 0.0, 1.0);
    acc.x += linstep(0.0, 1.0, 0.5) + smootherstep(0.0, 1.0, 0.5) + PI + TAU + saturate(2.0);
    acc.y += luminance709(vec3(1.0)) + length(safeNormalize(vec3(1.0, 2.0, 3.0)));
    vec2 hit = raySphere(vec3(0.0, 0.0, -5.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 1.0);
    acc.z += hit.x + hit.y + (rotate2d(0.3) * vec2(1.0, 0.0)).x;
    acc.w += (rotateX(0.1) * rotateY(0.2) * rotateZ(0.3) * rotateAxis(vec3(0.0, 1.0, 0.0), 0.4) * vec3(1.0)).x;
    acc.w += quatRotate(vec4(0.0, 0.0, 0.0, 1.0), vec3(1.0)).x;`,
  color: /* glsl */ `
    acc.rgb += srgbToLinear(vec3(0.5)) + linearToSrgb(vec3(0.2)) + blackbody(5800.0);
    acc.rgb += blackbodyUnitLuminance(3000.0) + adjustSaturation(vec3(0.5, 0.4, 0.3), 1.25);
    acc.xy += planckianLocusXy(6500.0);`,
  hash: /* glsl */ `
    acc.x += uintToUnit(pcg(7u)) + hash11(0.5) + hash12(vec2(0.5)) + hash13(vec3(0.5)) + hash14(vec4(0.5));
    acc.xy += hash22(vec2(0.3)) + uintToUnit(pcg2d(uvec2(1u, 2u)));
    acc.xyz += hash33(vec3(0.3)) + uintToUnit(pcg3d(uvec3(1u, 2u, 3u)));
    acc += hash44(vec4(0.3)) + uintToUnit(pcg4d(uvec4(1u, 2u, 3u, 4u)));`,
  simplex: /* glsl */ `
    acc.x += snoise(vec3(0.3, 1.7, 2.9)) + snoise(vec4(0.3, 1.7, 2.9, 4.1));
    acc += snoiseGrad(vec3(0.3, 1.7, 2.9));`,
  fractal: /* glsl */ `
    acc.x += fbm(vec3(0.3), 4) + fbm(vec3(0.3), 5, 2.1, 0.45);
    acc.y += ridged(vec3(0.3), 5) + ridged(vec3(0.3), 5, 2.0, 1.0, 1.0, 2.0);
    acc += fbmGrad(vec3(0.3), 4) + fbmGrad(vec3(0.3), 4, 2.0, 0.5);
    acc.xy += worley(vec3(0.3), 1.0);
    acc.xyz += domainWarp(vec3(0.3), 0.5, 3);`,
};

const CASES: { name: string; source: string; probes: string }[] = [
  { name: 'common', source: common, probes: PROBES.common },
  { name: 'color', source: color, probes: PROBES.color },
  { name: 'hash', source: hash, probes: PROBES.hash },
  { name: 'simplex', source: simplex, probes: PROBES.hash + PROBES.simplex },
  { name: 'noise', source: noise, probes: PROBES.hash + PROBES.simplex + PROBES.fractal },
  {
    name: 'common + color + noise',
    source: common + color + noise,
    probes: Object.values(PROBES).join('\n'),
  },
];

// ── 1. raw WebGL2 compile ────────────────────────────────────────────────────────────────────────
function rawCompile(): void {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) {
    record('raw WebGL2', 'context', false, 'WebGL2 unavailable');
    return;
  }
  const vs = gl.createShader(gl.VERTEX_SHADER);
  if (!vs) return;
  gl.shaderSource(vs, '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }');
  gl.compileShader(vs);

  for (const { name, source, probes } of CASES) {
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!fs || !program) continue;
    const src = `#version 300 es
precision highp float;
precision highp int;
${source}
out vec4 fragColor;
void main() {
  vec4 acc = vec4(0.0);
  ${probes}
  fragColor = acc;
}`;
    const t0 = performance.now();
    gl.shaderSource(fs, src);
    gl.compileShader(fs);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    const compiled = gl.getShaderParameter(fs, gl.COMPILE_STATUS) === true;
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
    const ms = performance.now() - t0;
    const log = (gl.getShaderInfoLog(fs) ?? '') + (gl.getProgramInfoLog(program) ?? '');
    record(
      'raw WebGL2',
      name,
      compiled && linked,
      compiled && linked
        ? `compiled + linked in ${ms.toFixed(0)} ms, ${src.split('\n').length} lines`
        : log.trim().slice(0, 600),
    );
    gl.deleteProgram(program);
    gl.deleteShader(fs);
  }
  gl.deleteShader(vs);
}

// ── shared three.js scaffolding ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(64, 64, false);
let shaderError = '';
renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
  shaderError = [
    gl.getShaderInfoLog(fragmentShader),
    gl.getShaderInfoLog(vertexShader),
    gl.getProgramInfoLog(program),
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
};

const fullscreen = new THREE.BufferGeometry();
fullscreen.setAttribute(
  'position',
  new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
);
const orthoCamera = new THREE.Camera();
const SIZE = 256;
const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
  type: THREE.FloatType,
  depthBuffer: false,
});
const pixels = new Float32Array(SIZE * SIZE * 4);

/**
 * Evaluate `vec4 test(vec2 cell)` (cell = integer pixel, 0..SIZE-1) for every pixel of a SIZE²
 * float target with all chunks in scope; returns RGBA floats, or null on a shader error.
 */
function evaluate(body: string, prelude = '#include <common>'): Float32Array | null {
  shaderError = '';
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `${prelude}
${common}
${color}
${noise}
out vec4 fragColor;
vec4 test(vec2 cell) {
${body}
}
void main() { fragColor = test(floor(gl_FragCoord.xy)); }`,
  });
  const mesh = new THREE.Mesh(fullscreen, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene().add(mesh);
  renderer.setRenderTarget(target);
  renderer.render(scene, orthoCamera);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
  renderer.setRenderTarget(null);
  material.dispose();
  return shaderError ? null : pixels;
}

interface Stats {
  min: number;
  max: number;
  mean: number;
  std: number;
}

function stats(data: Float32Array, channel: number): Stats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let sum2 = 0;
  const n = data.length / 4;
  for (let i = channel; i < data.length; i += 4) {
    const v = data[i] ?? 0;
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    sum2 += v * v;
  }
  const mean = sum / n;
  return { min, max, mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

const fmt = (s: Stats, digits = 3): string =>
  `min ${s.min.toFixed(digits)}  max ${s.max.toFixed(digits)}  mean ${s.mean.toFixed(digits)}  std ${s.std.toFixed(digits)}`;

// ── 2. three.js compat ───────────────────────────────────────────────────────────────────────────
function threeCompat(): void {
  const probe = `vec4 acc = vec4(0.0);\n${Object.values(PROBES).join('\n')}\nreturn acc;`;
  const withCommon = evaluate(probe, '#include <common>');
  record(
    'three.js',
    'ShaderMaterial, #include <common> first',
    withCommon !== null,
    withCommon ? 'compiled' : shaderError.slice(0, 600),
  );
  const bare = evaluate(probe, '');
  record(
    'three.js',
    'ShaderMaterial, chunks only',
    bare !== null,
    bare ? 'compiled' : shaderError.slice(0, 600),
  );
}

// ── 3. postprocessing: two effects sharing chunks, merged into one pass ──────────────────────────
function postprocessingCompat(): void {
  shaderError = '';
  const chunkEffect = (name: string, body: string): Effect =>
    new Effect(
      name,
      `${common}\n${color}\n${noise}\nvoid mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {\n${body}\n}`,
    );
  const a = chunkEffect(
    'ChunkA',
    'outputColor = vec4(blackbody(5000.0) * (0.5 + 0.5 * snoise(vec3(uv * 8.0, 1.0))), 1.0);',
  );
  const b = chunkEffect(
    'ChunkB',
    'outputColor = vec4(inputColor.rgb * (0.5 + 0.5 * fbm(vec3(uv * 4.0, 2.0), 4)) + luminance709(inputColor.rgb) * remap(uv.x, 0.0, 1.0, 0.0, 0.1), 1.0);',
  );
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(new THREE.Scene(), orthoCamera));
  const pass = new EffectPass(undefined, a, b);
  composer.addPass(pass);
  composer.render(0);
  record(
    'postprocessing',
    'two chunk-using effects merged in one EffectPass',
    shaderError === '',
    shaderError === '' ? 'compiled (functions renamed per effect)' : shaderError.slice(0, 600),
  );
  composer.dispose();
}

// ── 4. numerics ──────────────────────────────────────────────────────────────────────────────────
function numerics(): void {
  const G = 'numerics';
  const run = (name: string, body: string, check: (d: Float32Array) => [boolean, string]): void => {
    const data = evaluate(body);
    if (!data) {
      record(G, name, false, shaderError.slice(0, 600));
      return;
    }
    const [ok, detail] = check(data);
    record(G, name, ok, detail);
  };

  run(
    'snoise(vec3) range',
    'return vec4(snoise(vec3(cell * 0.137, 3.7)), snoise(vec3(cell.yx * 0.071 + 11.0, -5.2)), 0.0, 0.0);',
    (d) => {
      const s = stats(d, 0);
      const t = stats(d, 1);
      const ok =
        s.max > 0.6 &&
        s.max < 1.05 &&
        s.min < -0.6 &&
        s.min > -1.05 &&
        Math.abs(s.mean) < 0.03 &&
        Math.abs(t.mean) < 0.03;
      return [ok, fmt(s)];
    },
  );

  run(
    'snoise(vec4) range',
    // A skewed plane through 4D samples more independent features than an axis-aligned slice.
    'return vec4(snoise(vec4(cell * 0.113, cell.x * 0.047 + 1.3, cell.y * 0.053 + 2.7)), 0.0, 0.0, 0.0);',
    (d) => {
      const s = stats(d, 0);
      return [
        s.max > 0.6 && s.max < 1.05 && s.min < -0.6 && s.min > -1.05 && Math.abs(s.mean) < 0.03,
        fmt(s),
      ];
    },
  );

  // Analytic gradient vs central differences. Relative error normalised by the gradient scale.
  const gradCheck = (fn: string, value: string): string => `
    vec3 p = vec3(cell * 0.0417, 0.73) + vec3(0.0, 0.0, cell.x * 0.0011);
    vec4 g = ${fn};
    float h = 1e-3;
    vec3 fd = vec3(
      ${value.replaceAll('P', '(p + vec3(h, 0.0, 0.0))')} - ${value.replaceAll('P', '(p - vec3(h, 0.0, 0.0))')},
      ${value.replaceAll('P', '(p + vec3(0.0, h, 0.0))')} - ${value.replaceAll('P', '(p - vec3(0.0, h, 0.0))')},
      ${value.replaceAll('P', '(p + vec3(0.0, 0.0, h))')} - ${value.replaceAll('P', '(p - vec3(0.0, 0.0, h))')}
    ) / (2.0 * h);
    float v = ${value.replaceAll('P', 'p')};
    return vec4(abs(g.x - v), length(g.yzw - fd), length(g.yzw), 0.0);`;
  const gradResult = (d: Float32Array): [boolean, string] => {
    const valueErr = stats(d, 0);
    const gradErr = stats(d, 1);
    const gradLen = stats(d, 2);
    const rel = gradErr.mean / gradLen.mean;
    const ok = valueErr.max < 1e-4 && rel < 0.01 && gradErr.max < 0.1 * gradLen.max;
    return [
      ok,
      `value |Δ| max ${valueErr.max.toExponential(1)} · gradient error mean ${(rel * 100).toFixed(3)}% of mean |∇| (${gradLen.mean.toFixed(2)}), max ${gradErr.max.toFixed(3)}`,
    ];
  };
  run('snoiseGrad vs finite differences', gradCheck('snoiseGrad(p)', 'snoise(P)'), gradResult);
  run('fbmGrad vs finite differences', gradCheck('fbmGrad(p, 5)', 'fbm(P, 5)'), gradResult);

  run(
    'fbm / ridged ranges',
    'vec3 p = vec3(cell * 0.0213, 4.2); return vec4(fbm(p, 6), ridged(p, 6), fbm(p, 3, 2.3, 0.6), 0.0);',
    (d) => {
      const f = stats(d, 0);
      const r = stats(d, 1);
      const f2 = stats(d, 2);
      const ok =
        f.min >= -1 &&
        f.max <= 1 &&
        r.min >= 0 &&
        r.max <= 1.001 &&
        f2.min >= -1 &&
        f2.max <= 1 &&
        f.std > 0.1;
      return [ok, `fbm ${fmt(f, 2)} · ridged ${fmt(r, 2)}`];
    },
  );

  run(
    'worley F1 ≤ F2',
    'vec2 f = worley(vec3(cell * 0.043, 1.7), 1.0); return vec4(f, f.y - f.x, 0.0);',
    (d) => {
      const f1 = stats(d, 0);
      const f2 = stats(d, 1);
      const gap = stats(d, 2);
      const ok = f1.min >= 0 && f1.max < 1.3 && gap.min >= 0 && f2.max < 2.0 && f1.mean > 0.2;
      return [
        ok,
        `F1 ${fmt(f1, 2)} · F2 max ${f2.max.toFixed(2)} · min(F2-F1) ${gap.min.toFixed(4)}`,
      ];
    },
  );

  run(
    'hash uniformity',
    'vec4 h = hash44(vec4(cell, 7.0, 13.0)); return vec4(hash12(cell), h.x, h.y, uintToUnit(pcg(uint(cell.x) + 256u * uint(cell.y))));',
    (d) => {
      const parts: string[] = [];
      let ok = true;
      for (let c = 0; c < 4; c++) {
        const s = stats(d, c);
        // Uniform [0,1): mean 1/2, std 1/sqrt(12) = 0.2887. 65k samples: sigma(mean) ~ 0.0011.
        ok &&=
          Math.abs(s.mean - 0.5) < 0.006 &&
          Math.abs(s.std - 0.2887) < 0.005 &&
          s.min >= 0 &&
          s.max < 1;
        parts.push(`${s.mean.toFixed(4)}/${s.std.toFixed(4)}`);
      }
      // Channel independence (hash44 x vs y).
      let cov = 0;
      for (let i = 0; i < d.length; i += 4)
        cov += ((d[i + 1] ?? 0) - 0.5) * ((d[i + 2] ?? 0) - 0.5);
      const corr = cov / (d.length / 4) / (0.2887 * 0.2887);
      ok &&= Math.abs(corr) < 0.02;
      return [ok, `mean/std per channel ${parts.join(', ')} · corr(x,y) ${corr.toFixed(4)}`];
    },
  );

  run(
    'blackbody chromaticity (CIE illuminant A)',
    // Illuminant A is a Planckian radiator at 2856 K (with c2 = 1.435e-2): x = 0.44757, y = 0.40745.
    'return vec4(planckianLocusXy(2856.0), planckianLocusXy(6500.0));',
    (d) => {
      const ax = d[0] ?? 0;
      const ay = d[1] ?? 0;
      const ok = Math.abs(ax - 0.44757) < 2e-3 && Math.abs(ay - 0.40745) < 2e-3;
      return [
        ok,
        `2856 K → (${ax.toFixed(5)}, ${ay.toFixed(5)}) vs (0.44757, 0.40745) · 6500 K → (${(d[2] ?? 0).toFixed(4)}, ${(d[3] ?? 0).toFixed(4)})`,
      ];
    },
  );

  run(
    'blackbody normalisation & ordering',
    'float T = 1000.0 + cell.x * 160.0 + cell.y * 0.5; vec3 c = blackbody(T); return vec4(max(max(c.r, c.g), c.b), c.b / max(c.r, 1e-6), min(min(c.r, c.g), c.b), T);',
    (d) => {
      let ok = true;
      let prevRatio = -1;
      let prevT = -1;
      let monotone = true;
      for (let i = 0; i < SIZE; i++) {
        // row 0, increasing T along x
        const k = i * 4;
        ok &&= Math.abs((d[k] ?? 0) - 1) < 1e-4 && (d[k + 2] ?? -1) >= 0;
        const ratio = d[k + 1] ?? 0;
        const T = d[k + 3] ?? 0;
        if (T > prevT && ratio + 1e-5 < prevRatio) monotone = false;
        prevRatio = ratio;
        prevT = T;
      }
      const at6500 = evaluate('vec3 c = blackbody(6500.0); return vec4(c, 0.0);');
      const minCh = at6500 ? Math.min(at6500[0] ?? 0, at6500[1] ?? 0, at6500[2] ?? 0) : 0;
      ok &&= monotone && minCh > 0.9;
      return [
        ok,
        `max channel = 1 for 1000–41800 K · blue/red monotone: ${monotone} · 6500 K min channel ${minCh.toFixed(3)}`,
      ];
    },
  );

  // GPU fit vs the CPU reference (src/core/color.ts integrates Planck's law against the CIE CMFs):
  // stars coloured on the CPU (starfield) and on the GPU (close-ups) must match.
  run(
    'blackbody vs CPU reference (src/core/color.ts)',
    // 256 temperatures uniform in mireds, 25 (40000 K) … 1000 (1000 K).
    'float mired = 25.0 + cell.x * (975.0 / 255.0); return vec4(blackbody(1e6 / mired), 1e6 / mired);',
    (d) => {
      const bands = [
        { name: '1000–1667 K', lo: 1000, hi: 1667, max: 0 },
        { name: '1667–25000 K', lo: 1667, hi: 25000, max: 0 },
        { name: '25000–40000 K', lo: 25000, hi: 40001, max: 0 },
      ];
      for (let i = 0; i < SIZE; i++) {
        const k = i * 4; // row 0
        const T = d[k + 3] ?? 0;
        const ref = blackbodyRGBExact(T);
        const err = Math.max(
          Math.abs((d[k] ?? 0) - ref[0]),
          Math.abs((d[k + 1] ?? 0) - ref[1]),
          Math.abs((d[k + 2] ?? 0) - ref[2]),
        );
        const band = bands.find((b) => T >= b.lo && T < b.hi);
        if (band) band.max = Math.max(band.max, err);
      }
      const [low, mid, high] = bands as [(typeof bands)[0], (typeof bands)[0], (typeof bands)[0]];
      return [
        mid.max < 0.03 && high.max < 0.03 && low.max < 0.03,
        bands.map((b) => `${b.name}: max |Δrgb| ${b.max.toFixed(4)}`).join(' · '),
      ];
    },
  );

  run(
    'sRGB round trip',
    'float x = (cell.x + cell.y * 256.0) / 65535.0; vec3 l = srgbToLinear(vec3(x)); return vec4(abs(linearToSrgb(l).x - x), l.x, srgbToLinear(vec3(0.5)).x, x);',
    (d) => {
      const err = stats(d, 0);
      const half = d[2] ?? 0;
      const ok = err.max < 2e-4 && Math.abs(half - 0.214041) < 1e-5;
      return [
        ok,
        `max |Δ| ${err.max.toExponential(2)} · srgbToLinear(0.5) = ${half.toFixed(6)} (0.214041)`,
      ];
    },
  );

  run(
    'raySphere hits, misses, precision',
    `if (cell.x > 0.0 || cell.y > 0.0) return vec4(0.0);
     vec2 a = raySphere(vec3(0.0, 0.0, -5.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 1.0);
     vec2 inside = raySphere(vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 1.0);
     vec2 miss = raySphere(vec3(0.0, 2.0, -5.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 1.0);
     // Grazing ray at 1e5 units: naive b*b - c loses every digit here in float32.
     vec2 far = raySphere(vec3(0.0, 999.9, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, 1.0e5), 1000.0);
     return vec4(abs(a.x - 4.0) + abs(a.y - 6.0) + abs(inside.x + 1.0) + abs(inside.y - 1.0),
                 miss.x > miss.y ? 0.0 : 1.0, far.x, far.y);`,
    (d) => {
      const exact = Math.sqrt(1000 * 1000 - 999.9 * 999.9); // 14.1418…
      const errNear = Math.abs((d[2] ?? 0) - (1e5 - exact));
      const errFar = Math.abs((d[3] ?? 0) - (1e5 + exact));
      const ok = (d[0] ?? 1) < 1e-5 && d[1] === 0 && errNear < 0.05 && errFar < 0.05;
      return [
        ok,
        `unit cases |Δ| ${(d[0] ?? 0).toExponential(1)} · miss ok: ${d[1] === 0} · grazing @1e5: tNear error ${errNear.toFixed(4)}, tFar error ${errFar.toFixed(4)}`,
      ];
    },
  );

  run(
    'rotations',
    // Each formula is checked without comparing two different trig evaluations (SwiftShader's
    // sin/cos are not mutually consistent to better than ~3e-4).
    `vec4 q = normalize(hash44(vec4(cell, 1.0, 2.0)) * 2.0 - 1.0);
     vec3 v = hash33(vec3(cell, 3.0)) * 2.0 - 1.0;
     // Quaternion -> matrix, algebraically (no trig): THREE.Matrix4.makeRotationFromQuaternion.
     float x = q.x, y = q.y, z = q.z, w = q.w;
     mat3 R = mat3(
       1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w),
       2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w),
       2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y));
     float quatErr = length(quatRotate(q, v) - R * v);
     // Rodrigues invariants for unit axis k, angle a, and u perpendicular to k:
     // M k = k, dot(M u, u) = cos(a) |u|^2, cross(u, M u) = sin(a) |u|^2 k.
     vec3 k = normalize(hash33(vec3(cell, 5.0)) * 2.0 - 1.0);
     vec3 u = normalize(cross(k, vec3(0.3, 0.8, 0.5)));
     float a = cell.x * 0.0245;
     mat3 M = rotateAxis(k, a);
     float axisErr = length(M * k - k) + abs(dot(M * u, u) - cos(a)) + length(cross(u, M * u) - sin(a) * k);
     float yErr = length(rotateAxis(vec3(0.0, 1.0, 0.0), a) * v - rotateY(a) * v)
       + length(rotateAxis(vec3(1.0, 0.0, 0.0), a) * v - rotateX(a) * v)
       + length(rotateAxis(vec3(0.0, 0.0, 1.0), a) * v - rotateZ(a) * v);
     vec2 r = rotate2d(PI * 0.5) * vec2(1.0, 0.0);
     return vec4(quatErr, axisErr, yErr, length(r - vec2(0.0, 1.0)));`,
    (d) => {
      const [q, k, xyz, r2] = [0, 1, 2, 3].map((c) => stats(d, c).max) as [
        number,
        number,
        number,
        number,
      ];
      return [
        Math.max(q, k, xyz, r2) < 1e-5,
        `max |Δ| quatRotate vs matrix ${q.toExponential(1)} · Rodrigues invariants ${k.toExponential(1)} · axis vs rotateX/Y/Z ${xyz.toExponential(1)} · rotate2d ${r2.toExponential(1)}`,
      ];
    },
  );
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
function report(): void {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const summary = `${passed}/${results.length} passed${failed ? ` — ${failed} FAILED` : ''}`;
  window.__SHADER_TESTS__ = { summary, passed, failed, results };

  const root = document.getElementById('report');
  if (!root) return;
  const heading = document.createElement('h1');
  heading.textContent = 'GLSL chunks';
  const sub = document.createElement('p');
  sub.className = failed ? 'summary bad' : 'summary good';
  sub.textContent = summary;
  const table = document.createElement('table');
  let group = '';
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      const tr = table.insertRow();
      const th = document.createElement('th');
      th.colSpan = 3;
      th.textContent = group;
      tr.append(th);
    }
    const tr = table.insertRow();
    tr.className = r.ok ? 'ok' : 'fail';
    tr.insertCell().textContent = r.ok ? 'PASS' : 'FAIL';
    tr.insertCell().textContent = r.name;
    const detail = tr.insertCell();
    detail.textContent = r.detail;
  }
  root.append(heading, sub, table);
  for (const r of results)
    if (!r.ok) console.error(`[shaders] FAIL ${r.group} / ${r.name}: ${r.detail}`);
}

try {
  rawCompile();
  threeCompat();
  postprocessingCompat();
  numerics();
} catch (err) {
  record(
    'page',
    'uncaught',
    false,
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
} finally {
  report();
  target.dispose();
  fullscreen.dispose();
  renderer.dispose();
  window.__READY__ = true;
}
