/**
 * Quality profiles and the tunable "look" of the galaxy. Everything in `GalaxyLook` is read every
 * frame (uniform updates only), so a dev GUI can bind to `GalaxyVisual.look` directly.
 */
import type { Quality } from '../contracts';

export interface GalaxyQualityProfile {
  /** Galaxy particles (docs/ARCHITECTURE.md §8). */
  readonly particles: number;
  /** Planar map resolution (texels per side; the map spans ±1.2 disk radii). */
  readonly mapSize: number;
  /** Volume pass resolution as a fraction of the drawing buffer's width and height (0 = off). */
  readonly volumeScale: number;
  /** Raymarch step budget per volume pixel. */
  readonly volumeSteps: number;
  /** Dust samples along each particle's line of sight. */
  readonly losSamples: number;
}

/**
 * ARCHITECTURE §8: particles 80k/150k/300k/500k; volume off-or-¼ / ¼ / ½ / ½ resolution (pixel
 * count — a linear scale of 0.5 is ¼ of the pixels).
 */
export const GALAXY_QUALITY: Readonly<Record<Quality, GalaxyQualityProfile>> = {
  low: { particles: 80_000, mapSize: 1024, volumeScale: 0.4, volumeSteps: 28, losSamples: 4 },
  medium: { particles: 150_000, mapSize: 1024, volumeScale: 0.5, volumeSteps: 40, losSamples: 6 },
  high: { particles: 300_000, mapSize: 2048, volumeScale: 0.7, volumeSteps: 52, losSamples: 8 },
  ultra: { particles: 500_000, mapSize: 2048, volumeScale: 0.7, volumeSteps: 64, losSamples: 8 },
};

/** Artistic controls. Brightness and dust are normalised per galaxy, so every seed looks alike. */
export interface GalaxyLook {
  /** Mean face-on surface brightness of the disk around the home circle (scene-linear). */
  brightness: number;
  /** Face-on optical depth (green) through the densest dust lane on the home circle. */
  dustOpacity: number;
  /** Extinction per channel relative to green: > 1 in blue reddens light seen through dust. */
  reddening: [number, number, number];
  /** Rendered dust scale height × the model's (face-on lanes need dust as thick as the light). */
  dustThickness: number;
  /** Visual-only dust filaments on top of the model's dust (0 = the model's dust exactly). */
  dustDetail: number;
  /** Near-camera 3D dust structure (inside the disk), 0..1. */
  nearDust: number;
  /**
   * Highlight compression of the emissivity above a knee (the home-circle arm-ridge emissivity ×
   * `coreKnee`): j → knee·(j/knee)^coreGamma. Galaxy photos are stretched too; 1 = linear.
   */
  coreGamma: number;
  coreKnee: number;
  /** Mottling of the smooth disk light (flocculent star clouds), 0..1. */
  mottling: number;
  /** Diffuse Hα glow along star-forming ridges, relative to the arm light. */
  hiiGlow: number;
  /** Particle gains by kind (1 = physically calibrated for field particles). */
  particleGain: number;
  clusterGain: number;
  hiiGain: number;
  /** Colour temperatures (K) of the stellar populations. */
  bulgeK: number;
  diskK: number;
  thickK: number;
  youngK: number;
  /** Chroma boost about the luminance axis (blackbody colours are pale; §9 suggests ~1.25). */
  saturation: number;
  /** Smallest Gaussian σ of a particle, device px (keeps unresolved particles stable). */
  minSigmaPx: number;
  /**
   * Largest Gaussian σ of a particle, device px. Particles are the unresolved sparkle; once
   * resolved they keep this footprint at constant surface brightness (the volume carries the
   * resolved light), so nothing turns into bokeh blobs near the camera.
   */
  maxSigmaPx: number;
}

export function defaultGalaxyLook(): GalaxyLook {
  return {
    brightness: 0.08,
    dustOpacity: 3,
    reddening: [0.72, 1, 1.4],
    dustThickness: 1.5,
    dustDetail: 1.3,
    nearDust: 0.7,
    coreGamma: 0.5,
    coreKnee: 0.8,
    mottling: 0.25,
    hiiGlow: 0.18,
    particleGain: 1,
    clusterGain: 1,
    hiiGain: 1,
    bulgeK: 4300,
    diskK: 5600,
    thickK: 4900,
    youngK: 12_000,
    saturation: 1.3,
    minSigmaPx: 0.75,
    maxSigmaPx: 1,
  };
}
