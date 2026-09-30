/**
 * Helpers shared by the system and planet layers: planet uniforms from body state, screen metrics,
 * and pooled label specs.
 */
import { Color, Quaternion, Vector3 } from 'three';
import type { LabelSpec } from '../../engine/contracts';
import type {
  IPlanetVisual,
  PlanetUniforms,
  ScreenDisc,
  VisualFrame,
} from '../../render/contracts';
import type { BodyState, SystemAssets } from './SystemAssets';

export type Occluder = { positionKm: Vector3; radiusKm: number };

export function createPlanetUniforms(): PlanetUniforms {
  return {
    positionKm: new Vector3(),
    orientation: new Quaternion(),
    sunDirection: new Vector3(1, 0, 0),
    sunColor: new Color(1, 1, 1),
    sunAngularRadiusRad: 0.005,
    sunIntensity: 1,
    occluders: undefined,
    intensity: 1,
  };
}

/** Uniforms for body `b` at its camera-relative position `b.rel`. */
export function fillPlanetUniforms(
  u: PlanetUniforms,
  b: BodyState,
  assets: SystemAssets,
  intensity: number,
  occluders: readonly Occluder[] | undefined,
): PlanetUniforms {
  u.positionKm.copy(b.rel);
  u.orientation.copy(b.orientation);
  u.sunDirection.copy(b.sunDirection);
  u.sunColor.copy(assets.sunColor);
  u.sunAngularRadiusRad = b.sunAngularRadiusRad;
  u.sunIntensity = b.sunIntensity;
  u.occluders = occluders;
  u.intensity = intensity;
  return u;
}

/**
 * Update a planet visual and set its visibility afterwards (visuals may set `visible` themselves in
 * update; the layer has the last word).
 */
export function drawPlanet(
  visual: IPlanetVisual,
  frame: VisualFrame,
  u: PlanetUniforms,
  visible: boolean,
): void {
  if (visible) visual.update(frame, u);
  visual.object.visible = visible;
}

/** A pooled LabelSpec at `slot` (grown on demand). */
export function labelAt(pool: LabelSpec[], slot: number): LabelSpec {
  let spec = pool[slot];
  if (!spec) {
    spec = { key: '', text: '', x: 0, y: 0, priority: 0 };
    pool[slot] = spec;
  }
  return spec;
}

/** Fill a pooled label for a body; `tier`/`rank` per LabelTier. */
export function bodyLabel(
  spec: LabelSpec,
  b: BodyState,
  priority: number,
  marker: LabelSpec['marker'],
  sub: string | undefined,
): LabelSpec {
  spec.key = b.id;
  const ref = spec.ref;
  const kind = b.moon ? 'moon' : 'planet';
  if (ref && ref.kind === kind) ref.id = b.id;
  else spec.ref = { kind, id: b.id };
  spec.text = b.body.name;
  spec.sub = sub;
  spec.x = b.screenX;
  spec.y = b.screenY;
  spec.priority = priority;
  spec.marker = marker;
  spec.color = marker === 'ring' ? 'var(--sd-accent, #d9b36c)' : b.swatchCss;
  return spec;
}

/** Push a pooled occluder disc (no per-frame allocation). */
export function pushDisc(
  pool: ScreenDisc[],
  slot: number,
  out: ScreenDisc[],
  x: number,
  y: number,
  radiusPx: number,
): number {
  let d = pool[slot];
  if (!d) {
    d = { x: 0, y: 0, radiusPx: 0 };
    pool[slot] = d;
  }
  d.x = x;
  d.y = y;
  d.radiusPx = radiusPx;
  out.push(d);
  return slot + 1;
}

/** Point a pooled label's ref at a star without allocating when it already is one. */
export function setStarRef(spec: LabelSpec, id: string): void {
  const ref = spec.ref;
  if (ref && ref.kind === 'star') ref.id = id;
  else spec.ref = { kind: 'star', id };
}
