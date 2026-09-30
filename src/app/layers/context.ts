/**
 * What the concrete layers may read besides the FrameInfo: the engine (rig, active system), shared
 * assets, the universe and a few UI-state getters. Getters (not values) so layers always see the
 * current store state without subscribing.
 */
import { PerspectiveCamera, type Vector3, type WebGLRenderer } from 'three';
import type { FrameInfo } from '../../engine/contracts';
import type { Engine } from '../../engine/Engine';
import type { Quality, VisualFrame } from '../../render/contracts';
import type { Universe } from '../../universe/contracts';
import type { SystemAssetCache } from './SystemAssets';
import type { FullVisualCache } from './FullVisualCache';

export interface LayerContext {
  readonly engine: Engine;
  readonly assets: SystemAssetCache;
  readonly fullVisuals: FullVisualCache;
  universe(): Universe;
  selectedId(): string | null;
  hoveredId(): string | null;
  /** 0..1 orbit-line opacity (settings.orbits, animated). */
  orbitOpacity(): number;
  labelsEnabled(): boolean;
}

/** Screen projection of a camera-relative point. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** Distance along the view axis (> 0 in front of the camera). */
  depth: number;
}

/**
 * Project a camera-relative position (layer units, galactic axes) to CSS px. Returns false when
 * the point is behind the camera. The camera must have up-to-date matrices.
 */
export function projectRelative(
  rel: Vector3,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  scratch: Vector3,
  out: ScreenPoint,
): boolean {
  scratch.copy(rel).applyMatrix4(camera.matrixWorldInverse);
  if (scratch.z >= 0) return false;
  out.depth = -scratch.z;
  scratch.applyMatrix4(camera.projectionMatrix);
  out.x = (scratch.x * 0.5 + 0.5) * width;
  out.y = (0.5 - scratch.y * 0.5) * height;
  return true;
}

/** Pixels per radian at the view centre for a camera and viewport height (CSS px). */
export function pixelsPerRadian(camera: PerspectiveCamera, height: number): number {
  return height / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

export function onScreen(p: ScreenPoint, width: number, height: number, marginPx = 0): boolean {
  return p.x >= -marginPx && p.y >= -marginPx && p.x <= width + marginPx && p.y <= height + marginPx;
}

/** A reusable VisualFrame for a layer's visuals. */
export function createVisualFrame(renderer: WebGLRenderer, quality: Quality): VisualFrame {
  return {
    renderer,
    timeSec: 0,
    dtSec: 0,
    simDays: 0,
    camera: new PerspectiveCamera(), // replaced by the layer camera on every sync
    width: 1,
    height: 1,
    pixelRatio: 1,
    quality,
  };
}

/** Copy this frame's clocks and viewport into a layer's VisualFrame (no allocation). */
export function syncVisualFrame(vf: VisualFrame, frame: FrameInfo, camera: PerspectiveCamera): VisualFrame {
  vf.timeSec = frame.timeSec;
  vf.dtSec = frame.dtSec;
  vf.simDays = frame.simDays;
  vf.camera = camera;
  vf.width = frame.width;
  vf.height = frame.height;
  vf.pixelRatio = frame.pixelRatio;
  vf.quality = frame.quality;
  return vf;
}
