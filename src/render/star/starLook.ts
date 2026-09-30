/**
 * Maps a star's physical description (StarDetails) to the handful of numbers that drive how the
 * StarVisual shaders look. Pure and deterministic, so it is unit-tested; the visual only uploads it.
 *
 *   hot O/B      smooth, blinding blue-white, no granulation, wide radiative glow
 *   A/F          faint mottling, thin corona
 *   G (Sun)      classic: fine granulation, spot belt, streamers, prominences
 *   K            like G, redder, larger spots
 *   M dwarf      deep orange, big spots anywhere, frequent flares
 *   giants       few enormous convection cells, soft extended limb, dusty glow
 *   white dwarf  tiny, intense, smooth
 */
import { blackbodyRGB, saturateRGB } from '../../core/color';
import type { RGB, StarDetails } from '../../core/types';

export type StarArchetype = 'sphere' | 'neutron' | 'hole';

export interface StarLook {
  archetype: StarArchetype;
  /** Effective temperature used by the shader (never 0). */
  tempK: number;
  /** Saturated (x1.25) chromaticity, linear, max component 1. */
  color: RGB;
  /** Colour of prominences / chromosphere (Halpha-like, pushed towards the star's hue). */
  hotColor: RGB;
  /** Disc-averaged photosphere radiance (HDR) while the star is a small disc or a point. */
  brightness: number;
  /**
   * Radiance once the disc is large on screen. A camera stops down for a resolved sun (auto-exposure
   * in spirit): at 14 the whole disc sits on the tone curve's shoulder and no surface detail survives.
   */
  closeBrightness: number;
  /** Granulation contrast 0..1.3 (0 = smooth radiative envelope). */
  convection: number;
  /** Convection cells across one stellar radius. */
  granuleScale: number;
  /** Starspot / facula activity 0..1. */
  activity: number;
  /** 0 = spots only in a mid-latitude belt, 1 = anywhere. */
  spotAnywhere: number;
  /** Fuzzy-limb width (in mu) for extended atmospheres. */
  limbSoft: number;
  /** Corona quad half-size, stellar radii. */
  coronaExtent: number;
  /** Corona radiance at the limb relative to `brightness`. */
  coronaGain: number;
  coronaFall: number;
  /** Wide smooth glow relative to `brightness`. */
  haloGain: number;
  /** Radiance of the thin luminous rim hugging the limb (HDR). */
  rimGlow: number;
  streamers: number;
  chromosphere: number;
  prominences: number;
  /** Seconds between flares (0 = none). */
  flarePeriodSec: number;
  /** Flare kernel strength 0..1. */
  flareStrength: number;
  /** Rotation period, days (>0). */
  rotationDays: number;
}

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

