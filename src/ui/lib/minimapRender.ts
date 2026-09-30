/**
 * Minimap raster: a top-down (galactic XZ) picture of the galaxy drawn once per seed from the
 * GalaxyModel — stellar density for brightness, `bulgeFraction` warm, `youngFraction` blue, dust
 * lanes darkening — plus a deterministic stipple of individual stars for texture. Everything the
 * live overlay draws on top of it (graticule, "you are here") is SVG in Minimap.tsx.
 */
import { clamp, smoothstep } from '../../core/math';
import { createRng } from '../../core/rng';
import type { GalaxyModel } from '../../core/types';

/** Ly from the centre to the map's edge: a little beyond the visible disk. */
export const mapExtentLy = (galaxy: GalaxyModel): number => galaxy.params.radiusLy * 1.12;

/** Galactic (x, z) in ly → pixel position on a `size`-px map (x right, z down). */
export function worldToMap(
  xLy: number,
  zLy: number,
  size: number,
  extentLy: number,
): [number, number] {
  const k = size / 2 / extentLy;
  return [size / 2 + xLy * k, size / 2 + zLy * k];
}

export function mapToWorld(
  px: number,
  py: number,
  size: number,
  extentLy: number,
): [number, number] {
  const k = extentLy / (size / 2);
  return [(px - size / 2) * k, (py - size / 2) * k];
}

type Rgb = readonly [number, number, number];
const INK: Rgb = [4, 6, 12];
const OLD: Rgb = [255, 205, 148]; // bulge / old population
const MID: Rgb = [232, 226, 212]; // ordinary disk
const YOUNG: Rgb = [146, 186, 255]; // OB associations along the arms

function mix3(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Population colour at a point, before brightness. */
function tint(young: number, bulge: number): [number, number, number] {
  const disk = mix3(MID, YOUNG, clamp(young * 1.15, 0, 1));
  return mix3(disk, OLD, smoothstep(0.08, 0.7, bulge));
}

/** Log-density → 0..1 brightness (calibrated: home ≈ 0.004 stars/ly³ ≈ 0.3, core ≈ 1). */
const brightness = (density: number): number =>
  clamp((Math.log10(Math.max(density, 1e-6)) + 3.4) / 3.1, 0, 1) ** 1.35;

/**
 * Draw the map into `canvas` (square, `pixels` device px). `samples` is the density grid
 * resolution; the browser's smoothing upsamples it, which reads as a soft glow.
 */
export function renderGalaxyMap(
  canvas: HTMLCanvasElement,
  galaxy: GalaxyModel,
  pixels: number,
  samples = 144,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = pixels;
  canvas.height = pixels;
  const extent = mapExtentLy(galaxy);

  const grid = document.createElement('canvas');
  grid.width = samples;
  grid.height = samples;
  const gctx = grid.getContext('2d');
  if (!gctx) return;
  const img = gctx.createImageData(samples, samples);
  const data = img.data;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const [x, z] = mapToWorld(i + 0.5, j + 0.5, samples, extent);
      const lum = brightness(galaxy.stellarDensity(x, 0, z));
      const dust = galaxy.dustDensity(x, 0, z);
      const [r, g, b] = tint(galaxy.youngFraction(x, 0, z), galaxy.bulgeFraction(x, 0, z));
      // Dust lanes eat light on the arms' inner edges; the disk fades into the ink at the rim.
      const v = lum * (1 - 0.62 * clamp(dust, 0, 1) ** 0.8);
      const o = (j * samples + i) * 4;
      data[o] = INK[0] + (r - INK[0]) * v;
      data[o + 1] = INK[1] + (g - INK[1]) * v;
      data[o + 2] = INK[2] + (b - INK[2]) * v;
      data[o + 3] = 255;
    }
  }
  gctx.putImageData(img, 0, 0);

  ctx.fillStyle = `rgb(${INK[0]} ${INK[1]} ${INK[2]})`;
  ctx.fillRect(0, 0, pixels, pixels);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(grid, 0, 0, pixels, pixels);

  // Stipple: individual stars, deterministic per galaxy.
  const rng = createRng(galaxy.params.seed).fork('minimap');
  const p: [number, number, number] = [0, 0, 0];
  const dot = Math.max(1, Math.round(pixels / 220));
  for (let n = 0; n < 2600; n++) {
    galaxy.samplePosition(rng, p);
    const [px, py] = worldToMap(p[0], p[2], pixels, extent);
    const [r, g, b] = tint(galaxy.youngFraction(p[0], 0, p[2]), galaxy.bulgeFraction(p[0], 0, p[2]));
    ctx.fillStyle = `rgb(${r | 0} ${g | 0} ${b | 0} / ${(0.25 + rng.next() * 0.6).toFixed(2)})`;
    ctx.fillRect(px, py, dot, dot);
  }

  // Vignette into the frame.
  const v = ctx.createRadialGradient(
    pixels / 2,
    pixels / 2,
    pixels * 0.34,
    pixels / 2,
    pixels / 2,
    pixels * 0.72,
  );
  v.addColorStop(0, 'rgb(4 6 12 / 0)');
  v.addColorStop(1, 'rgb(4 6 12 / 0.85)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, pixels, pixels);
}
