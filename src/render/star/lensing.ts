/**
 * Gravitational lensing as a post effect (HDR stage): distorts the background around a black
 * hole with the point-lens equation, which makes an Einstein ring.
 *
 * For a background source at angle beta from the hole and its image at angle theta,
 *   beta = theta - theta_E^2 / theta,      theta_E = sqrt(2 r_s / D)   (source at infinity, D >> r_s)
 * so every pixel at radius theta shows the sky at radius beta (inverse mapping, surface brightness
 * conserved — stars stretch into tangential arcs). Inside the ring beta is negative: the image is
 * the mirrored, compressed far side of the sky. See Schneider, Ehlers & Falco, "Gravitational
 * Lenses" (1992), ch. 4.
 *
 * The black-hole visual draws its own strongly-lensed disc, shadow and photon ring; the effect must
 * not warp those again, so it blends in from `innerRadiusPx` outward (identity inside).
 *
 * Engine wiring (three lines):
 *   const lensing = createLensingEffect();
 *   post.setHdrEffects([...others, lensing], 'pre-bloom');
 *   // every frame, with the focus star's StarVisual:
 *   lensing.setState(starVisual.lens);        // or lensing.setTarget(uv, einsteinRadiusPx, strength)
 * `setState` with `lens.active === false` (off-screen, behind the camera, not a black hole) disables it.
 */
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector4 } from 'three';
import type { LensState } from './types';

const fragmentShader = /* glsl */ `
uniform vec4 uLensA;   // xy: hole position (uv), z: Einstein radius (viewport-height units), w: strength
uniform vec4 uLensB;   // x: inner radius (height units), y: aspect (w / h), z: viewport height in CSS px, w: end of the blend ramp

void mainUv(inout vec2 uv) {
  if (uLensA.w <= 0.0 || uLensA.z <= 0.0) return;
  vec2 q = (uv - uLensA.xy) * vec2(uLensB.y, 1.0);
  float r = length(q);
  if (r < 1e-5) return;
  float w = smoothstep(uLensB.x, uLensB.w, r);
  float te2 = uLensA.z * uLensA.z * uLensA.w;
  float rs = r - min(w * te2 / r, 2.5 * r);
  uv = uLensA.xy + q * (rs / r) / vec2(uLensB.y, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Sky sampled from beyond the frame is unknown: fade to black instead of smearing the edge.
  vec2 e = smoothstep(vec2(0.0), vec2(0.03), uv) * (1.0 - smoothstep(vec2(0.97), vec2(1.0), uv));
  float m = (uLensA.w > 0.0 && uLensA.z > 0.0) ? e.x * e.y : 1.0;
  outputColor = vec4(inputColor.rgb * m, inputColor.a);
}
`;

/**
 * End radius of the blend ramp that fades the lens in from `inner`. The remap beta(r) = r - w(r) te2 / r
 * folds (an image appears twice) where its slope drops below zero; the ramp is widened until the slope of
 * w(r) te2 / r stays below 0.9 everywhere (checked on a few samples of the smoothstep).
 */
export function lensRampEnd(einstein: number, inner: number): number {
  const r0 = Math.max(inner, 1e-4);
  const te2 = einstein * einstein;
  for (let k = 1.25; k <= 600; k *= 1.1) {
    const r1 = r0 * k;
    let ok = true;
    for (let i = 1; i < 24 && ok; i++) {
      const t = i / 24;
      const r = r0 + (r1 - r0) * t;
      const w = t * t * (3 - 2 * t);
      const wp = (6 * t * (1 - t)) / (r1 - r0);
      if ((wp * te2) / r - (w * te2) / (r * r) > 0.9) ok = false;
    }
    if (ok) return r1;
  }
  return r0 * 600;
}

export class LensingEffect extends Effect {
  private readonly a = new Uniform(new Vector4(0.5, 0.5, 0, 0));
  private readonly b = new Uniform(new Vector4(0, 16 / 9, 1, 0));
  private heightPx = 0;

  constructor() {
    super('LensingEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uLensA', new Uniform(new Vector4(0.5, 0.5, 0, 0))],
        ['uLensB', new Uniform(new Vector4(0, 16 / 9, 1, 0))],
      ]),
    });
    this.a = this.uniforms.get('uLensA') as Uniform<Vector4>;
    this.b = this.uniforms.get('uLensB') as Uniform<Vector4>;
  }

  /**
   * Point the lens at a screen position.
   * @param uvX,uvY hole position, 0..1 from the bottom-left
   * @param einsteinRadiusPx Einstein radius in CSS px (theta_E * pixelsPerRadian)
   * @param strength 0..1 (0 disables; fade in/out with it)
   * @param innerRadiusPx radius inside which the image is left untouched (default 0.6 theta_E)
   * @param viewportHeightPx CSS height of the viewport (default: the render target's height)
   */
  setTarget(
    uvX: number,
    uvY: number,
    einsteinRadiusPx: number,
    strength: number,
    innerRadiusPx = 0.6 * einsteinRadiusPx,
    viewportHeightPx = this.heightPx || 1,
  ): void {
    const h = Math.max(viewportHeightPx, 1);
    this.a.value.set(uvX, uvY, einsteinRadiusPx / h, strength > 0 ? Math.min(strength, 1) : 0);
    const inner = innerRadiusPx / h;
    this.b.value.x = inner;
    this.b.value.z = h;
    this.b.value.w = lensRampEnd(einsteinRadiusPx / h, inner);
  }

  /** Convenience: forward `StarVisual.lens` (disabled when `active` is false). */
  setState(lens: LensState, viewportHeightPx?: number): void {
    if (!lens.active) {
      this.disable();
      return;
    }
    this.setTarget(
      lens.uvX,
      lens.uvY,
      lens.einsteinRadiusPx,
      lens.strength,
      lens.innerRadiusPx,
      viewportHeightPx ?? lens.viewportHeightPx,
    );
  }

  disable(): void {
    this.a.value.w = 0;
  }

  override setSize(width: number, height: number): void {
    this.heightPx = height;
    this.b.value.y = width / Math.max(height, 1);
  }
}

export function createLensingEffect(): LensingEffect {
  return new LensingEffect();
}
