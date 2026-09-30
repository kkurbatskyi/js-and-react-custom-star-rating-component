/**
 * Engine contracts: layers, camera snapshots, picking and labels.
 * Owned by the engine; extend freely but keep these shapes compatible.
 */
import type * as THREE from 'three';
import type { FocusTarget, SelectionRef, StarId, ViewLevel } from '../core/types';
import type { Quality, ScreenDisc, VisualFrame } from '../render/contracts';

/** Camera state for one frame, expressed in every frame of reference a layer might need. */
export interface CameraSnapshot {
  focus: FocusTarget;
  /**
   * AUTHORITATIVE camera position: offset from the focus target's centre, km, in galactic axes.
   * Everything else below is derived from it each frame (float64 on the CPU).
   */
  focusOffsetKm: THREE.Vector3;
  /** |focusOffsetKm|. */
  focusDistanceKm: number;
  /** Camera position in the galactic frame (ly). Fine for galaxy/starfield; never for in-system work. */
  galacticLy: THREE.Vector3;
  /**
   * Star whose system frame is active, or null. Only ever the focus star or a flight endpoint star,
   * and only while the camera is inside that system's `radiusKm` (with enter/exit hysteresis).
   * Never a per-frame nearest-star search.
   */
  systemId: StarId | null;
  /** Camera position relative to that star, in its ecliptic frame S, km. Null when systemId is null. */
  systemKm: THREE.Vector3 | null;
  /** Camera orientation in galactic axes. */
  quaternion: THREE.Quaternion;
  /** Vertical field of view, radians. */
  fovY: number;
}

export interface FrameInfo extends Omit<VisualFrame, 'camera'> {
  cam: CameraSnapshot;
  level: ViewLevel;
  /** 0..1 progress of an active flight, or null. */
  flight: number | null;
  /** 0..1 normalised travel speed (drives the travel FX and audio). */
  travel: number;
  /**
   * Screen position (CSS px) and 0..1 visibility (0 = off-screen/occluded) of the active system's star,
   * for lens flares and god-rays. Null outside systems.
   */
  sun: { x: number; y: number; visibility: number } | null;
  /**
   * Unit direction of the camera's motion in VIEW space (x right, y up, −z forward) while travelling;
   * zero vector when still. For the travel FX (streak direction) and audio panning.
   */
  travelDirection?: THREE.Vector3;
}

/**
 * One depth slice of a layer. Slices render far→near with the depth buffer cleared between them, so
 * each gets a tight near/far (e.g. a moon at 1 km altitude in front of its ringed giant 1.2e6 km away).
 */
export interface LayerRenderSpec {
  near: number;
  far: number;
  /** Scene to draw for this slice; defaults to the layer's `scene`. */
  scene?: THREE.Scene;
}

/**
 * A render layer: its own scene(s) in its own units, rendered far→near after all farther layers,
 * depth cleared in between. The engine owns one PerspectiveCamera per layer at the origin with the
 * shared orientation/fov; near/far come from the returned slices.
 */
export interface Layer {
  readonly id: string;
  readonly scene: THREE.Scene;
  /** Prepare this frame. Return depth slices far→near, or null / [] to skip the layer. */
  update(frame: FrameInfo, camera: THREE.PerspectiveCamera): LayerRenderSpec[] | null;
  /**
   * Screen discs of opaque bodies in this layer (planets, stars). Picks and labels from FARTHER layers
   * that fall inside a disc are discarded; a pick inside a disc resolves to that body with distPx = 0.
   */
  occluders?(out: ScreenDisc[]): void;
  pick?(x: number, y: number, maxDistPx: number): PickHit | null;
  labels?(out: LabelSpec[]): void;
  /** Rebuild quality-dependent resources (particle counts, bake sizes). */
  setQuality?(q: Quality): void;
  dispose(): void;
}

export interface PickHit {
  ref: SelectionRef;
  distPx: number;
  /**
   * Screen position (CSS px) of the picked object, when known. Lets the engine discard hits that lie
   * behind a nearer layer's occluder disc; without it the pointer position is tested instead.
   */
  x?: number;
  y?: number;
}

/** Shared label priority scale: priority = tier * 1000 + rank-within-tier (0..999). */
export const LabelTier = {
  galaxyFeature: 0,
  star: 1,
  moon: 2,
  planet: 3,
  selected: 4,
  focus: 5,
} as const;

export interface LabelSpec {
  /** Stable key for DOM reuse — the ref id when there is one. */
  key: string;
  ref?: SelectionRef;
  text: string;
  sub?: string;
  /** CSS px from the viewport's top-left. */
  x: number;
  y: number;
  /** See LabelTier. */
  priority: number;
  /** Optional marker drawn at (x, y). */
  marker?: 'ring' | 'dot' | null;
  /** CSS colour for the marker. */
  color?: string;
}
