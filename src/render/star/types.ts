import type { Matrix4, Vector3 } from 'three';
import type { VisualFrame } from '../contracts';

/** Per-frame geometry StarVisual computes once and shares with its sub-meshes. */
export interface StarFrameState {
  frame: VisualFrame;
  /** Camera-relative star centre, km. */
  positionKm: Vector3;
  /** Distance from the camera to the star centre, km (>= radius). */
  distanceKm: number;
  /** CSS pixels per radian. */
  ppr: number;
  /** Disc radius in CSS px (pinhole approximation). */
  discPx: number;
  /** km per device pixel at the star. */
  pxKm: number;
  /** 0..1 fade from the layer. */
  intensity: number;
  /** Spin axis in view space (unit). */
  axisView: Vector3;
  /** Camera orientation: view space -> world axes. */
  viewToWorld: Matrix4;
  /** Spin axis in world axes (unit). */
  axisWorld: Vector3;
}

/**
 * Gravitational-lensing state a black hole publishes every frame (mutated in place). The engine
 * forwards it to the lensing post effect: `effect.setTarget(uvX, uvY, einsteinRadiusPx, strength,
 * innerRadiusPx)` — see lensing.ts.
 */
export interface LensState {
  /** False when the hole is not a black hole, is off-screen or behind the camera. */
  active: boolean;
  /** Screen position of the hole, 0..1 from the bottom-left (GL texture coordinates). */
  uvX: number;
  uvY: number;
  /** Einstein radius in CSS px: theta_E = sqrt(2 r_s / D) * pixelsPerRadian. */
  einsteinRadiusPx: number;
  /** Radius (CSS px) inside which the visual draws its own lensed image; the effect leaves it alone. */
  innerRadiusPx: number;
  /** 0..1 fade. */
  strength: number;
  /** CSS height of the viewport the px values refer to. */
  viewportHeightPx: number;
}
