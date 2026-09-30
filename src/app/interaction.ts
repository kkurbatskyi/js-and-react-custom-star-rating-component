/**
 * What the pointer and keyboard do in Sidereal — the app's implementation of the engine's
 * InputActions (the engine recognises gestures; the app decides what they mean):
 *   drag orbit · right/two-finger drag pan (galaxy view) · wheel/pinch zoom (towards the cursor in
 *   galaxy view) · tap select · double tap fly (empty sky in galaxy view: zoom in there)
 *   Esc up a level (or leaves photo mode) · F fly to selection · Space pause · H photo mode · [ ] time
 */
import { Vector3 } from 'three';
import type { SelectionRef } from '../core/types';
import type { Engine } from '../engine/Engine';
import type { InputActions } from '../engine/input/InputController';
import type { PointerKind } from '../engine/input/gestures';
import type { PressAction } from '../engine/input/keys';
import { stepTimeScale } from '../sim/time';
import { store } from '../state/store';
import type { AudioBridge } from './AudioBridge';

/** Pixels of pointer slop per pointer type when picking. */
const PICK_RADIUS: Readonly<Record<PointerKind, number>> = { mouse: 12, pen: 16, touch: 24 };
/** Radians per pixel for a pan gesture outside galaxy view (it orbits instead). */
const PAN_AS_ORBIT = 0.004;
/** Double-click on empty sky in galaxy view zooms in by this factor towards it. */
const EMPTY_DOUBLE_ZOOM = 0.3;

const _ray = new Vector3();

function sameRef(a: SelectionRef | null, b: SelectionRef | null): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}

export function createInputActions(engine: Engine, canvas: HTMLElement, audio: AudioBridge | null): InputActions {
  let cursor = '';
  const setCursor = (c: string): void => {
    if (c !== cursor) {
      cursor = c;
      canvas.style.cursor = c;
    }
  };

  return {
    orbitBy(dYaw, dPitch) {
      engine.rig.orbit(dYaw, dPitch);
    },

    panBy(dx, dy) {
      if (engine.rig.focus.kind === 'galaxy') engine.rig.pan(dx, dy, engine.frame.height);
      else engine.rig.orbit(-dx * PAN_AS_ORBIT, dy * PAN_AS_ORBIT);
    },

    zoomBy(factor, x, y) {
      const toCursor = x !== null && y !== null && engine.rig.focus.kind === 'galaxy';
      engine.rig.zoom(factor, toCursor ? engine.screenRay(x, y, _ray) : null);
    },

    tap(x, y, count, pointer) {
      const s = store.getState();
      const hit = engine.pick(x, y, PICK_RADIUS[pointer]);
      if (count === 2) {
        if (hit) {
          s.select(hit.ref);
          s.requestFocus(hit.ref, 'fly');
        } else if (engine.rig.focus.kind === 'galaxy') {
          engine.rig.zoom(EMPTY_DOUBLE_ZOOM, engine.screenRay(x, y, _ray));
        }
        return;
      }
      if (!sameRef(s.selection, hit?.ref ?? null)) {
        s.select(hit?.ref ?? null);
        if (hit) audio?.sfx('select');
      }
    },

    hover(x, y) {
      const s = store.getState();
      if (x === null || y === null) {
        s.setHover(null);
        setCursor('');
        return;
      }
      const hit = engine.pick(x, y, PICK_RADIUS.mouse);
      const ref = hit?.ref ?? null;
      if (!sameRef(s.hover, ref)) {
        s.setHover(ref);
        if (ref) audio?.sfx('hover');
      }
      setCursor(ref ? 'pointer' : '');
    },

    press(action: PressAction) {
      const s = store.getState();
      switch (action) {
        case 'up-level': {
          if (s.ui.photoMode) s.setPhotoMode(false);
          else if (!Object.values(s.ui.open).some(Boolean)) s.goUp();
          break;
        }
        case 'fly-selection':
          if (s.selection) s.requestFocus(s.selection, 'fly');
          break;
        case 'toggle-pause':
          if (!Object.values(s.ui.open).some(Boolean)) s.togglePause();
          break;
        case 'photo-mode':
          if (!Object.values(s.ui.open).some(Boolean)) s.setPhotoMode(!s.ui.photoMode);
          break;
        case 'slower':
          s.setTimeScale(stepTimeScale(s.timeScale, -1));
          break;
        case 'faster':
          s.setTimeScale(stepTimeScale(s.timeScale, 1));
          break;
      }
    },
  };
}
