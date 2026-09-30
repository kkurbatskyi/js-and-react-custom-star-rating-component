/**
 * Photometric calibration of the galaxy visual, derived from the structure so every seed looks
 * alike. Units: densities are the structure's UNSCALED densities (thin-disk midplane at R = 0 ≈ 1),
 * lengths are light-years, radiance is scene-linear HDR.
 *
 * - Emission: a volume element emits j = k_E · Σ_c ρ_c L_c radiance per ly of path (L_c = light per
 *   star of component c). k_E is chosen so the face-on surface brightness ∫ j dy, averaged around
 *   the home circle, equals `look.brightness`.
 * - Dust: extinction α = κ · dustPlanar(x, z) · sech²(y/h_d) per ly (green). κ is chosen so the
 *   face-on optical depth through the densest lane on the home circle, κ · max(dust) · 2h_d
 *   (∫sech²(y/h)dy = 2h), equals `look.dustOpacity`.
 * - Highlights: emissivity above knee = ridgeLight · coreKnee is compressed, j → knee·(j/knee)^γ
 *   (see `compressLight`), in the volume and in the particle fluxes alike.
 */
import { blackbodyRGBInto } from '../../core/color';
import { HOME_RADIUS_FRACTION } from '../../gen/galaxy/params';
import type { GalaxyStructure } from '../../gen/galaxy/structure';

const RING_SAMPLES = 720;

/** exp(−R/R_d) · logistic taper — the disk's radial profile, as in the structure. */
export function diskRadial(structure: GalaxyStructure, r: number): number {
  const g = structure.gpu;
  return Math.exp(-r / g.diskScaleLengthLy) / (1 + Math.exp((r - g.radiusLy) / g.edgeWidthLy));
}

/** Mean face-on light column Σ_c ∫ρ_c L_c dy around the home circle (unscaled density × ly). */
export function faceOnLightColumn(structure: GalaxyStructure): number {
  const g = structure.gpu;
  const r = HOME_RADIUS_FRACTION * g.radiusLy;
  let armSum = 0;
  for (let i = 0; i < RING_SAMPLES; i++) {
    const t = (2 * Math.PI * i) / RING_SAMPLES;
    armSum += structure.armFactor(r * Math.cos(t), 0, r * Math.sin(t));
  }
  const meanArm = armSum / RING_SAMPLES;
  const L = g.lightPerStar;
  const disk = 2 * g.thinHeightLy + g.thickNorm * 2 * g.thickHeightLy;
  const arm = g.armStrength * meanArm * 2 * g.armHeightLy;
  return diskRadial(structure, r) * (L.disk * disk + L.arm * arm);
}

/** Densest midplane dust on the home circle (the structure's relative dust units). */
export function maxLaneDust(structure: GalaxyStructure): number {
  const r = HOME_RADIUS_FRACTION * structure.gpu.radiusLy;
  let max = 0;
  for (let i = 0; i < RING_SAMPLES; i++) {
    const t = (2 * Math.PI * i) / RING_SAMPLES;
    max = Math.max(max, structure.dust(r * Math.cos(t), 0, r * Math.sin(t)));
  }
  return max;
}

/** Brightest midplane light emissivity Σρ_c L_c on the home circle (an arm ridge). */
export function ridgeLight(structure: GalaxyStructure): number {
  const r = HOME_RADIUS_FRACTION * structure.gpu.radiusLy;
  let max = 0;
  for (let i = 0; i < RING_SAMPLES; i++) {
    const t = (2 * Math.PI * i) / RING_SAMPLES;
    max = Math.max(max, structure.light(r * Math.cos(t), 0, r * Math.sin(t)));
  }
  return max;
}

export interface GalaxyCalibration {
  /** k_E: radiance per ly per unit of Σ ρ_c L_c. */
  readonly emission: number;
  /** κ (green): extinction per ly per unit of dustPlanar · sech². */
  readonly dustKappa: number;
  /** Σ_c N_c L_c — the galaxy's total light in unscaled units (particle flux budget). */
  readonly totalLight: number;
  /** Arm-ridge light emissivity on the home circle (unscaled; the highlight-compression unit). */
  readonly ridgeLight: number;
}

/**
 * @param dustHeightLy the RENDERED dust scale height (the look may thicken the model's): the
 *   face-on optical depth scales with it, so κ is normalised with the same height.
 */
export function calibrate(
  structure: GalaxyStructure,
  brightness: number,
  dustOpacity: number,
  dustHeightLy = structure.gpu.dustHeightLy,
): GalaxyCalibration {
  const column = faceOnLightColumn(structure);
  const dust = maxLaneDust(structure);
  const g = structure.gpu;
  let totalLight = 0;
  for (const [c, n] of Object.entries(structure.componentStars)) {
    totalLight += n * (g.lightPerStar[c as keyof typeof g.lightPerStar] ?? 0);
  }
  return {
    emission: column > 0 ? brightness / column : 0,
    dustKappa: dust > 0 ? dustOpacity / (dust * 2 * dustHeightLy) : 0,
    totalLight,
    ridgeLight: ridgeLight(structure),
  };
}

/**
 * Population colour: blackbody chromaticity at `tempK`, chroma-boosted by `saturation`, scaled to
 * unit Rec. 709 luminance (so brightness and hue are independent). Writes out[offset..+2].
 */
export function populationColorInto(
  tempK: number,
  saturation: number,
  out: { [index: number]: number },
  offset = 0,
): void {
  blackbodyRGBInto(tempK, out, offset);
  const r0 = out[offset] as number;
  const g0 = out[offset + 1] as number;
  const b0 = out[offset + 2] as number;
  const y = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
  const r = Math.max(0, y + (r0 - y) * saturation);
  const g = Math.max(0, y + (g0 - y) * saturation);
  const b = Math.max(0, y + (b0 - y) * saturation);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = lum > 0 ? 1 / lum : 0;
  out[offset] = r * k;
  out[offset + 1] = g * k;
  out[offset + 2] = b * k;
}

/** Highlight compression factor for light emissivity j (unscaled): 1 below the knee. */
export function compressLight(j: number, knee: number, gamma: number): number {
  return j > knee && knee > 0 ? (j / knee) ** (gamma - 1) : 1;
}
