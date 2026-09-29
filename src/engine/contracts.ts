/**
 * Engine contracts: layers, camera snapshots, picking and labels.
 * Owned by the engine; extend freely but keep these shapes compatible.
 */
import type * as THREE from 'three';
import type { FocusTarget, SelectionRef, StarId, ViewLevel } from '../core/types';
import type { VisualFrame } from '../render/contracts';

/** Camera state for one frame, expressed in every frame of reference a layer might need. */
export interface CameraSnapshot {
  /** Camera position in the galactic frame (ly). ~1e-11 ly precision — use systemKm for in-system work. */
  galacticLy: THREE.Vector3;
  /** Star whose system frame is active (camera inside its system radius), or null. */
  systemId: StarId | null;
  /** Camera position relative to that star, in its ecliptic frame S, km. Null when systemId is null. */
  systemKm: THREE.Vector3 | null;
  /** Camera orientation in galactic axes. */
  quaternion: THREE.Quaternion;
  /** Vertical field of view, radians. */
  fovY: number;
  focus: FocusTarget;
  /** Distance from the camera to the focus target's centre, km. */
  focusDistanceKm: number;
}

export interface FrameInfo extends Omit<VisualFrame, 'camera'> {
  cam: CameraSnapshot;
  level: ViewLevel;
  /** 0..1 progress of an active flight, or null. */
  flight: number | null;
}

export interface LayerRenderSpec {
  near: number;
  far: number;
}

/**
 * A render layer: its own scene in its own units, rendered far→near with depth cleared in between.
 * The engine creates one PerspectiveCamera per layer at the origin with the shared orientation/fov.
 */
export interface Layer {
  readonly id: string;
  readonly scene: THREE.Scene;
  /** Prepare this frame. Return near/far (layer units) or null to skip rendering the layer. */
  update(frame: FrameInfo, camera: THREE.PerspectiveCamera): LayerRenderSpec | null;
  pick?(x: number, y: number, maxDistPx: number): PickHit | null;
  labels?(): LabelSpec[];
  dispose(): void;
}

export interface PickHit {
  ref: SelectionRef;
  distPx: number;
}

export interface LabelSpec {
  /** Stable key for DOM reuse. */
  key: string;
  ref?: SelectionRef;
  text: string;
  sub?: string;
  /** CSS px from the viewport's top-left. */
  x: number;
  y: number;
  priority: number;
  /** Optional marker drawn at (x, y). */
  marker?: 'ring' | 'dot' | null;
  /** CSS colour for the marker. */
  color?: string;
}
