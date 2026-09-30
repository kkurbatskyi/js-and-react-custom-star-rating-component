import type { Object3D } from 'three';
import type { StarDetails } from '../../core/types';
import { HoleVisual } from './HoleVisual';
import { NeutronVisual } from './NeutronVisual';
import type { StarLook } from './starLook';
import type { LensState, StarFrameState } from './types';

/** Extra showpiece geometry for neutron stars and black holes, driven by StarVisual. */
export interface Exotics {
  readonly lens: LensState;
  /** True when the photosphere and corona must not be drawn (black holes). */
  readonly replacesSphere: boolean;
  update(state: StarFrameState, timeSec: number, spinPhase: number): void;
  setQuality(level: number): void;
  dispose(): void;
}

/** The exotic add-on for a star's kind, or null for ordinary stars. */
export function createExotics(star: StarDetails, look: StarLook, parent: Object3D): Exotics | null {
  switch (look.archetype) {
    case 'hole':
      return new HoleVisual(star, look, parent);
    case 'neutron':
      return new NeutronVisual(star, look, parent);
    default:
      return null;
  }
}
