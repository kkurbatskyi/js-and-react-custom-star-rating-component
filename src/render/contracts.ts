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
import type { BodyBase, BodyId, StarId, StarRecord } from '../core/types';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Per-frame context handed to every visual. */
export interface VisualFrame {
  /** Real seconds since app start (animation clock). */
  timeSec: number;
  dtSec: number;
  /** Simulation clock in days (orbits, spin). */
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
   * Replace the displayed stars. Positions are stored as float32 offsets from `originLy`
   * (a rebase origin near the camera) so they stay precise.
   */
  setStars(stars: readonly StarRecord[], originLy: THREE.Vector3): void;
  update(frame: VisualFrame, o: StarfieldOptions): void;
  /** Nearest visible star to screen point (CSS px) within maxDistPx, using the last update's camera. */
  pick(x: number, y: number, maxDistPx: number): ScreenHit | null;
  /** Up to `max` label candidates for the most prominent on-screen stars. */
  labels(max: number): LabelCandidate[];
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
  /** Artistic irradiance scale, ~1 (clamped ~0.4–2 so every world is viewable). */
  sunIntensity: number;
  /** Shadow casters (planet ↔ moon eclipses). Optional. */
  occluders?: readonly { positionKm: THREE.Vector3; radiusKm: number }[];
  /** 0..1 fade (transitions). */
  intensity: number;
}

export type PlanetDetail = 'full' | 'lite';

export interface IPlanetVisual extends Visual {
  readonly body: BodyBase;
  update(frame: VisualFrame, u: PlanetUniforms): void;
}

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
