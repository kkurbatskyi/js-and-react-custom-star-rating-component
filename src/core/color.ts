/**
 * Colour science: blackbody chromaticity, sRGB transfer functions, spectral classification.
 *
 * Every colour in Sidereal's data model is LINEAR sRGB (docs/ARCHITECTURE.md §5). Only CSS
 * strings are gamma-encoded.
 *
 * Blackbody colour is computed from first principles: Planck's law B(λ, T) is integrated against
 * the CIE 1931 2° colour-matching functions (Wyman, Sloan & Shirley 2013 multi-lobe analytic fit,
 * JCGT 2(2), max error ≈ 1 % of peak) over 360–830 nm, converted XYZ → linear sRGB (D65 white,
 * IEC 61966-2-1 primaries), negative lobes clamped to 0 and normalised so max(R, G, B) = 1.
 * The Sun (5772 K) comes out a very slightly warm white; ~6500 K is neutral (D65 ≈ 6504 K).
 * Results are memoised in a 512-entry LUT uniform in reciprocal temperature (mireds), where
 * colour varies nearly linearly.
 */
import type { RGB, SpectralClass } from './types';

// ───────────────────────────────────────────── CIE 1931 2° CMFs (Wyman–Sloan–Shirley 2013)

/** Piecewise Gaussian: σ1 left of the mean, σ2 right of it. */
function lobe(lambda: number, mu: number, sigma1: number, sigma2: number): number {
  const t = (lambda - mu) / (lambda < mu ? sigma1 : sigma2);
  return Math.exp(-0.5 * t * t);
}

function cmfX(l: number): number {
  return (
    1.056 * lobe(l, 599.8, 37.9, 31.0) +
    0.362 * lobe(l, 442.0, 16.0, 26.7) -
    0.065 * lobe(l, 501.1, 20.4, 26.2)
  );
}
function cmfY(l: number): number {
  return 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
}
function cmfZ(l: number): number {
  return 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
}

const LAMBDA_MIN_NM = 360;
const LAMBDA_MAX_NM = 830;
const LAMBDA_STEP_NM = 1;
/** Second radiation constant c₂ = hc/k in nm·K (CODATA 2018). */
const C2_NM_K = 1.438_776_877e7;

let cmfTable: Float64Array | null = null;

/** CMF samples (x̄, ȳ, z̄ interleaved) on the integration grid, built on first use. */
function getCmfTable(): Float64Array {
  if (cmfTable) return cmfTable;
  const n = Math.round((LAMBDA_MAX_NM - LAMBDA_MIN_NM) / LAMBDA_STEP_NM) + 1;
  const t = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const l = LAMBDA_MIN_NM + i * LAMBDA_STEP_NM;
    t[i * 3] = cmfX(l);
    t[i * 3 + 1] = cmfY(l);
    t[i * 3 + 2] = cmfZ(l);
  }
  cmfTable = t;
  return t;
}

/**
 * CIE XYZ of a blackbody at `tempK`, up to an arbitrary positive scale (Y is proportional to
 * luminance within the visible band). Writes into `out`.
 */
