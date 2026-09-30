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
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, type Texture } from 'three';
import { type AtmosphereParams, extinctionAt } from './params';

/** Texture width: the mu axis. */
export const LUT_MU_SIZE = 128;
/** Texture height: the radius axis. */
export const LUT_R_SIZE = 32;
const INTEGRATION_STEPS = 48;

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

/** Optical depth (per channel) from radius r along direction cosine mu to the top of the atmosphere. */
export function opticalDepthToTop(
  p: AtmosphereParams,
  g: LutGeometry,
  r: number,
  mu: number,
  steps = INTEGRATION_STEPS,
): [number, number, number] {
  const d = distanceToTop(g, r, mu);
  const ds = d / steps;
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) * ds;
    const rs = Math.sqrt(r * r + s * s + 2 * r * mu * s);
    const e = extinctionAt(p, rs - g.rp);
    a += e[0];
    b += e[1];
    c += e[2];
  }
  return [a * ds, b * ds, c * ds];
}

/** Map table coordinates (0..1 each) to the (r, mu) they encode. */
export function lutToRMu(g: LutGeometry, xMu: number, xR: number): { r: number; mu: number } {
  const rho = xR * g.hb;
  const r = Math.sqrt(rho * rho + g.rp * g.rp);
  const dMin = g.rt - r;
  const dMax = rho + g.hb;
  const d = dMin + xMu * (dMax - dMin);
  const mu = d < 1e-9 ? 1 : Math.min(1, Math.max(-1, (g.hb * g.hb - rho * rho - d * d) / (2 * r * d)));
  return { r, mu };
}

/** RGBA half-float texels, row-major: LUT_R_SIZE rows of LUT_MU_SIZE (alpha unused). */
export function buildTransmittanceLut(p: AtmosphereParams): Uint16Array {
  const g = lutGeometry(p);
  const data = new Uint16Array(LUT_MU_SIZE * LUT_R_SIZE * 4);
  const one = DataUtils.toHalfFloat(1);
  let o = 0;
  for (let j = 0; j < LUT_R_SIZE; j++) {
    for (let i = 0; i < LUT_MU_SIZE; i++) {
      const { r, mu } = lutToRMu(g, i / (LUT_MU_SIZE - 1), j / (LUT_R_SIZE - 1));
      const od = opticalDepthToTop(p, g, r, mu);
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
