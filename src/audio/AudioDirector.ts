/**
 * AudioDirector — STUB (integration phase). Contract-complete but silent: it owns the
 * AudioContext lifecycle (created/resumed only from a user gesture, as browsers require) and a
 * master gain node, and remembers every setting, so the UI and engine can integrate now. The
 * audio specialist replaces the internals with the generative score and SFX.
 */
import type { AudioScene, IAudioDirector, SfxName } from './contracts';

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

class StubAudioDirector implements IAudioDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;
  private volume = 0.6;
  private scene: AudioScene | null = null;
  private travel = 0;

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  async unlock(): Promise<void> {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    try {
      if (!this.ctx) {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyGain();
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch {
      // Autoplay policy or a sandbox refused audio: stay silent, keep the app running.
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyGain();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.applyGain();
  }

  setScene(s: AudioScene): void {
    this.scene = s; // the generative score will morph towards this
  }

  sfx(_name: SfxName): void {
    // Silent stub.
  }

  setTravel(intensity: number): void {
    this.travel = Math.min(1, Math.max(0, intensity));
  }

  dispose(): void {
    this.master?.disconnect();
    this.master = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.scene = null;
    this.travel = 0;
  }

  private applyGain(): void {
    if (!this.ctx || !this.master) return;
    // Short ramp to avoid clicks.
    this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
  }
}

export function createAudioDirector(): IAudioDirector {
  return new StubAudioDirector();
}
