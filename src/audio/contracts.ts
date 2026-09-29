/**
 * Generative audio. Implemented by src/audio/AudioDirector.ts.
 * Everything is synthesised with the Web Audio API — no audio files.
 */
import type { PlanetType, ViewLevel } from '../core/types';

export type SfxName =
  | 'hover'
  | 'select'
  | 'open'
  | 'close'
  | 'travel-start'
  | 'arrive'
  | 'rate'
  | 'error';

/** What the listener is looking at; the score morphs towards it over a few seconds. */
export interface AudioScene {
  level: ViewLevel;
  /** Seed of the focused star (or galaxy); drives key, motifs and timbre. */
  seed: number;
  /** Focused star temperature: hot → brighter, higher; cool → darker, lower. Null in galaxy view. */
  starTemperatureK: number | null;
  planetType: PlanetType | null;
}

export interface IAudioDirector {
  /** Resume/create the AudioContext. MUST be called from a user gesture. Idempotent. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  setEnabled(on: boolean): void;
  /** 0..1 master volume. */
  setVolume(v: number): void;
  setScene(s: AudioScene): void;
  sfx(name: SfxName): void;
  /** 0..1 travel intensity (warp whoosh / rising drone). */
  setTravel(intensity: number): void;
  dispose(): void;
}
