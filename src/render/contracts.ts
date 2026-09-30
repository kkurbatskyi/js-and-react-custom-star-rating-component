/**
 * Rendering contracts shared by all visual modules and the engine.
 *
 * GOLDEN RULE — camera-relative rendering:
 *   Every layer camera sits at the ORIGIN. Every position handed to a visual is already
 *   camera-relative, computed in float64 on the CPU, in "layer world space":
 *   galactic-aligned axes (see src/core/types.ts) and the layer's own units
 *   (light-years for galaxy/starfield, kilometres for system/planet).
 *   Never place objects at absolute coordinates and move the camera — float32 on the GPU
 *   cannot represent a planet's surface 1.5e8 km from its star.
 *
 * Visuals are plain classes: construct → add `object` to a scene → call `update()` every
 * frame → `dispose()` when done. They know nothing about the engine, the store or the UI.
 */
import type * as THREE from 'three';
import type { BodyBase, BodyId, StarBlock, StarId } from '../core/types';
import type { LensState } from './star/types';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Per-frame context handed to every visual. */
export interface VisualFrame {
  /** The shared renderer (for GPU bakes / render-to-texture; never change its global state permanently). */
  renderer: THREE.WebGLRenderer;
  /** Real seconds since app start (animation clock). */
  timeSec: number;
  dtSec: number;
  /**
   * Simulation clock in days (orbits, spin). NEVER pass it raw to a shader: float32 has ~84 s
   * resolution at today's J2000 offset. Pass phases computed on the CPU, or (simDays − epoch) with a
   * per-visual epoch.
   */
  simDays: number;
  /** The layer camera: at the origin, oriented, projection (fov/aspect/near/far) already set. */
  camera: THREE.PerspectiveCamera;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  quality: Quality;
}

/** Result of screen-space picking. */
export interface ScreenHit {
  id: string;
  distPx: number;
}

/** A screen-space disc (CSS px) — used for occlusion of picking/labels by nearer layers. */
export interface ScreenDisc {
  x: number;
  y: number;
  radiusPx: number;
}

/** A labelable point without text (the consumer resolves names lazily). */
export interface ScreenAnchor {
  id: string;
  x: number;
  y: number;
  /** Higher = more prominent (e.g. brighter apparent magnitude). */
  priority: number;
}

/** Something that wants a text label on screen. x/y in CSS px from the viewport's top-left. */
export interface LabelCandidate {
  id: string;
  text: string;
  sub?: string;
  x: number;
  y: number;
  /** Higher wins when labels collide. */
  priority: number;
}

export interface Visual {
  readonly object: THREE.Object3D;
  setQuality?(q: Quality): void;
  dispose(): void;
}

// ───────────────────────────────────────────── Galaxy (layer units: light-years)

export interface GalaxyVisualOptions {
  /** Camera position in the galactic frame (ly). The visual offsets itself by −cameraLy. */
  cameraLy: THREE.Vector3;
  /** Galaxy particles closer than ~this fade out; the starfield takes over near the camera. */
  nearFadeLy: number;
  /** 0..1 overall intensity. */
  intensity: number;
}

export interface IGalaxyVisual extends Visual {
  update(frame: VisualFrame, o: GalaxyVisualOptions): void;
  /**
   * Suggested scene exposure for a camera position (≈2 inside the disk, ≈0.45 a few kly above it).
   * The engine eases PostFX exposure towards it so every vantage point is well exposed.
   */
  exposureHint?(cameraLy: THREE.Vector3): number;
}

// ───────────────────────────────────────────── Starfield (layer units: light-years)

export interface StarfieldOptions {
  cameraLy: THREE.Vector3;
  /** Star currently drawn by the system layer (hide its point sprite as `hiddenFade` → 1). */
  hiddenStarId: StarId | null;
  hiddenFade: number;
  selectedId: StarId | null;
  hoveredId: StarId | null;
  /** Brightness multiplier, default 1. */
  exposure: number;
}

export interface IStarfieldVisual extends Visual {
  /**
   * Replace the displayed catalogue blocks. Implementations store positions as float32 offsets from
   * `originLy` (a rebase origin near the camera, computed in float64) so nearby stars stay precise.
   * Called when the block set changes or the camera drifts far from the origin.
   */
  setBlocks(blocks: readonly StarBlock[], originLy: THREE.Vector3): void;
  update(frame: VisualFrame, o: StarfieldOptions): void;
  /** Nearest visible star to a screen point (CSS px) within maxDistPx (last update's camera). id = StarId. */
  pick(x: number, y: number, maxDistPx: number): ScreenHit | null;
  /** Up to `max` most prominent on-screen stars (id = StarId); the layer resolves names. */
  anchors(max: number): ScreenAnchor[];
}