export function blackbodyXYZ(
  tempK: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const cmf = getCmfTable();
  const n = cmf.length / 3;
  let x = 0;
  let y = 0;
  let z = 0;
  if (tempK > 0) {
    for (let i = 0; i < n; i++) {
      const l = LAMBDA_MIN_NM + i * LAMBDA_STEP_NM;
      // Planck spectral radiance without the constant 2hc² prefactor (it cancels on normalising);
      // λ in µm keeps magnitudes sane. expm1 stays accurate in the Rayleigh–Jeans limit.
      const lUm = l * 1e-3;
      const b = 1 / (lUm * lUm * lUm * lUm * lUm * Math.expm1(C2_NM_K / (l * tempK)));
      x += b * (cmf[i * 3] as number);
      y += b * (cmf[i * 3 + 1] as number);
      z += b * (cmf[i * 3 + 2] as number);
    }
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** CIE XYZ → linear sRGB (D65), IEC 61966-2-1 matrix (Lindbloom). Components may be negative. */
export function xyzToLinearSrgb(
  x: number,
  y: number,
  z: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  out[0] = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  out[1] = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  out[2] = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return out;
}

const scratchXYZ: [number, number, number] = [0, 0, 0];
const scratchRGB: [number, number, number] = [0, 0, 0];

/** Un-memoised blackbody colour (see module doc). tempK ≤ 0 / NaN → black. */
export function blackbodyRGBExact(tempK: number): RGB {
  if (!(tempK > 0)) return [0, 0, 0];
  const [x, y, z] = blackbodyXYZ(tempK, scratchXYZ);
  const rgb = xyzToLinearSrgb(x, y, z, scratchRGB);
  const r = Math.max(0, rgb[0]);
  const g = Math.max(0, rgb[1]);
  const b = Math.max(0, rgb[2]);
  const m = Math.max(r, g, b);
  if (!(m > 0) || !Number.isFinite(m)) return [0, 0, 0];
  return [r / m, g / m, b / m];
}

// ───────────────────────────────────────────── Memoised LUT (uniform in mireds)

export const BLACKBODY_MIN_K = 1000;
export const BLACKBODY_MAX_K = 40_000;
const LUT_SIZE = 512;
const MIRED_HI = 1e6 / BLACKBODY_MIN_K; // 1000
const MIRED_LO = 1e6 / BLACKBODY_MAX_K; // 25
let lut: Float32Array | null = null;

function getLut(): Float32Array {
  if (lut) return lut;
  const t = new Float32Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const mired = MIRED_LO + ((MIRED_HI - MIRED_LO) * i) / (LUT_SIZE - 1);
    const c = blackbodyRGBExact(1e6 / mired);
    t[i * 3] = c[0];
    t[i * 3 + 1] = c[1];
    t[i * 3 + 2] = c[2];
  }
  lut = t;
  return t;
}

/**
 * Allocation-free blackbody colour: writes linear sRGB (max component = 1) into `out[offset..+2]`.
 * tempK is clamped to [1000, 40 000] K; tempK ≤ 0 or NaN writes black. Ideal for filling
 * vertex-colour buffers.
 */
export function blackbodyRGBInto(
  tempK: number,
  out: { [index: number]: number },
  offset = 0,
): void {
  if (!(tempK > 0)) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    return;
  }
  const table = getLut();
  const mired = Math.min(MIRED_HI, Math.max(MIRED_LO, 1e6 / tempK));
  const f = ((mired - MIRED_LO) / (MIRED_HI - MIRED_LO)) * (LUT_SIZE - 1);
  const i = Math.min(LUT_SIZE - 2, Math.floor(f));
  const w = f - i;
  const j = i * 3;
  const r = (table[j] as number) + ((table[j + 3] as number) - (table[j] as number)) * w;
  const g = (table[j + 1] as number) + ((table[j + 4] as number) - (table[j + 1] as number)) * w;
  const b = (table[j + 2] as number) + ((table[j + 5] as number) - (table[j + 2] as number)) * w;
  const m = Math.max(r, g, b); // re-normalise: the max channel can dip between samples
  out[offset] = r / m;
  out[offset + 1] = g / m;
  out[offset + 2] = b / m;
}

/** Blackbody chromaticity as linear sRGB, max component = 1 (memoised; see `blackbodyRGBInto`). */
export function blackbodyRGB(tempK: number): RGB {
  const out: [number, number, number] = [0, 0, 0];
  blackbodyRGBInto(tempK, out);
  return out;
}

// ───────────────────────────────────────────── RGB utilities

/** Rec. 709 / sRGB relative luminance of a linear colour. */
export function rgbLuminance(rgb: RGB): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/**
 * Scale chroma about the luminance axis by `amount` (1 = unchanged, 0 = grey, 1.25 = the star
 * colour boost from docs/ARCHITECTURE.md §9). Negative results clamp to 0, then the colour is
 * rescaled so its brightest component is unchanged — a max-normalised chromaticity stays
 * max-normalised.
 */
export function saturateRGB(rgb: RGB, amount: number): RGB {
  const y = rgbLuminance(rgb);
  const r = Math.max(0, y + (rgb[0] - y) * amount);
  const g = Math.max(0, y + (rgb[1] - y) * amount);
  const b = Math.max(0, y + (rgb[2] - y) * amount);
  const maxIn = Math.max(rgb[0], rgb[1], rgb[2]);
  const maxOut = Math.max(r, g, b);
  const k = maxOut > 0 ? maxIn / maxOut : 0;
  return [r * k, g * k, b * k];
}

/** Linear interpolation between two colours. */
export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** sRGB transfer function (IEC 61966-2-1) decode: encoded 0..1 → linear. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB transfer function encode: linear → encoded 0..1. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function hexByte(linear: number): string {
  const v = Math.round(linearToSrgb(linear < 0 ? 0 : linear > 1 ? 1 : linear) * 255);
  return v.toString(16).padStart(2, '0');
}

/** Linear-sRGB colour → CSS '#rrggbb' (gamma-encoded, each channel clamped to 0..1). */
export function rgbToCss(linearRgb: RGB): string {
  return `#${hexByte(linearRgb[0])}${hexByte(linearRgb[1])}${hexByte(linearRgb[2])}`;
}

