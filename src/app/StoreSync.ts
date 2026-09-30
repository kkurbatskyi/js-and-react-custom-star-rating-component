/**
 * StoreSync — the two-way bridge between the zustand store and the engine (src/state/contracts.ts):
 *
 *   store → engine (every frame, cheap): navRequest / timeRequest by seq, time scale & pause,
 *            settings (quality, bloom, orbits, reduced motion, auto-rotate, galaxy seed).
 *   engine → store (≤ 10 Hz, no-op patches are dropped by the store): level, focus, distance,
 *            flight progress & target, sim time, camera ly — plus immediate writes on arrival.
 *
 * Also keeps `location.hash` in sync with where we are (or are heading), and follows `hashchange`.
 */

import { Vector3 } from 'three';
import { formatLy } from '../core/format';
import type { FocusTarget, Vec3Tuple, ViewLevel } from '../core/types';
import { damp } from '../engine/camera/damping';
import type { FocusHandle } from '../engine/camera/focus';
import { relativeKm } from '../engine/camera/frames';
import type { FrameInfo } from '../engine/contracts';
import type { Engine, EngineHooks } from '../engine/Engine';
import type { Settings } from '../state/contracts';
import { store } from '../state/store';
import { getUniverse } from '../universe';
import type { Universe } from '../universe/contracts';
import { formatDeepLink, parseDeepLink, writeHash } from './deepLink';

const STORE_INTERVAL_MS = 100;
const HASH_INTERVAL_MS = 400;
/** Bloom slider (0..2) → PostFX bloom intensity. */
const BLOOM_SCALE = 1;

export interface StoreSyncCallbacks {
  /** The galaxy seed changed: rebuild everything that depends on the universe. */
  onUniverseChange(universe: Universe): void;
  /** A flight started ('fly' requests only). */
  onFlightStart?(to: FocusTarget): void;
  onArrive?(to: FocusHandle, from: FocusHandle): void;
}

const _rel = new Vector3();

export class StoreSync implements EngineHooks {
  /** 0..1 animated orbit-line opacity (settings.orbits). */
  orbitOpacity = 1;
  private readonly engine: Engine;
  private readonly callbacks: StoreSyncCallbacks;
  private settings: Settings | null = null;
  private lastNavSeq = -1;
  private lastTimeSeq = -1;
  private lastWrite = Number.NEGATIVE_INFINITY;
  private lastHashWrite = Number.NEGATIVE_INFINITY;
  private lastToken = '';
  private debugFrozen = false;

  constructor(engine: Engine, callbacks: StoreSyncCallbacks) {
    this.engine = engine;
    this.callbacks = callbacks;
    engine.rig.events = {
      onArrive: (to, from) => this.arrive(to, from),
      onFocusChanged: (focus) => this.focusChanged(focus),
    };
    window.addEventListener('hashchange', this.onHashChange);
  }

  /** Debug freeze (screenshots) overrides the store's pause. */
  setDebugFrozen(on: boolean): void {
    this.debugFrozen = on;
    this.engine.clock.frozen = on;
  }

  beforeUpdate(engine: Engine, dt: number): void {
    const s = store.getState();
    if (s.settings !== this.settings) this.applySettings(s.settings);
    const nav = s.navRequest;
    if (nav && nav.seq !== this.lastNavSeq) {
      this.lastNavSeq = nav.seq;
      s.consumeNavRequest(nav.seq);
      this.navigate(nav.target, nav.mode);
    }
    const time = s.timeRequest;
    if (time && time.seq !== this.lastTimeSeq) {
      this.lastTimeSeq = time.seq;
      s.consumeTimeRequest(time.seq);
      engine.clock.setSimDays(time.simDays);
    }
    engine.clock.timeScale = s.timeScale;
    engine.clock.paused = s.paused;
    engine.clock.frozen = this.debugFrozen;
    this.orbitOpacity = damp(this.orbitOpacity, s.settings.orbits ? 1 : 0, 6, dt || 1 / 60);
  }

