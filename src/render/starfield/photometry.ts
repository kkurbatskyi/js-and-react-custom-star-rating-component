/**
 * Shared photometry — the single source of truth for how bright, and how big, a star that is too
 * far away to resolve looks on screen.
 *
 * Both the starfield (catalogue stars as sprites) and StarVisual's point-source mode (the focus
 * star as it appears anywhere inside its own system) map a star's V-band luminosity and distance
 * to a sprite through the functions below, so the hand-off between them — the starfield hides the
 * focus star while StarVisual fades in — changes neither brightness nor size nor shape.
 *
 * Pipeline
 *   L_V, d  ->  apparent magnitude  m = M_V + 5 log10(d / 10 pc)   (M_V = 4.83 - 2.5 log10 L_V)
 *           ->  flux relative to a magnitude-0 star  f = 10^(-0.4 m)
 *           ->  perceptual sprite: peak radiance  P = P0 * f^0.8  (compressive: 12 mag on one display)
 *               core sigma / halo radius / diffraction-spike length grow with log P.
 *
 * The GLSL twin (`spriteGlsl`, generated from the SAME constants) lets the starfield's vertex shader
 * evaluate the identical mapping per star on the GPU. Sizes are CSS pixels, scaled by
 * `resolutionScale(pixelsPerRadian)`; the sprite centre is evaluated analytically at sub-pixel
 * positions (sigma never drops below ~0.8 px), which is what keeps faint stars from shimmering.
 */
import { KM_PER_PC, SOLAR_ABS_MAG_V } from '../../core/units';

/** Display-mapping constants (also baked into the GLSL twin). */
export const SPRITE = {
  /** Faintest apparent magnitude drawn at exposure 1. */
  limitingMag: 6.8,
  /** Peak scene-linear radiance of a magnitude-0 star. */
  peak0: 4.0,
  /** Peak grows as flux^peakExponent. */
  peakExponent: 0.8,
  /** Upper clamp of the peak radiance (HDR; bloom does the rest). */
  peakMax: 48,
  /** Core Gaussian sigma: floor and growth with log10(1 + peak), CSS px. */
  sigmaMin: 0.8,
  sigmaGrow: 1.6,
  sigmaMax: 5,
  /** Halo (Plummer) radius: base + grow * log10(1 + peak)^2, CSS px. */
  haloBase: 2.5,
  haloGrow: 14,
  haloMax: 60,
  /** Halo peak relative to the core peak. */
  haloGain: 0.05,
  /** Spike amplitude relative to the core peak, ramping in between two peak levels. */
  spikeGain: 0.22,
  spikeKneeLo: 0.35,
  spikeKneeHi: 2.5,
  /** Spike falloff length scale and length cap, CSS px. */
  spikeScale: 3.5,
  spikeMax: 160,
  /** Radiance below which a sprite component is considered invisible (extent cut-offs). */
  visible: 0.003,
  /** Reference pixels-per-radian (1080 px tall, 50 deg fov) for `resolutionScale`. */
  referencePpr: 1158,
} as const;

/** Flux (relative to a magnitude-0 star) of the faintest star drawn at exposure 1. */
export const MIN_FLUX = 10 ** (-0.4 * SPRITE.limitingMag);

export interface PointSource {
  /** Peak scene-linear radiance at the sprite centre (HDR; > 1 blooms). */
  peakHdr: number;
  /** Half-size of the sprite quad in CSS px: everything visible lies inside it. */
  radiusPx: number;
  /** Core Gaussian sigma, CSS px. */
  sigmaPx: number;
  /** Halo (Plummer) radius, CSS px. */
  haloPx: number;
  /** Halo peak relative to `peakHdr`. */
  haloGain: number;
  /** Diffraction-spike length, CSS px (0 = none). */
  spikePx: number;
  /** Spike amplitude relative to `peakHdr`. */
  spikeGain: number;
  /** Apparent V magnitude (informational). */
  magnitude: number;
}

export function createPointSource(): PointSource {
  return {
    peakHdr: 0,
    radiusPx: 0,
    sigmaPx: 0,
    haloPx: 0,
    haloGain: 0,
    spikePx: 0,
    spikeGain: 0,
    magnitude: 99,
  };
}

