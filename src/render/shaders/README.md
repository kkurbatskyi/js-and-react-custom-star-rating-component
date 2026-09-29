# render/shaders — shared GLSL chunks

GLSL ES 3.00 snippets exported as `/* glsl */` template strings. Interpolate them into your shader
source:

```ts
import { common } from '../shaders/common.glsl';
import { color } from '../shaders/color.glsl';
import { noise } from '../shaders/noise.glsl';

const fragmentShader = /* glsl */ `
  ${common}
  ${color}
  ${noise}
  uniform float uTime;
  in vec3 vDir;
  out vec4 fragColor;
  void main() {
    float n = fbm(vDir * 4.0, 5);
    fragColor = vec4(blackbody(5800.0) * (1.0 + 0.1 * n), 1.0);
  }
`;
// new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, toneMapped: false, fragmentShader, … })
```

## Rules

1. **Include each chunk at most once per shader**, and pick one of `hash` ⊂ `simplex` ⊂ `noise`.
   Chunks have no include guards on purpose: when postprocessing merges several effects into one
   pass it renames each effect's functions, but not macros or globals. So the chunks declare no
   global `const`s, and guards would drop the second effect's renamed copy.
2. If you use three.js `#include <common>`, put it **before** the chunks.
3. Chunks are pure ASCII (WebGL rejects some non-ASCII input, even inside comments).
4. `shaders.test.ts` enforces rules 1–3 statically; `dev/shaders.html` compiles everything and checks
   the maths on the GPU. Run it after touching a chunk.

## Contents

| Chunk | Functions |
|---|---|
| `common` | `PI`, `TAU`, `saturate` (guarded macros) · `remap`, `remapClamped`, `linstep`, `smootherstep` · `luminance709` · `safeNormalize` · `raySphere(ro, rd, c, r) → (tNear, tFar)` (miss: `t.x > t.y`; precise at large distances, Ray Tracing Gems ch. 7) · `rotate2d`, `rotateX/Y/Z`, `rotateAxis`, `quatRotate(q, v)` (THREE.Quaternion layout) |
| `color` | `srgbToLinear`, `linearToSrgb` (exact IEC 61966-2-1) · `planckianLocusXy(T)` (T ≥ 1000 K: Kim et al. 2002 above 1667 K, own fit below) · `blackbody(T)` (max channel 1) · `blackbodyUnitLuminance(T)` (Y = 1) · `adjustSaturation(c, s)` |
| `hash` | `pcg`, `pcg2d`, `pcg3d`, `pcg4d` (Jarzynski & Olano 2020) · `uintToUnit` · `hash11 12 13 14 22 33 44` (float bit patterns → [0, 1)) |
| `simplex` | `hash` + `snoise(vec3)`, `snoise(vec4)` · `snoiseGrad(vec3) → vec4(value, ∇)` (webgl-noise, MIT, 2022 kernel) |
| `noise` | `simplex` + `fbm(p, octaves[, lacunarity, gain])`, `fbmGrad(…) → vec4(value, ∇)`, `ridged(p, octaves[, lacunarity, h, offset, gain])` (Musgrave), `worley(p, jitter) → (F1, F2)`, `domainWarp(p, strength, octaves)` |

Ranges measured on the GPU (`dev/shaders.html`): `snoise` 3D ±0.96 and 4D ±0.99 (mean ≈ 0);
`fbm` ±0.75; `ridged` [0, 0.95]; Worley F1 [0, 1.02]. The analytic gradients match finite
differences to 0.01% (`snoiseGrad`) and 0.15% (`fbmGrad`). `planckianLocusXy(2856 K)` is within 5e-4
of CIE illuminant A. `blackbody` matches the CPU reference (`src/core/color.ts`, Planck ⊗ CIE CMFs)
within 0.011 per channel over 1000–40000 K, so CPU-coloured and GPU-coloured stars agree.

## Notes

- Never pass raw `simDays` (≈ 9.8e3 days since J2000) to a shader: float32 resolves ~84 s there.
  Pass CPU-computed phases or `simDays − epoch`.
- Prefer uniforms to per-instance `#define`s: every distinct define set compiles a new program.
- The CPU twin of `blackbody` for data colours is `src/core/color.ts`.
