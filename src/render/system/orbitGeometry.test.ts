import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TAU } from '../../core/math';
import type { OrbitalElements } from '../../core/types';
import { eccentricAnomalyAt, orbitalPositionKm } from '../../sim/kepler';
import { equatorialFrame } from '../../sim/orientation';
import {
  OrbitCurve,
  OrbitTessellator,
  POINT_STRIDE,
  SEGMENT_STRIDE,
  type TessellationOptions,
  type TessellationView,
} from './orbitGeometry';

const ORBITS: Record<string, OrbitalElements> = {
  circular: {
    semiMajorAxisKm: 1.496e8,
    eccentricity: 0,
    inclinationRad: 0,
    longitudeAscendingNodeRad: 0,
    argumentPeriapsisRad: 0,
    meanAnomalyEpochRad: 0.4,
    periodDays: 365.25,
  },
  earthlike: {
    semiMajorAxisKm: 1.496e8,
    eccentricity: 0.0167,
    inclinationRad: 0.09,
    longitudeAscendingNodeRad: 0.7,
    argumentPeriapsisRad: 1.9,
    meanAnomalyEpochRad: 0.3,
    periodDays: 365.25,
  },
  eccentric: {
    semiMajorAxisKm: 5.8e7,
    eccentricity: 0.62,
    inclinationRad: 1.2,
    longitudeAscendingNodeRad: 2.4,
    argumentPeriapsisRad: 5.1,
    meanAnomalyEpochRad: 4.0,
    periodDays: 88,
  },
  neptunian: {
    semiMajorAxisKm: 4.5e9,
    eccentricity: 0.009,
    inclinationRad: 0.03,
    longitudeAscendingNodeRad: 3.3,
    argumentPeriapsisRad: 0.4,
    meanAnomalyEpochRad: 2.2,
    periodDays: 60_190,
  },
};

const noCamera = new Vector3();

describe('OrbitCurve', () => {
  it.each(Object.entries(ORBITS))('matches sim/kepler at the body (%s)', (_name, orbit) => {
    const curve = new OrbitCurve();
    const truth = new Vector3();
    for (const days of [0, 1234.5, 9800.25, 20_000.75]) {
      curve.set(orbit, null, null, noCamera);
      const E = eccentricAnomalyAt(orbit, days);
      const r = new Float64Array(3);
      curve.evalTo(E, r, 0);
      orbitalPositionKm(orbit, days, truth);
      expect(Math.hypot(r[0] - truth.x, r[1] - truth.y, r[2] - truth.z)).toBeLessThan(
        1e-9 * orbit.semiMajorAxisKm,
      );
    }
  });

  it('is camera-relative and follows a parent (moon orbits)', () => {
    const moon = ORBITS.eccentric as OrbitalElements;
    const parent = {
      orbit: ORBITS.earthlike as OrbitalElements,
      axialTiltRad: 0.4,
      axialAzimuthRad: 1.1,
      rotationPeriodHours: 20,
      tidallyLocked: false,
    };
    const frame = equatorialFrame(parent, new Quaternion());
    const parentS = new Vector3(1.2e8, -3e6, 4e7);
    const cameraS = new Vector3(1.2e8 + 5e3, -3e6 - 2e3, 4e7 + 9e3);
    const curve = new OrbitCurve().set(moon, frame, parentS, cameraS);
    const days = 4321.5;
    const E = eccentricAnomalyAt(moon, days);
    const r = new Float64Array(3);
    curve.evalTo(E, r, 0);
    const expected = orbitalPositionKm(moon, days, new Vector3())
      .applyQuaternion(frame)
      .add(parentS)
      .sub(cameraS);
    expect(Math.hypot(r[0] - expected.x, r[1] - expected.y, r[2] - expected.z)).toBeLessThan(1e-3);
  });

  it('tangent is the unit direction of motion', () => {
    const orbit = ORBITS.eccentric as OrbitalElements;
    const curve = new OrbitCurve().set(orbit, null, null, noCamera);
    const E = 1.3;
    const t = new Float64Array(3);
    curve.tangentTo(E, t, 0);
    expect(Math.hypot(t[0], t[1], t[2])).toBeCloseTo(1, 12);
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    curve.evalTo(E - 1e-6, a, 0);
    curve.evalTo(E + 1e-6, b, 0);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    expect((b[0] - a[0]) / d).toBeCloseTo(t[0], 6);
    expect((b[1] - a[1]) / d).toBeCloseTo(t[1], 6);
    expect((b[2] - a[2]) / d).toBeCloseTo(t[2], 6);
  });
});