/** V-band luminosity in solar units from an absolute V magnitude (Sun: M_V = 4.83). */
export function visualLuminositySolar(absMag: number): number {
  return 10 ** (-0.4 * (absMag - SOLAR_ABS_MAG_V));
}

/** Apparent V magnitude of a star of V-band luminosity `luminositySolar` seen from `distanceKm`. */
export function apparentMagnitude(luminositySolar: number, distanceKm: number): number {
  const absMag = SOLAR_ABS_MAG_V - 2.5 * Math.log10(Math.max(luminositySolar, 1e-30));
  return absMag + 5 * Math.log10(Math.max(distanceKm, 1) / (10 * KM_PER_PC));
}

/** Flux relative to a magnitude-0 star. */
export function fluxFromMagnitude(m: number): number {
  return 10 ** (-0.4 * m);
}

/** Sprite sizes scale gently with display resolution so a 4K screen does not shrink the stars. */
export function resolutionScale(pixelsPerRadian: number): number {
  const s = Math.sqrt(Math.max(pixelsPerRadian, 1) / SPRITE.referencePpr);
  return Math.min(1.5, Math.max(0.8, s));
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sprite parameters for a flux (relative to magnitude 0). `resScale` is `resolutionScale(ppr)`.
 * Mirrors `starSpriteParams` in the GLSL twin — keep the two in step (a unit test pins the numbers).
 */
export function spriteFromFlux(flux: number, resScale: number, out: PointSource): PointSource {
  const S = SPRITE;
  const peak = Math.min(S.peakMax, S.peak0 * flux ** S.peakExponent);
  const lp = Math.log10(1 + peak);
  const sigma = Math.min(S.sigmaMax, S.sigmaMin + S.sigmaGrow * lp ** 1.5) * resScale;
  const halo = Math.min(S.haloMax, S.haloBase + S.haloGrow * lp * lp) * resScale;
  const haloAbs = S.haloGain * peak;
  const spikeGain = S.spikeGain * smooth(S.spikeKneeLo, S.spikeKneeHi, peak);
  const spikeAbs = spikeGain * peak;
  const spike =
    spikeAbs > S.visible
      ? Math.min(S.spikeMax, S.spikeScale * (Math.sqrt(spikeAbs / S.visible) - 1)) * resScale
      : 0;
  // Extent: where each component drops below the visibility threshold.
  const haloExtent =
    haloAbs > S.visible ? halo * Math.sqrt((haloAbs / S.visible) ** (2 / 3) - 1) : 0;
  out.peakHdr = peak;
  out.sigmaPx = sigma;
  out.haloPx = halo;
  out.haloGain = S.haloGain;
  out.spikePx = spike;
  out.spikeGain = spikeGain;
  out.radiusPx = Math.max(4 * sigma, Math.min(haloExtent, 4 * S.haloMax * resScale), spike) + 2;
  return out;
}

/**
 * The shared hand-off function: apparent sprite of a star of V-band luminosity `luminositySolar`
 * (use `visualLuminositySolar(star.absMag)`) at `distanceKm`, for a camera with `pixelsPerRadian`
 * (CSS px, `height / (2 tan(fov / 2))`). Pass `out` from hot paths to avoid allocation.
 */
export function pointSource(
  luminositySolar: number,
  distanceKm: number,
  pixelsPerRadian: number,
  exposure = 1,
  out: PointSource = createPointSource(),
): PointSource {
  const m = apparentMagnitude(luminositySolar, distanceKm);
  out.magnitude = m;
  return spriteFromFlux(fluxFromMagnitude(m) * exposure, resolutionScale(pixelsPerRadian), out);
}

/**
 * GLSL twin of `spriteFromFlux` + the sprite profile. Include once per shader (no dependencies).
 *   starSpriteParams(flux, resScale, ...)  -> peak, sigma, halo radius, spike length, spike gain, extent
 *   starPsf(p, sigma, haloR, haloGain, spikeLen, spikeGain, extent) -> profile, 1 at the centre
 * `p` is the offset from the star centre in CSS px (screen axes, y up).
 */
export const spriteGlsl = /* glsl */ `
// ---- sidereal/starfield/sprite (twin of photometry.ts) ------------------------------------
void starSpriteParams(float flux, float resScale, out float peak, out float sigma, out float haloR,
                      out float spikeLen, out float spikeGain, out float extent) {
  peak = min(${SPRITE.peakMax.toFixed(3)}, ${SPRITE.peak0.toFixed(3)} * pow(max(flux, 1e-12), ${SPRITE.peakExponent.toFixed(3)}));
  float lp = log2(1.0 + peak) * 0.30102999566;
  sigma = min(${SPRITE.sigmaMax.toFixed(3)}, ${SPRITE.sigmaMin.toFixed(3)} + ${SPRITE.sigmaGrow.toFixed(3)} * pow(lp, 1.5)) * resScale;
  haloR = min(${SPRITE.haloMax.toFixed(3)}, ${SPRITE.haloBase.toFixed(3)} + ${SPRITE.haloGrow.toFixed(3)} * lp * lp) * resScale;
  float haloAbs = ${SPRITE.haloGain.toFixed(4)} * peak;
  spikeGain = ${SPRITE.spikeGain.toFixed(4)} * smoothstep(${SPRITE.spikeKneeLo.toFixed(3)}, ${SPRITE.spikeKneeHi.toFixed(3)}, peak);
  float spikeAbs = spikeGain * peak;
  spikeLen = spikeAbs > ${SPRITE.visible.toFixed(4)}
    ? min(${SPRITE.spikeMax.toFixed(3)}, ${SPRITE.spikeScale.toFixed(3)} * (sqrt(spikeAbs / ${SPRITE.visible.toFixed(4)}) - 1.0)) * resScale
    : 0.0;
  float haloExtent = haloAbs > ${SPRITE.visible.toFixed(4)}
    ? haloR * sqrt(pow(haloAbs / ${SPRITE.visible.toFixed(4)}, 0.6666667) - 1.0)
    : 0.0;
  extent = max(4.0 * sigma, max(min(haloExtent, ${(4 * SPRITE.haloMax).toFixed(1)} * resScale), spikeLen)) + 2.0;
}

// One diffraction spike along unit direction d (both ways): thin Gaussian across, power-law along.
float starSpike(vec2 p, vec2 d, float width, float len) {
  float along = abs(dot(p, d));
  float across = dot(p, vec2(-d.y, d.x));
  float w = width + 0.02 * along;
  float fall = 1.0 / ((1.0 + along * ${(1 / SPRITE.spikeScale).toFixed(5)}) * (1.0 + along * ${(1 / SPRITE.spikeScale).toFixed(5)}));
  return exp(-0.5 * across * across / (w * w)) * fall * (1.0 - smoothstep(0.6 * len, len, along));
}

// Sprite profile: Gaussian core + Plummer halo + JWST-style spikes (six main at 90/30/150 degrees
// plus two short horizontal ones). Peak is 1 at the centre; multiply by the peak radiance.
float starPsf(vec2 p, float sigma, float haloR, float haloGain, float spikeLen, float spikeGain, float extent) {
  float r2 = dot(p, p);
  float core = exp(-0.5 * r2 / (sigma * sigma));
  float win = 1.0 - smoothstep(0.35 * extent, extent, sqrt(r2));
  float halo = haloGain * pow(1.0 + r2 / (haloR * haloR), -1.5) * win;
  float v = core + halo;
  if (spikeLen > 0.0) {
    float sw = 0.8 * (0.5 + 0.5 * sigma);
    float s = starSpike(p, vec2(0.0, 1.0), sw, spikeLen)
            + starSpike(p, vec2(0.8660254, 0.5), sw, spikeLen)
            + starSpike(p, vec2(-0.8660254, 0.5), sw, spikeLen)
            + 0.3 * starSpike(p, vec2(1.0, 0.0), sw, 0.55 * spikeLen);
    v += spikeGain * s;
  }
  return v;
}
`;
