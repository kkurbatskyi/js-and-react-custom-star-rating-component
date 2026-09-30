/**
 * AudioBridge — wires the generative audio director (src/audio) to the store and the engine:
 * unlocks the AudioContext on the first user gesture (browsers require one) when audio is enabled,
 * follows the enabled/volume settings, morphs the score towards what the camera looks at, and
 * drives the travel drone and sound effects.
 */
import { createAudioDirector } from '../audio/AudioDirector';
import type { AudioScene, IAudioDirector, SfxName } from '../audio/contracts';
import type { ViewLevel } from '../core/types';
import type { FocusHandle } from '../engine/camera/focus';
import type { Settings } from '../state/contracts';
import { store } from '../state/store';

export class AudioBridge {
  readonly director: IAudioDirector;
  private readonly unsubscribe: () => void;
  private lastTravel = -1;
  private sceneKey = '';
  private readonly scene: AudioScene = {
    level: 'galaxy',
    seed: 0,
    starTemperatureK: null,
    planetType: null,
  };

  constructor() {
    this.director = createAudioDirector();
    this.applySettings(store.getState().settings);
    // Subscribing (not polling) keeps unlock() inside the click that enabled audio.
    this.unsubscribe = store.subscribe((s, prev) => {
      if (s.settings !== prev.settings) this.applySettings(s.settings);
    });
    window.addEventListener('pointerdown', this.onGesture, { capture: true });
    window.addEventListener('keydown', this.onGesture, { capture: true });
  }

  /** Morph the score towards the current view (cheap no-op when nothing changed). */
  setScene(level: ViewLevel, focus: FocusHandle, galaxySeed: number): void {
    const key = `${level}|${focus.starId ?? ''}|${focus.body?.id ?? ''}`;
    if (key === this.sceneKey) return;
    this.sceneKey = key;
    const s = this.scene;
    s.level = level;
    s.seed = focus.star?.seed ?? galaxySeed;
    s.starTemperatureK = level === 'galaxy' ? null : (focus.star?.temperatureK ?? null);
    s.planetType = focus.body?.type ?? null;
    this.director.setScene({ ...s });
  }

  setTravel(intensity: number): void {
    if (Math.abs(intensity - this.lastTravel) < 0.01) return;
    this.lastTravel = intensity;
    this.director.setTravel(intensity);
  }

  sfx(name: SfxName): void {
    if (this.director.unlocked) this.director.sfx(name);
  }

  dispose(): void {
    this.unsubscribe();
    window.removeEventListener('pointerdown', this.onGesture, { capture: true });
    window.removeEventListener('keydown', this.onGesture, { capture: true });
    this.director.dispose();
  }

  private applySettings(settings: Settings): void {
    this.director.setEnabled(settings.audio);
    this.director.setVolume(settings.volume);
    if (settings.audio && !this.director.unlocked) void this.director.unlock();
  }

  private readonly onGesture = (): void => {
    if (store.getState().settings.audio && !this.director.unlocked) void this.director.unlock();
  };
}