/** CSS '#rgb' / '#rrggbb' → linear sRGB. Returns null for anything else. */
export function cssToRgb(css: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return null;
  let hex = m[1] as string;
  if (hex.length === 3) hex = hex.replace(/./g, (ch) => ch + ch);
  const n = Number.parseInt(hex, 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

// ───────────────────────────────────────────── Spectral classification

/**
 * Main-sequence effective temperature by spectral subtype, from Pecaut & Mamajek (2013, ApJS 208, 9;
 * online table v2019). Code = class index × 10 + subclass with O=0, B=1, A=2, F=3, G=4, K=5, M=6.
 */
const SPECTRAL_TABLE: readonly (readonly [code: number, teffK: number])[] = [
  [3, 44900],
  [4, 42900],
  [5, 41400],
  [6, 38800],
  [7, 36500],
  [8, 34500],
  [9, 32500],
  [9.5, 31900],
  [10, 31400],
  [10.5, 29000],
  [11, 26000],
  [11.5, 24500],
  [12, 20600],
  [12.5, 18500],
  [13, 17000],
  [14, 16400],
  [15, 15700],
  [16, 14500],
  [17, 14000],
  [18, 12500],
  [19, 10700],
  [19.5, 10400],
  [20, 9700],
  [21, 9300],
  [22, 8800],
  [23, 8600],
  [24, 8250],
  [25, 8100],
  [26, 7910],
  [27, 7760],
  [28, 7590],
  [29, 7400],
  [30, 7220],
  [31, 7020],
  [32, 6820],
  [33, 6750],
  [34, 6670],
  [35, 6550],
  [36, 6350],
  [37, 6280],
  [38, 6180],
  [39, 6050],
  [39.5, 5990],
  [40, 5930],
  [41, 5860],
  [42, 5770],
  [43, 5720],
  [44, 5680],
  [45, 5660],
  [46, 5600],
  [47, 5550],
  [48, 5480],
  [49, 5380],
  [50, 5270],
  [51, 5170],
  [52, 5100],
  [53, 4830],
  [54, 4600],
  [55, 4440],
  [56, 4300],
  [57, 4100],
  [58, 3990],
  [59, 3930],
  [60, 3850],
  [60.5, 3770],
  [61, 3660],
  [61.5, 3620],
  [62, 3560],
  [62.5, 3470],
  [63, 3430],
  [63.5, 3270],
  [64, 3210],
  [64.5, 3110],
  [65, 3060],
  [65.5, 2930],
  [66, 2810],
  [66.5, 2740],
  [67, 2680],
  [67.5, 2630],
  [68, 2570],
  [68.5, 2420],
  [69, 2380],
  [69.5, 2350],
];
const CLASS_LETTERS: readonly SpectralClass[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];

/** Continuous subtype code for a temperature (interpolated in log T), clamped to O3…M9.5. */
function spectralCode(tempK: number): number {
  const first = SPECTRAL_TABLE[0] as readonly [number, number];
  const last = SPECTRAL_TABLE[SPECTRAL_TABLE.length - 1] as readonly [number, number];
  if (!(tempK < first[1])) return first[0];
  if (!(tempK > last[1])) return last[0];
  for (let i = 1; i < SPECTRAL_TABLE.length; i++) {
    const hot = SPECTRAL_TABLE[i - 1] as readonly [number, number];
    const cool = SPECTRAL_TABLE[i] as readonly [number, number];
    if (tempK >= cool[1]) {
      const t = Math.log(hot[1] / tempK) / Math.log(hot[1] / cool[1]);
      return hot[0] + (cool[0] - hot[0]) * t;
    }
  }
  return last[0];
}

/**
 * Harvard class and subclass (0–9.5 in half steps) of a main-sequence star with this effective
 * temperature. Covers O3…M9.5; hotter/cooler temperatures clamp to the ends.
 */
export function spectralSubtypeOf(tempK: number): { letter: SpectralClass; subclass: number } {
  const code = Math.round(spectralCode(tempK) * 2) / 2;
  const cls = Math.min(6, Math.floor(code / 10));
  return { letter: CLASS_LETTERS[cls] as SpectralClass, subclass: code - cls * 10 };
}

/** Harvard class letter (O, B, A, F, G, K or M) for an effective temperature. */
export function spectralClassOf(tempK: number): SpectralClass {
  return spectralSubtypeOf(tempK).letter;
}

/** Temperature part of an MK type, e.g. 5772 K → "G2", 3100 K → "M4.5" (append "V", "III", …). */
export function spectralTypeCode(tempK: number): string {
  const { letter, subclass } = spectralSubtypeOf(tempK);
  return `${letter}${subclass}`;
}