// ───────────────────────────────────────────── Star close-up (layer units: km)

export interface StarVisualOptions {
  /** Camera-relative star centre. */
  positionKm: THREE.Vector3;
  /** 0..1 fade (transitions). */
  intensity: number;
}

export interface IStarVisual extends Visual {
  update(frame: VisualFrame, o: StarVisualOptions): void;
  /**
   * Gravitational-lensing state (black holes only; `active` false otherwise). The engine feeds it to
   * the lensing post effect (`createLensingEffect` in src/render/star/lensing.ts) every frame.
   */
  readonly lens?: LensState;
}

// ───────────────────────────────────────────── Planets & moons (layer units: km)

export interface PlanetUniforms {
  /** Camera-relative body centre. */
  positionKm: THREE.Vector3;
  /** Body-fixed frame → layer world axes (tilt × spin × ecliptic). */
  orientation: THREE.Quaternion;
  /** Unit vector from the body towards its star (layer world axes). */
  sunDirection: THREE.Vector3;
  /** Linear star colour (chromaticity). */
  sunColor: THREE.Color;
  /** Angular radius of the star seen from the body (soft shadows, penumbrae, sun disc). */
  sunAngularRadiusRad: number;
  /** Artistic irradiance scale, ~1 (clamped ~0.4–2 so every world is viewable). */
  sunIntensity: number;
  /** Shadow casters (planet ↔ moon eclipses). Optional. */
  occluders?: readonly { positionKm: THREE.Vector3; radiusKm: number }[];
  /**
   * 0..1 fade. Opaque parts treat it as a brightness multiplier (never alpha); translucent shells
   * (atmosphere, clouds, rings) may use it as opacity.
   */
  intensity: number;
}

/** 'full' = high-resolution baked surface for the focused body; 'lite' = cheap version for everything else. */
export type PlanetDetail = 'full' | 'lite';

export interface IPlanetVisual extends Visual {
  readonly body: BodyBase;
  readonly detail: PlanetDetail;
  /** True once GPU bakes are complete (a 'full' visual looks final). */
  readonly ready: boolean;
  /**
   * Advance GPU baking by at most ~budgetMs. Returns `ready`. The engine calls this every frame for
   * visuals that are not ready, and swaps lite → full only once full is ready (no hitches, no pop).
   */
  prepare(renderer: THREE.WebGLRenderer, budgetMs: number): boolean;
  update(frame: VisualFrame, u: PlanetUniforms): void;
}

/**
 * Transparent draw order inside a planet (three.js sorts transparent objects by renderOrder, then
 * depth — but shells sharing a centre have equal depth, so order MUST be explicit).
 * Rings draw as two view-dependent halves: the far half before clouds/atmosphere, the near half after.
 */
export const RENDER_ORDER = {
  surface: 0,
  ringsFar: 10,
  clouds: 20,
  atmosphere: 30,
  ringsNear: 40,
  overlay: 50,
} as const;

/** Sub-components composed inside a PlanetVisual. */
export interface IAtmosphereShell extends Visual {
  update(frame: VisualFrame, u: PlanetUniforms): void;
}
export interface ICloudLayer extends Visual {
  update(frame: VisualFrame, u: PlanetUniforms): void;
}
export interface IRingVisual extends Visual {
  update(frame: VisualFrame, u: PlanetUniforms): void;
}

// ───────────────────────────────────────────── System furniture (layer units: km)

export interface SystemFurnitureOptions {
  /** Camera-relative star centre. */
  starPositionKm: THREE.Vector3;
  /** Rotation from the system ecliptic frame S to layer world axes. */
  eclipticToWorld: THREE.Quaternion;
  /** 0..1 */
  opacity: number;
  simDays: number;
}

export interface OrbitLinesOptions extends SystemFurnitureOptions {
  highlightId: BodyId | null;
  /** Camera-relative position of the focused body (orbit lines fade near it). */
  focusPositionKm: THREE.Vector3 | null;
}

export interface IOrbitLines extends Visual {
  update(frame: VisualFrame, o: OrbitLinesOptions): void;
}

export interface IAsteroidBeltVisual extends Visual {
  update(frame: VisualFrame, o: SystemFurnitureOptions): void;
}
