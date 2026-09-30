/**
 * Transmittance look-up table: the optical depth (RGB) from a point at radius r, along a ray with zenith
 * cosine mu, to the top of the atmosphere. The shell shader reads it once per view sample to get the
 * sunlight reaching that sample, so no nested light-ray march is needed.
 *
 * Parametrisation after Bruneton & Neyret (2008) / Bruneton (2017): with rho = distance from the point
 * to the horizon, H = sqrt(Rt^2 - Rp^2) and d the distance along the ray to the top boundary,
 *
 *     x_r  = rho / H                        (0 at the ground, 1 at the top)
 *     x_mu = (d - d_min) / (d_max - d_min)  d_min = Rt - r (zenith), d_max = rho + H (horizon)
 *
 * which spends resolution where the optical depth changes fastest (grazing rays). Rays below the
 * horizon clamp to the grazing value: the shader zeroes their sunlight with the planet-shadow term.
 *
 * Built on the CPU (~50 k exp evaluations, a few ms) and uploaded as a half-float texture: no GPU bake,
 * no render-target format requirements, and it filters linearly on every WebGL2 device.
 */
import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  type Texture,
} from 'three';
import { type AtmosphereParams, extinctionAt } from './params';

/** Texture width: the mu axis. */
export const LUT_MU_SIZE = 128;
/** Texture height: the radius axis. */
export const LUT_R_SIZE = 32;
const INTEGRATION_STEPS = 96;

export interface LutGeometry {
  /** Planet radius, km. */
  rp: number;
  /** Radius of the top of the atmosphere, km. */
  rt: number;
  /** Horizon distance from the top boundary, sqrt(rt^2 - rp^2). */
  hb: number;
}

export function lutGeometry(p: AtmosphereParams): LutGeometry {
  const rp = p.radiusKm;
  const rt = rp + p.topKm;
  return { rp, rt, hb: Math.sqrt(rt * rt - rp * rp) };
}

/** Distance along the ray (r, mu) to the top boundary. */
export function distanceToTop(g: LutGeometry, r: number, mu: number): number {
  const disc = g.rt * g.rt - r * r * (1 - mu * mu);
  return -r * mu + Math.sqrt(Math.max(disc, 0));
}

/** Extinction coefficients sampled uniformly in altitude, so the integrator does table lookups, not exp(). */
export interface ExtinctionTable {
  readonly topKm: number;
  readonly n: number;
  /** (n + 1) x 3 values (1/km), altitude i * topKm / n. */
  readonly data: Float64Array;
}

export function makeExtinctionTable(p: AtmosphereParams, n = 2048): ExtinctionTable {
  const data = new Float64Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const e = extinctionAt(p, (i * p.topKm) / n);
    data[i * 3] = e[0];
    data[i * 3 + 1] = e[1];
    data[i * 3 + 2] = e[2];
  }
  return { topKm: p.topKm, n, data };
}

/**
 * Optical depth (per channel) from radius r along direction cosine mu to the top of the atmosphere:
 * composite Simpson over the path with linear interpolation of the extinction table.
 */
export function opticalDepthToTop(
  table: ExtinctionTable,
  g: LutGeometry,
  r: number,
  mu: number,
  steps = INTEGRATION_STEPS,
): [number, number, number] {
  const d = distanceToTop(g, r, mu);
  const ds = d / steps; // `steps` must be even
  const scale = table.n / table.topKm;
  const data = table.data;
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i <= steps; i++) {
    const s = i * ds;
    const rs = Math.sqrt(Math.max(r * r + s * s + 2 * r * mu * s, 0));
    const x = Math.min(Math.max((rs - g.rp) * scale, 0), table.n - 1e-9);
    const j = Math.floor(x);
    const f = x - j;
    const o = j * 3;
    const w = i === 0 || i === steps ? 1 : i % 2 === 1 ? 4 : 2;
    a += w * ((data[o] ?? 0) * (1 - f) + (data[o + 3] ?? 0) * f);
    b += w * ((data[o + 1] ?? 0) * (1 - f) + (data[o + 4] ?? 0) * f);
    c += w * ((data[o + 2] ?? 0) * (1 - f) + (data[o + 5] ?? 0) * f);
  }
  const k = ds / 3;
  return [a * k, b * k, c * k];
}

/** Map table coordinates (0..1 each) to the (r, mu) they encode. */
export function lutToRMu(g: LutGeometry, xMu: number, xR: number): { r: number; mu: number } {
  const rho = xR * g.hb;
  const r = Math.sqrt(rho * rho + g.rp * g.rp);
  const dMin = g.rt - r;
  const dMax = rho + g.hb;
  const d = dMin + xMu * (dMax - dMin);
  const mu =
    d < 1e-9 ? 1 : Math.min(1, Math.max(-1, (g.hb * g.hb - rho * rho - d * d) / (2 * r * d)));
  return { r, mu };
}

/** RGBA half-float texels, row-major: LUT_R_SIZE rows of LUT_MU_SIZE (alpha unused). */
export function buildTransmittanceLut(p: AtmosphereParams): Uint16Array {
  const g = lutGeometry(p);
  const table = makeExtinctionTable(p);
  const data = new Uint16Array(LUT_MU_SIZE * LUT_R_SIZE * 4);
  const one = DataUtils.toHalfFloat(1);
  let o = 0;
  for (let j = 0; j < LUT_R_SIZE; j++) {
    for (let i = 0; i < LUT_MU_SIZE; i++) {
      const { r, mu } = lutToRMu(g, i / (LUT_MU_SIZE - 1), j / (LUT_R_SIZE - 1));
      const od = opticalDepthToTop(table, g, r, mu);
      data[o++] = DataUtils.toHalfFloat(od[0]);
      data[o++] = DataUtils.toHalfFloat(od[1]);
      data[o++] = DataUtils.toHalfFloat(od[2]);
      data[o++] = one;
    }
  }
  return data;
}

export function createTransmittanceTexture(p: AtmosphereParams): Texture {
  const tex = new DataTexture(
    buildTransmittanceLut(p),
    LUT_MU_SIZE,
    LUT_R_SIZE,
    RGBAFormat,
    HalfFloatType,
  );
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