const OPTS: TessellationOptions = { baseSegments: 96, tolerancePx: 0.2, minDepthKm: 0.5 };

interface Scene {
  name: string;
  orbit: OrbitalElements;
  /** Camera position relative to the orbit point at eccentric anomaly `at`, km, S axes. */
  offset: [number, number, number];
  at: number;
  /** Look at the orbit point (true) or at the star (false). */
  lookAtPoint: boolean;
}

const SCENES: Scene[] = [
  {
    name: 'overview',
    orbit: ORBITS.earthlike as OrbitalElements,
    offset: [0, 3e8, 4e8],
    at: 0,
    lookAtPoint: false,
  },
  {
    name: 'inside the orbit',
    orbit: ORBITS.circular as OrbitalElements,
    offset: [-1.2e8, 2e6, 1e7],
    at: 0,
    lookAtPoint: false,
  },
  {
    name: '20 000 km from the line',
    orbit: ORBITS.earthlike as OrbitalElements,
    offset: [12_000, 9000, 13_000],
    at: 1,
    lookAtPoint: true,
  },
  {
    name: '300 km from the line',
    orbit: ORBITS.earthlike as OrbitalElements,
    offset: [150, -200, 180],
    at: 4,
    lookAtPoint: true,
  },
  {
    name: 'eccentric, close',
    orbit: ORBITS.eccentric as OrbitalElements,
    offset: [2e5, 1e5, -3e5],
    at: 0.05,
    lookAtPoint: true,
  },
  {
    name: 'far planet',
    orbit: ORBITS.neptunian as OrbitalElements,
    offset: [1e6, 4e5, 2e6],
    at: 3,
    lookAtPoint: true,
  },
];

function setup(scene: Scene): {
  curve: OrbitCurve;
  view: TessellationView;
  headE: number;
} {
  const base = new OrbitCurve().set(scene.orbit, null, null, noCamera);
  const p = new Float64Array(3);
  base.evalTo(scene.at, p, 0);
  const cameraS = new Vector3(
    p[0] + scene.offset[0],
    p[1] + scene.offset[1],
    p[2] + scene.offset[2],
  );
  const curve = new OrbitCurve().set(scene.orbit, null, null, cameraS);
  const target = scene.lookAtPoint ? new Vector3(p[0], p[1], p[2]) : new Vector3();
  const fwd = target.sub(cameraS).normalize();
  const view: TessellationView = { fx: fwd.x, fy: fwd.y, fz: fwd.z, focalPx: 580 };
  return { curve, view, headE: scene.at + 0.9 };
}

/** Distance from point p to segment ab (3D). */
function pointSegment(
  px: number,
  py: number,
  pz: number,
  pts: Float64Array,
  ia: number,
  ib: number,
): number {
  const ax = pts[ia];
  const ay = pts[ia + 1];
  const az = pts[ia + 2];
  const bx = pts[ib] - ax;
  const by = pts[ib + 1] - ay;
  const bz = pts[ib + 2] - az;
  const len2 = bx * bx + by * by + bz * bz;
  let t = len2 > 0 ? ((px - ax) * bx + (py - ay) * by + (pz - az) * bz) / len2 : 0;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - ax - bx * t, py - ay - by * t, pz - az - bz * t);
}

