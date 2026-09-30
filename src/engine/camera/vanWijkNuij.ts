/**
 * Van Wijk & Nuij's optimal zoom-and-pan path.
 *
 *   J. J. van Wijk and W. A. A. Nuij, "Smooth and efficient zooming and panning",
 *   IEEE InfoVis 2003, pp. 15–22.
 *
 * A view is a centre `u` (along the straight line between the two endpoints) and a width `w` (how
 * much of the world the view shows). The path is a geodesic of a scale-invariant (hyperbolic) metric
 * on (u, w): it zooms out just enough that panning becomes cheap, pans, and zooms back in, at a
 * constant perceived speed. With u0 = 0, pan distance u1 and ρ the zoom/pan trade-off (≈ √2, the
 * paper's recommendation):
 *
 *   b_i = (w1² − w0² ± ρ⁴u1²) / (2 w_i ρ² u1)       (+ for i = 0, − for i = 1)
 *   r_i = ln(−b_i + √(b_i² + 1)) = −asinh(b_i)
 *   S   = (r1 − r0) / ρ                             total path length ("perceived distance")
 *   w(s) = w0 cosh r0 / cosh(ρs + r0)
 *   u(s) = w0/ρ² · cosh r0 · tanh(ρs + r0) − w0/ρ² · sinh r0
 *
 * PRECISION — Sidereal flies from a camera 10⁴ km above a planet to another star 10¹⁴ km away,
 * so b ≈ 10¹³:
 *  - `−b + √(b²+1)` cancels catastrophically to 0 (ln 0 = −∞). `−asinh(b)` has no cancellation.
 *  - `u(s)` as written subtracts two numbers ≈ u1 near the destination, losing everything below
 *    ~u1·10⁻¹⁶ (≈ 0.05 km at 50 ly — and all of it would be jitter). Using
 *    tanh A − tanh B = sinh(A − B) / (cosh A cosh B) we evaluate instead
 *        u(s)      = w(s) · sinh(ρs)     / (ρ² cosh r0)          — exact near s = 0
 *        u1 − u(s) = w(s) · sinh(ρ(S−s)) / (ρ² cosh r1)          — exact near s = S
 *    and callers anchor positions at the NEARER endpoint (see ./flight.ts).
 *  - w(s) is likewise evaluated from the nearer end (w0 cosh r0 = w1 cosh r1 only up to rounding),
 *    so w(0) = w0 and w(S) = w1 exactly.
 *
 * Degenerate case u1 → 0 (same centre, different zoom): b → ∞ and the formulas break down; the
 * geodesic is then a pure exponential zoom, w(s) = w0·e^{±ρs}, S = |ln(w1/w0)| / ρ.
 */

/** ρ — the paper's recommended zoom/pan trade-off (users preferred ≈ 1.42). */
export const VWN_RHO = Math.SQRT2;

/**
 * Below this pan distance (relative to the larger width) the path is treated as a pure zoom.
 * Large enough that b stays far from overflow in asinh/cosh, small enough to be invisible.
 */
const DEGENERATE_PAN = 1e-9;

export class ZoomPanPath {
  /** Pan distance between the two centres (same unit as the widths). */
  readonly u1: number;
  readonly w0: number;
  readonly w1: number;
  readonly rho: number;
  /** Total path length in the path metric (dimensionless). Duration should scale with it. */
  readonly S: number;
  /** True when the endpoints (almost) share a centre: a pure zoom. */
  readonly degenerate: boolean;

  private readonly r0: number;
  private readonly r1: number;
  /** ρ² cosh r0 · u1 and ρ² cosh r1 · u1: denominators of the pan fractions. */
  private readonly panScale0: number;
  private readonly panScale1: number;
  private readonly coshR0: number;
  private readonly coshR1: number;

  constructor(u1: number, w0: number, w1: number, rho: number = VWN_RHO) {
    if (!(w0 > 0 && w1 > 0) || !(u1 >= 0) || !(rho > 0)) {
      throw new RangeError(`ZoomPanPath: invalid endpoints u1=${u1} w0=${w0} w1=${w1} ρ=${rho}`);
    }
    this.u1 = u1;
    this.w0 = w0;
    this.w1 = w1;
    this.rho = rho;
    this.degenerate = u1 <= DEGENERATE_PAN * Math.max(w0, w1);
    if (this.degenerate) {
      this.r0 = 0;
      this.r1 = 0;
      this.coshR0 = 1;
      this.coshR1 = 1;
      this.panScale0 = 1;
      this.panScale1 = 1;
      this.S = Math.abs(Math.log(w1 / w0)) / rho;
      return;
    }
    const rho2 = rho * rho;
    // Form the numerators without squaring huge widths twice: (w1² − w0²) = (w1 − w0)(w1 + w0).
    const dw2 = (w1 - w0) * (w1 + w0);
    const pan2 = rho2 * rho2 * u1 * u1;
    const b0 = (dw2 + pan2) / (2 * w0 * rho2 * u1);
    const b1 = (dw2 - pan2) / (2 * w1 * rho2 * u1);
    this.r0 = -Math.asinh(b0);
    this.r1 = -Math.asinh(b1);
    this.S = (this.r1 - this.r0) / rho;
    this.coshR0 = Math.cosh(this.r0);
    this.coshR1 = Math.cosh(this.r1);
    this.panScale0 = rho2 * this.coshR0 * u1;
    this.panScale1 = rho2 * this.coshR1 * u1;
  }

  /** View width at path position s ∈ [0, S]; exactly w0 at 0 and w1 at S. */
  width(s: number): number {
    const S = this.S;
    if (s <= 0) return this.w0;
    if (s >= S) return this.w1;
    if (this.degenerate) {
      // Exponential zoom, evaluated from the nearer end.
      const sign = this.w1 >= this.w0 ? 1 : -1;
      return 2 * s <= S
        ? this.w0 * Math.exp(sign * this.rho * s)
        : this.w1 * Math.exp(-sign * this.rho * (S - s));
    }
    return 2 * s <= S
      ? (this.w0 * this.coshR0) / Math.cosh(this.rho * s + this.r0)
      : (this.w1 * this.coshR1) / Math.cosh(this.r1 - this.rho * (S - s));
  }

  /** u(s)/u1 ∈ [0, 1]: fraction of the pan completed. Accurate near s = 0 (use in the first half). */
  panFraction(s: number): number {
    if (s <= 0) return 0;
    if (s >= this.S) return 1;
    if (this.degenerate) return s / this.S;
    // Clamped: rounding can overshoot [0, 1] by an ulp far from the anchored end.
    return Math.min(1, (this.width(s) * Math.sinh(this.rho * s)) / this.panScale0);
  }

  /** 1 − u(s)/u1 ∈ [0, 1]: fraction of the pan remaining. Accurate near s = S (use in the second half). */
  panRemaining(s: number): number {
    if (s >= this.S) return 0;
    if (s <= 0) return 1;
    if (this.degenerate) return (this.S - s) / this.S;
    return Math.min(1, (this.width(s) * Math.sinh(this.rho * (this.S - s))) / this.panScale1);
  }
}
