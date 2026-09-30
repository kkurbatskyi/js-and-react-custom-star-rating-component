/**
 * Asteroid-belt particle model — deterministic sampling and the phase bookkeeping that keeps
 * Keplerian rotation float32-safe. No GPU code here, so it is unit-tested.
 *
 * Each rock is on its own gently eccentric, gently inclined orbit; on the GPU (asteroidBelt.glsl.ts)
 *
 *   M   = M0 + κ · a^−1.5 · Δt                     mean anomaly (ω = κ·a^−1.5: Kepler's third law)
 *   r   = a (1 − e cos M),  ν = M + 2e sin M + ϖ   first-order-in-e ellipse (epicycle) — plenty for
 *                                                   sub-pixel rocks, no Kepler solve per vertex
 *   pos = (r cos ν,  A sin(ν + φ),  −r sin ν)      prograde (counter-clockwise seen from +Y); the
 *                                                   vertical amplitude A gives the belt its thickness
 *
 * PRECISION: raw simDays (~9.8e3 at J2000 + 27 y) cannot reach a float32 shader (84 s steps). The
 * shader gets Δt = simDays − epoch, and M0 is the mean anomaly AT that epoch, recomputed on the CPU
 * in float64 whenever |Δt| grows past REBASE_DAYS. A rock's phase is therefore a pure function of
 * absolute simDays (the same on every visit), and never more than ~REBASE_DAYS·ω away from a
 * freshly rounded float32.
 */
import { TAU } from '../../core/math';
import { createRng } from '../../core/rng';
import type { AsteroidBelt } from '../../core/types';
import { SOLAR_MASS_KG } from '../../core/units';
import { orbitalPeriodDays } from '../../sim/kepler';

/** Re-anchor the phases when the shader's Δt exceeds this many days. */
export const REBASE_DAYS = 16;

export interface BeltParticles {
  count: number;
  /** a, e, ϖ, vertical amplitude (km, –, rad, km) */
  orbit: Float32Array;
  /** vertical phase, twinkle rate (integer multiples of the base rate), twinkle phase, tint −1..1 */
  rock: Float32Array;
  /** sprite size (px for rocks / km for dust), albedo, radius km, spare */
  look: Float32Array;
  /** Mean anomaly at simDays = 0, float64 (the source of truth for the phases). */
  meanAnomalyRef: Float64Array;
  /** Semi-major axes, float64 copy (for the CPU phase maths). */
  semiMajor: Float64Array;
}

export interface SampleOptions {
  count: number;
  /** 'rock' = crisp sprites in px; 'dust' = large soft sprites sized in km. */
  kind: 'rock' | 'dust';
}

function beta22(rng: { next(): number }): number {
  // Symmetric bump on [0,1] (mean of three uniforms): a soft belt profile with defined edges.
  return (rng.next() + rng.next() + rng.next()) / 3;
}

/** Samples a belt. Deterministic in (belt.seed, kind, count). */
export function sampleBelt(belt: AsteroidBelt, { count, kind }: SampleOptions): BeltParticles {
  const rng = createRng(belt.seed).fork(`belt-particles-${kind}`);
  const width = belt.outerRadiusKm - belt.innerRadiusKm;
  const orbit = new Float32Array(count * 4);
  const rock = new Float32Array(count * 4);
  const look = new Float32Array(count * 4);
  const meanAnomalyRef = new Float64Array(count);
  const semiMajor = new Float64Array(count);
  const sigmaA = belt.thicknessKm * (kind === 'dust' ? 0.36 : 0.28);
  for (let i = 0; i < count; i++) {
    // 60% a soft central bump, 40% flat: defined but feathered edges.
    const u = rng.chance(0.6) ? beta22(rng) : rng.next();
    const a = belt.innerRadiusKm + width * u;
    semiMajor[i] = a;
    orbit[i * 4] = a;
    orbit[i * 4 + 1] = Math.min(0.2, Math.abs(rng.normal(0, 0.07)));
    orbit[i * 4 + 2] = rng.range(0, TAU);
    orbit[i * 4 + 3] = Math.abs(rng.normal(0, sigmaA));
    rock[i * 4] = rng.range(0, TAU);
    rock[i * 4 + 1] = 1 + Math.floor(rng.next() * 4); // 1..4 × base twinkle rate
    rock[i * 4 + 2] = rng.range(0, TAU);
    rock[i * 4 + 3] = rng.range(-1, 1);
    meanAnomalyRef[i] = rng.range(0, TAU);
    if (kind === 'dust') {
      look[i * 4] = width * rng.range(0.1, 0.24); // sprite radius, km
      look[i * 4 + 1] = rng.range(0.6, 1);
      look[i * 4 + 2] = 0;
    } else {
      const radiusKm = Math.min(400, Math.max(0.6, 3 * Math.exp(rng.normal(0, 0.95))));
      look[i * 4] = Math.min(2.6, Math.max(0.9, 0.9 + 0.36 * Math.log2(1 + radiusKm / 3)));
      look[i * 4 + 1] = Math.exp(rng.normal(-0.15, 0.32)); // log-normal albedo
      look[i * 4 + 2] = radiusKm;
    }
  }
  return { count, orbit, rock, look, meanAnomalyRef, semiMajor };
}

/**
 * κ in ω = κ·a^−1.5 (rad/day, a in km): 2π/P(a₀)·a₀^1.5 for any a₀, from Kepler's third law.
 * `centralMassSolar` is the star's mass (the belt's own mass is negligible).
 */
export function beltKappa(belt: AsteroidBelt, centralMassSolar: number): number {
  const a0 = 0.5 * (belt.innerRadiusKm + belt.outerRadiusKm);
  const periodDays = orbitalPeriodDays(a0, centralMassSolar * SOLAR_MASS_KG);
  return (TAU / periodDays) * a0 ** 1.5;
}

/** Writes M0 = (M_ref + ω·epoch) mod 2π for every rock (float64 maths, float32 result). */
export function rebasePhases(
  p: Pick<BeltParticles, 'count' | 'meanAnomalyRef' | 'semiMajor'>,
  kappa: number,
  epochDays: number,
  out: Float32Array,
): void {
  for (let i = 0; i < p.count; i++) {
    const omega = kappa * (p.semiMajor[i] as number) ** -1.5;
    const x = (p.meanAnomalyRef[i] as number) + omega * epochDays;
    out[i] = x - TAU * Math.floor(x / TAU);
  }
}