describe('OrbitTessellator', () => {
  it.each(SCENES)('stays within the pixel tolerance: $name', (scene) => {
    const { curve, view, headE } = setup(scene);
    const tess = new OrbitTessellator(2200);
    const n = tess.build(curve, headE, view, OPTS);
    const pts = tess.points;
    expect(n).toBeGreaterThan(96);
    expect(n).toBeLessThan(2200);

    // Ages run 0 → 2π monotonically and the strip closes on the body.
    expect(pts[6]).toBe(0);
    expect(pts[(n - 1) * POINT_STRIDE + 6]).toBeCloseTo(TAU, 12);
    for (let i = 1; i < n; i++) {
      expect(pts[i * POINT_STRIDE + 6]).toBeGreaterThan(pts[(i - 1) * POINT_STRIDE + 6]);
    }
    const last = (n - 1) * POINT_STRIDE;
    expect(
      Math.hypot(pts[0] - pts[last], pts[1] - pts[last + 1], pts[2] - pts[last + 2]),
    ).toBeLessThan(1e-7 * scene.orbit.semiMajorAxisKm);

    // Worst deviation of the true curve from the polyline, in pixels, over visible samples.
    const r = new Float64Array(3);
    let worst = 0;
    let seg = 0;
    const samples = 6000;
    for (let k = 0; k <= samples; k++) {
      const age = (TAU * k) / samples;
      curve.evalTo(headE - age, r, 0);
      const depth = r[0] * view.fx + r[1] * view.fy + r[2] * view.fz;
      if (depth < OPTS.minDepthKm * 4) continue;
      while (seg + 2 < n && pts[(seg + 1) * POINT_STRIDE + 6] < age) seg++;
      let d = pointSegment(r[0], r[1], r[2], pts, seg * POINT_STRIDE, (seg + 1) * POINT_STRIDE);
      if (seg > 0) {
        d = Math.min(
          d,
          pointSegment(r[0], r[1], r[2], pts, (seg - 1) * POINT_STRIDE, seg * POINT_STRIDE),
        );
      }
      if (seg + 2 < n) {
        d = Math.min(
          d,
          pointSegment(r[0], r[1], r[2], pts, (seg + 1) * POINT_STRIDE, (seg + 2) * POINT_STRIDE),
        );
      }
      const dist = Math.max(Math.hypot(r[0], r[1], r[2]), OPTS.minDepthKm);
      worst = Math.max(worst, (d * view.focalPx) / dist);
    }
    expect(worst).toBeLessThan(2 * OPTS.tolerancePx);
  });

  it('writes clipped segments that never reach behind the near plane', () => {
    // Camera inside the ring, looking across it at the star: the near arc lies behind the camera.
    const scene = SCENES[1] as Scene;
    const { curve, view, headE } = setup(scene);
    const tess = new OrbitTessellator(1200);
    const n = tess.build(curve, headE, view, OPTS);
    const out = new Float32Array(1200 * SEGMENT_STRIDE);
    const segs = tess.writeSegments(out, view, OPTS.minDepthKm);
    expect(segs).toBeGreaterThan(0);
    expect(segs).toBeLessThan(n - 1);
    for (let s = 0; s < segs; s++) {
      for (const o of [s * SEGMENT_STRIDE, s * SEGMENT_STRIDE + 7]) {
        const depth = out[o] * view.fx + out[o + 1] * view.fy + out[o + 2] * view.fz;
        const mag = Math.hypot(out[o], out[o + 1], out[o + 2]);
        expect(depth).toBeGreaterThan(Math.max(OPTS.minDepthKm * 0.9, 5e-7 * mag));
      }
    }
  });

  it('keeps float32 precision near the camera (1 km resolution at 1 AU)', () => {
    // A camera 300 km from the line: vertices are ~hundreds of km from it, so float32 holds mm.
    const scene = SCENES[3] as Scene;
    const { curve, view, headE } = setup(scene);
    const tess = new OrbitTessellator(1200);
    tess.build(curve, headE, view, OPTS);
    const out = new Float32Array(1200 * SEGMENT_STRIDE);
    const segs = tess.writeSegments(out, view, OPTS.minDepthKm);
    let nearest = Number.POSITIVE_INFINITY;
    for (let s = 0; s < segs; s++) {
      nearest = Math.min(
        nearest,
        Math.hypot(
          out[s * SEGMENT_STRIDE],
          out[s * SEGMENT_STRIDE + 1],
          out[s * SEGMENT_STRIDE + 2],
        ),
      );
    }
    expect(nearest).toBeLessThan(1e4);
  });
});
