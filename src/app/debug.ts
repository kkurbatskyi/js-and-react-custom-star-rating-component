/**
 * `window.__SIDEREAL__` — the debug handle for tests and deterministic screenshots:
 *   { store, engine, universe, debug: { jumpTo, flyTo, setSimDays, freeze, frames, select, state } }
 *
 *   __SIDEREAL__.debug.jumpTo('1.399.0.-276.0.d', { distanceKm: 3e4, yaw: 0.6, pitch: 0.3 })
 *   __SIDEREAL__.debug.flyTo('1.399.0.-276.0.f', { at: 0.5 })   // frozen at mid-flight
 * Angles in radians, in the target's reference frame (ecliptic for stars/bodies, galactic otherwise).
 */
import { Vector3 } from 'three';
import type { FocusTarget, SelectionRef } from '../core/types';
import { relativeKm } from '../engine/camera/frames';
import { arrivalPose, type OrbitPose } from '../engine/camera/framing';
import type { Engine } from '../engine/Engine';
import { store } from '../state/store';
import type { Universe } from '../universe/contracts';
import { parseDeepLink } from './deepLink';
import type { StoreSync } from './StoreSync';

export interface DebugApi {
  jumpTo(target: FocusTarget | string, pose?: Partial<OrbitPose>): boolean;
  flyTo(target: FocusTarget | string, opts?: { at?: number }): boolean;
  setSimDays(simDays: number): void;
  freeze(on: boolean): void;
  /** Resolves after n more rendered frames. */
  frames(n: number): Promise<void>;
  select(target: FocusTarget | string | null): void;
  state(): {
    level: string;
    focus: FocusTarget;
    anchor: FocusTarget;
    distanceKm: number;
    systemId: string | null;
    flight: number | null;
    simDays: number;
  };
}

export interface SiderealHandle {
  store: typeof store;
  engine: Engine;
  readonly universe: Universe;
  debug: DebugApi;
}

declare global {
  interface Window {
    __SIDEREAL__?: SiderealHandle;
    __READY__?: boolean;
  }
}

function toTarget(t: FocusTarget | string): FocusTarget | null {
  if (typeof t !== 'string') return t;
  if (t === 'galaxy' || t === 'centre' || t === 'center')
    return { kind: 'galaxy', centerLy: [0, 0, 0] };
  return parseDeepLink(t)?.target ?? null;
}

export function installDebugHandle(engine: Engine, sync: StoreSync): SiderealHandle {
  const frameWaiters: { remaining: number; resolve: () => void }[] = [];
  engine.hooks.push({
    afterRender() {
      for (let i = frameWaiters.length - 1; i >= 0; i--) {
        const w = frameWaiters[i];
        if (--w.remaining <= 0) {
          frameWaiters.splice(i, 1);
          w.resolve();
        }
      }
    },
  });

  const debug: DebugApi = {
    jumpTo(t, pose) {
      const target = toTarget(t);
      const handle = target ? engine.resolve(target) : null;
      if (!handle) return false;
      handle.update(engine.clock.simDays);
      const dir = relativeKm(engine.rig.anchor, handle, new Vector3()).add(engine.rig.offsetKm);
      if (dir.lengthSq() === 0) dir.set(0, 0, 1);
      const p = arrivalPose(
        handle,
        dir.normalize(),
        { yaw: 0, pitch: 0, distanceKm: 1 },
        engine.rig.viewAspect,
        engine.rig.fovY,
      );
      engine.rig.jumpTo(handle, engine.clock.simDays, {
        yaw: pose?.yaw ?? p.yaw,
        pitch: pose?.pitch ?? p.pitch,
        distanceKm: pose?.distanceKm ?? p.distanceKm,
      });
      return true;
    },
    flyTo(t, opts) {
      const target = toTarget(t);
      if (!target || !engine.navigate(target, 'fly', false)) return false;
      store.getState().setFromEngine({ flightTarget: target, flightProgress: 0 });
      if (opts?.at !== undefined) {
        sync.setDebugFrozen(true);
        engine.rig.setFlightProgress(opts.at);
      }
      return true;
    },
    setSimDays(d) {
      engine.clock.setSimDays(d);
    },
    freeze(on) {
      sync.setDebugFrozen(on);
    },
    frames(n) {
      return new Promise((resolve) => frameWaiters.push({ remaining: Math.max(1, n), resolve }));
    },
    select(t) {
      const target = t === null ? null : toTarget(t);
      const ref: SelectionRef | null =
        target && target.kind !== 'galaxy' ? { kind: target.kind, id: target.id } : null;
      store.getState().select(ref);
    },
    state() {
      const rig = engine.rig;
      return {
        level: engine.levels.level,
        focus: rig.focus.target,
        anchor: rig.anchor.target,
        distanceKm: rig.offsetKm.length(),
        systemId: engine.snapshot.systemId,
        flight: rig.progress,
        simDays: engine.clock.simDays,
      };
    },
  };

  const handle: SiderealHandle = {
    store,
    engine,
    get universe() {
      return engine.universe;
    },
    debug,
  };
  window.__SIDEREAL__ = handle;
  return handle;
}
