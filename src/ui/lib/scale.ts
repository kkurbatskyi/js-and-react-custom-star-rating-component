/**
 * Map-style scale ruler maths. The camera looks at its focus from `cameraDistanceKm`, so at the
 * focus one pixel spans  2·d·tan(fov/2) / viewportHeight  kilometres; the ruler picks the largest
 * "nice" length (1, 2 or 5 × 10ⁿ in a human unit) that fits the target width. Across twenty orders of
 * magnitude (a planet's cloud tops to the whole galaxy) the unit steps m → km → AU → ly.
 */
import { formatLy, formatNumber, NBSP } from '../../core/format';
import { KM_PER_AU, KM_PER_LY } from '../../core/units';

/** Vertical field of view assumed for the ruler (the engine's camera default). */
export const DEFAULT_FOV_DEG = 50;

export interface ScaleBarSpec {
  /** Length of the ruler in kilometres. */
  km: number;
  /** Length in CSS pixels. */
  px: number;
  /** "1.2 AU", "50 ly", "20 000 km". */
  label: string;
}

/** Kilometres per pixel at the focus distance, or 0 when the inputs are unusable. */
export function kmPerPixel(distanceKm: number, viewportHeightPx: number, fovDeg: number): number {
  if (!(distanceKm > 0) || !(viewportHeightPx > 0)) return 0;
  return (2 * distanceKm * Math.tan((fovDeg * Math.PI) / 360)) / viewportHeightPx;
}

/** Largest 1–2–5 × 10ⁿ value that is ≤ x (x > 0). */
export function niceFloor(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const base = 10 ** exp;
  const m = x / base;
  const nice = m >= 5 ? 5 : m >= 2 ? 2 : 1;
  return nice * base;
}

const LIMIT_KM = 1.5e7; // ≈ 0.1 AU: below this kilometres read better than AU
const LIMIT_AU_KM = 0.1 * KM_PER_LY; // above this light-years read better than AU

/** The ruler for a given km-per-pixel scale and target pixel width, or null when there is no scale. */
export function scaleBarFor(kmPerPx: number, targetPx: number): ScaleBarSpec | null {
  if (!(kmPerPx > 0) || !Number.isFinite(kmPerPx)) return null;
  const targetKm = kmPerPx * targetPx;
  let km: number;
  let label: string;
  if (targetKm < 1) {
    const m = niceFloor(targetKm * 1000);
    km = m / 1000;
    label = `${formatNumber(m)}${NBSP}m`;
  } else if (targetKm < LIMIT_KM) {
    km = niceFloor(targetKm);
    label = `${formatNumber(km)}${NBSP}km`;
  } else if (targetKm < LIMIT_AU_KM) {
    const au = niceFloor(targetKm / KM_PER_AU);
    km = au * KM_PER_AU;
    label = `${formatNumber(au)}${NBSP}AU`;
  } else {
    const ly = niceFloor(targetKm / KM_PER_LY);
    km = ly * KM_PER_LY;
    label = formatLy(ly);
  }
  return { km, px: km / kmPerPx, label };
}