  afterRender(frame: FrameInfo): void {
    const now = performance.now();
    if (now - this.lastWrite >= STORE_INTERVAL_MS) {
      this.lastWrite = now;
      this.write(frame.level);
    }
    if (now - this.lastHashWrite >= HASH_INTERVAL_MS) {
      this.lastHashWrite = now;
      const s = store.getState();
      const token = formatDeepLink(s.flightTarget ?? s.focus, s.settings.galaxySeed);
      if (token !== this.lastToken) {
        this.lastToken = token;
        writeHash(token);
      }
    }
  }

  /** Throttled engine → store state. */
  write(level: ViewLevel = this.engine.levels.level): void {
    const e = this.engine;
    const rig = e.rig;
    const g = e.snapshot.galacticLy;
    store.getState().setFromEngine({
      level,
      focus: rig.focus.target,
      cameraDistanceKm: this.distanceToFocus(),
      cameraLy: [g.x, g.y, g.z],
      flightProgress: rig.progress,
      flightTarget: rig.destination?.target ?? null,
      simDays: e.clock.simDays,
    });
  }

  dispose(): void {
    window.removeEventListener('hashchange', this.onHashChange);
    this.engine.rig.events = {};
  }

  // ───────────────────────────────────────────── internals

  private navigate(target: FocusTarget, mode: 'fly' | 'jump'): void {
    const s = store.getState();
    const ok = this.engine.navigate(target, mode, s.settings.reducedMotion);
    if (!ok) {
      s.pushToast({
        text: 'Nothing is there',
        sub: 'That object does not exist in this galaxy.',
        tone: 'warning',
      });
      return;
    }
    if (mode === 'fly') {
      s.setFromEngine({ flightTarget: target, flightProgress: 0 });
      this.callbacks.onFlightStart?.(target);
    }
  }

  private arrive(to: FocusHandle, from: FocusHandle): void {
    const s = store.getState();
    const universe = this.engine.universe;
    s.setFromEngine({ focus: to.target, flightTarget: null, flightProgress: null });
    this.write();
    if (to.starId) {
      s.markVisited(to.starId);
      if (to.body) universe.remember(to.body.id);
      if (from.starId !== to.starId && to.system) {
        const n = to.system.planets.length;
        const star = to.system.star;
        const home = universe.getRecord(universe.homeStarId());
        const d = home ? lyBetween(star.posLy, home.posLy) : 0;
        s.pushToast({
          text: `Arrived at ${star.name} · ${n === 0 ? 'no planets' : n === 1 ? '1 planet' : `${n} planets`}`,
          sub: `${star.spectralType} · ${star.id === home?.id ? 'home system' : `${formatLy(d)} from home`}`,
          tone: 'success',
        });
      }
    }
    this.callbacks.onArrive?.(to, from);
  }

  private focusChanged(focus: FocusHandle): void {
    store
      .getState()
      .setFromEngine({ focus: focus.target, flightTarget: null, flightProgress: null });
  }

  private distanceToFocus(): number {
    const rig = this.engine.rig;
    if (rig.anchor === rig.focus) return rig.offsetKm.length();
    return relativeKm(rig.anchor, rig.focus, _rel).add(rig.offsetKm).length();
  }

  private applySettings(next: Settings): void {
    const prev = this.settings;
    this.settings = next;
    const e = this.engine;
    if (!prev || prev.quality !== next.quality) e.setQualitySetting(next.quality);
    if (!prev || prev.bloom !== next.bloom)
      e.post.setBloom({ intensity: next.bloom * BLOOM_SCALE });
    e.rig.autoRotate = next.autoRotate;
    e.rig.autoRotateRate = next.reducedMotion ? 0.004 : 0.018;
    if (prev && prev.galaxySeed !== next.galaxySeed) {
      const universe = getUniverse(next.galaxySeed);
      e.setUniverse(universe);
      this.callbacks.onUniverseChange(universe);
    }
  }

  private readonly onHashChange = (): void => {
    const link = parseDeepLink(window.location.hash);
    if (!link) return;
    const s = store.getState();
    const token = formatDeepLink(link.target, link.seed ?? s.settings.galaxySeed);
    if (token === this.lastToken) return; // our own replaceState, or already there
    this.lastToken = token;
    if (link.seed !== null && link.seed !== s.settings.galaxySeed) {
      s.updateSettings({ galaxySeed: link.seed });
      s.requestFocus(link.target, 'jump');
      return;
    }
    s.requestFocus(link.target, 'fly');
  };
}

function lyBetween(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
