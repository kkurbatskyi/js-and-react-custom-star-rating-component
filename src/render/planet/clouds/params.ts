/**
 * Cloud layer parameters derived from a body's data and `appearance` hints (`cloudCoverage`, `cloudColor`).
 *
 * Style follows the climate: full overcast for hothouse worlds, thin wind-streaked wisps on thin-air deserts
 * and Mars-likes, cumulus fields with cyclones, an ITCZ and storm tracks everywhere else. Cyclones are
 * placed deterministically from the body's seed (a fork of its stream: adding them changes nothing else).
 * Giants (`cloudCoverage` = 0, bands painted by the surface) and airless bodies get no layer.
 */
import { clamp } from '../../../core/math';
import { createRng } from '../../../core/rng';
import type { BodyBase, RGB } from '../../../core/types';
import { deriveAtmosphere, type Vec3T } from '../atmosphere/params';

export type CloudStyle = 'cumulus' | 'overcast' | 'wisp';

export interface Vortex {
  /** Latitude / longitude of the centre (rad, body frame). */
  lat: number;
  lon: number;
  /** Angular radius (rad of arc): the twist falls off as exp(-(d / size)^2). */
  size: number;
  /** Twist at the centre (rad): sign = hemisphere (counter-clockwise north, clockwise south). */
  strength: number;
}

export interface CloudParams {
  style: CloudStyle;
  /** Area-weighted cloud cover, 0..1 (`appearance.cloudCoverage`). */
  coverage: number;
  color: RGB;
  /** Cloud shell radius = radiusKm * (1 + heightFraction). */
  heightFraction: number;
  /** Maximum opacity of the densest cloud (thin wisps stay translucent). */
  opacity: number;
  vortices: Vortex[];
  /** Mean of the zonal coverage envelope, so the global cover stays `coverage`. */
  zonalMean: number;
  /** Zenith extinction (rgb) of the air above the clouds: sunlight reddens with it towards the terminator. */
  sunTau: Vec3T;
  /** Ambient sky tint that fills shadows and the twilight zone (max component 1). */
  skyColor: RGB;
}

/** Below this cover (or pressure) a world is drawn without a cloud layer. */
export const MIN_CLOUD_COVER = 0.02;
export const MIN_CLOUD_PRESSURE_ATM = 0.02;
export const MAX_VORTICES = 4;

/**
 * Zonal cover envelope at sin(latitude) s: an ITCZ band at the equator, dry subtropics near 25 deg, storm
 * tracks near 48 deg, a little cloud over the poles. GLSL mirror: `zonalEnvelope` in clouds.glsl.ts.
 */
export function zonalEnvelope(s: number): number {
  const a = Math.abs(s);
  const gauss = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));
  return Math.max(
    1 + 0.6 * gauss(a, 0, 0.16) - 0.4 * gauss(a, 0.42, 0.12) + 0.5 * gauss(a, 0.75, 0.14),
    0.1,
  );
}

/** Area-weighted mean of the envelope over the sphere (uniform in sin(latitude)). */
export function zonalEnvelopeMean(): number {
  const n = 256;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += zonalEnvelope(-1 + (2 * (i + 0.5)) / n);
  return sum / n;
}

/** Cyclones: 0 on thin or nearly clear worlds, up to MAX_VORTICES on cloudy temperate ones. */
function placeVortices(body: BodyBase, style: CloudStyle, coverage: number): Vortex[] {
  if (style !== 'cumulus' || coverage < 0.2) return [];
  const rng = createRng(body.seed).fork('cyclones');
  const count = clamp(Math.round(coverage * 3.2), 1, 3);
  const out: Vortex[] = [];
  for (let i = 0; i < count; i++) {
    const north = i % 2 === 0;
    const lat = (north ? 1 : -1) * rng.range(0.32, 1.05); // 18-60 deg
    out.push({
      lat,
      lon: rng.range(-Math.PI, Math.PI),
      size: rng.range(0.2, 0.4),
      strength: (north ? 1 : -1) * rng.range(1.5, 3.0),
    });
  }
  return out;
}

export function deriveClouds(body: BodyBase): CloudParams | null {
  const atm = body.atmosphere;
  const cover = body.appearance.cloudCoverage;
  if (!atm || body.type === 'gas-giant' || body.type === 'ice-giant') return null;
  if (cover < MIN_CLOUD_COVER || atm.surfacePressureAtm < MIN_CLOUD_PRESSURE_ATM) return null;

  const style: CloudStyle =
    cover >= 0.9 ? 'overcast' : atm.surfacePressureAtm < 0.3 ? 'wisp' : 'cumulus';
  const R = body.radiusKm;
  const hFrac = clamp((1.6 * Math.max(atm.scaleHeightKm, 1)) / R, 0.0025, 0.012);

  // Sunlight above the clouds: the atmosphere's zenith extinction, thinned by the air below the deck.
  const air = deriveAtmosphere(body);
  const above = Math.exp(-(hFrac * R) / Math.max(air?.rayleigh.heightKm ?? atm.scaleHeightKm, 1));
  const tau = air?.zenithTau ?? [0, 0, 0];
  const haze = body.appearance.hazeColor ?? [0.6, 0.7, 1];
  const hmax = Math.max(haze[0], haze[1], haze[2], 1e-3);

  return {
    style,
    coverage: clamp(cover, 0, 1),
    color: body.appearance.cloudColor,
    heightFraction: hFrac,
    opacity: style === 'wisp' ? 0.38 : style === 'overcast' ? 0.99 : 0.96,
    vortices: placeVortices(body, style, cover),
    zonalMean: zonalEnvelopeMean(),
    sunTau: [tau[0] * above, tau[1] * above, tau[2] * above],
    skyColor: [haze[0] / hmax, haze[1] / hmax, haze[2] / hmax],
  };
}
