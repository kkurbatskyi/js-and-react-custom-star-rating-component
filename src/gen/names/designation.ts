/**
 * Catalogue designations: `SDR <level>-<cx>.<cy>.<cz>-<index>` ("Sidereal Draw Reference").
 *
 * Each cell coordinate is zig-zag encoded (0, −1, 1, −2, 2 … → 0, 1, 2, 3, 4 …) and written in upper-case
 * base 36, so the designation is short, sign-free, unique and exactly reversible: "SDR 1-B6.0.VC-37".
 */
import type { Vec3Tuple } from '../../core/types';

const zigzag = (c: number): number => (c >= 0 ? 2 * c : -2 * c - 1);
const unzigzag = (z: number): number => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);
const enc = (c: number): string => zigzag(c).toString(36).toUpperCase();

export function designationOf(level: number, cell: Vec3Tuple, index: number): string {
  return `SDR ${level}-${enc(cell[0])}.${enc(cell[1])}.${enc(cell[2])}-${index}`;
}

const DESIGNATION = /^SDR\s*(\d)-([0-9A-Z]{1,9})\.([0-9A-Z]{1,9})\.([0-9A-Z]{1,9})-(\d{1,7})$/i;

export interface ParsedDesignation {
  level: number;
  cell: Vec3Tuple;
  index: number;
}

/** Inverse of `designationOf`; null for anything that is not a canonical designation. */
export function parseDesignation(text: string): ParsedDesignation | null {
  const m = DESIGNATION.exec(text.trim());
  if (!m) return null;
  const cell: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const raw = (m[2 + a] as string).toUpperCase();
    const z = Number.parseInt(raw, 36);
    if (!Number.isSafeInteger(z) || z.toString(36).toUpperCase() !== raw) return null; // non-canonical
    cell[a] = unzigzag(z) + 0; // "+ 0" folds -0 into 0
  }
  return { level: Number(m[1]), cell, index: Number(m[5]) };
}