export function starLook(star: StarDetails): StarLook {
  const kind = star.kind;
  const cls = star.spectralClass;
  const tempK = kind === 'black-hole' ? 5000 : Math.max(1500, star.temperatureK);
  const color = saturateRGB(star.colorRGB, 1.25);
  const activity = clamp(star.activity, 0, 1);
  const rotationDays = Math.max(star.rotationPeriodDays, 1e-4);

  // Hot photospheres are brighter per unit area (sigma T^4), but the HDR budget tops out ~40.
  const brightness = clamp(14 * (tempK / 5772), 6, 40);
  const closeBrightness = clamp(0.32 * (tempK / 5772) ** 0.5, 0.2, 0.9);
  const hotColor = saturateRGB(blackbodyRGB(Math.min(tempK, 6500) * 0.72), 1.15);

  const base: StarLook = {
    archetype: 'sphere',
    tempK,
    color,
    hotColor: [Math.max(hotColor[0], 0.9), hotColor[1] * 0.42, hotColor[2] * 0.42],
    brightness,
    closeBrightness,
    convection: 0,
    granuleScale: 24,
    activity: 0,
    spotAnywhere: 0,
    limbSoft: 0,
    coronaExtent: 6,
    coronaGain: 0.09,
    coronaFall: 4.4,
    haloGain: 0.03,
    rimGlow: 0.9,
    streamers: 0.7,
    chromosphere: 0.8,
    prominences: 0,
    flarePeriodSec: 0,
    flareStrength: 0,
    rotationDays,
  };

  switch (kind) {
    case 'black-hole':
      return { ...base, archetype: 'hole', brightness: 0, closeBrightness: 0 };
    case 'neutron-star':
      return {
        ...base,
        archetype: 'neutron',
        brightness: 40,
        closeBrightness: 1.0,
        limbSoft: 0,
        coronaExtent: 3,
        coronaGain: 0,
        haloGain: 0,
        chromosphere: 0,
        streamers: 0,
      };
    case 'white-dwarf':
      return {
        ...base,
        brightness: 40,
        closeBrightness: 1.0,
        coronaExtent: 4,
        coronaGain: 0.0,
        haloGain: 0.05,
        rimGlow: 1.3,
        chromosphere: 0,
        streamers: 0,
      };
    case 'giant':
    case 'supergiant':
    case 'subgiant': {
      const super_ = kind === 'supergiant';
      const sub = kind === 'subgiant';
      return {
        ...base,
        convection: super_ ? 1.3 : sub ? 1.0 : 1.2,
        granuleScale: super_ ? 2.6 : sub ? 12 : 5,
        activity: sub ? activity * 0.6 : activity * 0.25,
        spotAnywhere: 1,
        limbSoft: super_ ? 0.4 : sub ? 0.05 : 0.25,
        coronaExtent: super_ ? 4.5 : 5,
        coronaGain: sub ? 0.16 : 0.06,
        coronaFall: 3.2,
        haloGain: super_ ? 0.11 : sub ? 0.04 : 0.09,
        rimGlow: 0.55,
        streamers: 0.3,
        chromosphere: sub ? 0.5 : 0,
        prominences: sub ? activity * 0.5 : 0,
      };
    }
    default:
      break;
  }

  // Main sequence, by spectral class.
  switch (cls) {
    case 'O':
    case 'B':
      return {
        ...base,
        coronaExtent: 4.5,
        coronaGain: 0.05,
        coronaFall: 3.4,
        haloGain: 0.06,
        rimGlow: 1.5,
        streamers: 0,
        chromosphere: 0,
      };
    case 'A':
      return {
        ...base,
        convection: 0.22,
        granuleScale: 18,
        coronaExtent: 4.5,
        coronaGain: 0.08,
        coronaFall: 3.6,
        haloGain: 0.05,
        streamers: 0.2,
        chromosphere: 0,
        activity: activity * 0.15,
      };
    case 'F':
      return {
        ...base,
        convection: 0.7,
        granuleScale: 20,
        activity: activity * 0.8,
        coronaGain: 0.16,
        streamers: 0.6,
        prominences: activity * 0.8,
      };
    case 'K':
      return {
        ...base,
        convection: 1,
        granuleScale: 26,
        activity: Math.min(1, activity * 1.15),
        coronaGain: 0.2,
        prominences: activity,
        flarePeriodSec: activity > 0.6 ? 55 : 0,
        flareStrength: activity > 0.6 ? 0.5 : 0,
      };
    case 'M': {
      const flaring = activity > 0.35;
      return {
        ...base,
        convection: 1,
        granuleScale: 28,
        activity: Math.min(0.85, activity * 1.1 + 0.05),
        spotAnywhere: 1,
        coronaExtent: 5,
        coronaGain: 0.18,
        prominences: Math.min(1, activity * 1.1),
        flarePeriodSec: flaring ? 34 - 16 * activity : 0,
        flareStrength: flaring ? 0.5 + 0.5 * activity : 0,
      };
    }
    default:
      // G and anything unclassified: the Sun.
      return {
        ...base,
        convection: 1,
        granuleScale: 24,
        activity,
        spotAnywhere: rotationDays < 8 ? 1 : 0,
        prominences: activity,
        flarePeriodSec: activity > 0.75 ? 70 : 0,
        flareStrength: activity > 0.75 ? 0.4 : 0,
      };
  }
}
