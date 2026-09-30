import type { Object3D } from 'three';
import type { StarDetails } from '../../core/types';
import type { StarFrameState, LensState } from './types';
import type { StarLook } from './starLook';

/** Extra showpiece geometry for neutron stars and black holes. */
export interface Exotics {
  readonly lens: LensState;
  /** True when the photosphere and corona must not be drawn (black holes). */
  readonly replacesSphere: boolean;
  update(state: StarFrameState, timeSec: number, spinPhase: number): void;
  setQuality(level: number): void;
  dispose(): void;
}

export function createExotics(
  _star: StarDetails,
  _look: StarLook,
  _parent: Object3D,
): Exotics | null {
  return null;
}
