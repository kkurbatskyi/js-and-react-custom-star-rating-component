// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../state/store';
import { resetStore } from '../testing';
import { usePhotoStore } from './photoStore';
import { installShortcuts } from './shortcuts';

let uninstall: () => void;
let engineSaw: string[];
const onBubble = (e: KeyboardEvent) => engineSaw.push(e.key);

beforeEach(() => {
  resetStore();
  usePhotoStore.setState({ shot: null });
  engineSaw = [];
  uninstall = installShortcuts(window);
  window.addEventListener('keydown', onBubble); // stands in for the engine's own key handling
});
afterEach(() => {
  uninstall();
  window.removeEventListener('keydown', onBubble);
  document.body.innerHTML = '';
});

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const ui = () => store.getState().ui;

describe('panels', () => {
  it('opens search with "/" and Ctrl/⌘+K, help with "?", the logbook with L', () => {
    press('/');
    expect(ui().open.search).toBe(true);
    press('k', { ctrlKey: true }); // toggles
    expect(ui().open.search).toBe(false);
    press('k', { metaKey: true });
    expect(ui().open.search).toBe(true);
    press('?');
    expect(ui().open).toMatchObject({ help: true, search: false }); // exclusive
    press('L');
    expect(ui().open).toMatchObject({ logbook: true, help: false });
  });

  it('ignores letter shortcuts while typing in a field', () => {
    const input = document.createElement('input');
    document.body.append(input);
    press('l', {}, input);
    press('/', {}, input);
    expect(ui().open.logbook).toBe(false);
    expect(ui().open.search).toBe(false);
    // …but Ctrl+K still works from inside a field
    press('k', { ctrlKey: true }, input);
    expect(ui().open.search).toBe(true);
  });
});

describe('Escape', () => {
  it('closes the top-most thing and keeps the key from the engine', () => {
    store.getState().setPanel('search', true);
    const e = press('Escape');
    expect(ui().open.search).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(engineSaw).not.toContain('Escape');
  });

  it('closes a photo preview before leaving photo mode, then lets the engine have the key', () => {
    store.getState().setPhotoMode(true);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    usePhotoStore.getState().setShot({ url: 'blob:x', name: 'Aurelia', takenAt: 0 });
    press('Escape');
    expect(usePhotoStore.getState().shot).toBeNull();
    expect(ui().photoMode).toBe(true);
    expect(revoke).toHaveBeenCalledWith('blob:x'); // the preview's object URL is released
    press('Escape');
    expect(ui().photoMode).toBe(false);
    expect(engineSaw).not.toContain('Escape');
    press('Escape'); // nothing left to close: this one is the engine's ("up a level")
    expect(engineSaw).toContain('Escape');
  });
});

describe('keys the UI leaves to the engine', () => {
  it('lets the camera and clock keys through untouched (arrows, WASD, F, Space, H, [ ])', () => {
    for (const key of ['ArrowLeft', 'w', 'f', ' ', 'h', '[', ']', '+', '-']) {
      const e = press(key);
      expect(e.defaultPrevented, key).toBe(false);
    }
    expect(engineSaw).toEqual(['ArrowLeft', 'w', 'f', ' ', 'h', '[', ']', '+', '-']);
    expect(ui().photoMode).toBe(false);
    expect(store.getState().paused).toBe(false);
  });

  it('mutes with M', () => {
    const audio = store.getState().settings.audio;
    press('m');
    expect(store.getState().settings.audio).toBe(!audio);
    press('M');
    expect(store.getState().settings.audio).toBe(audio);
  });

  it('ignores modified letter keys', () => {
    press('l', { altKey: true });
    press('l', { ctrlKey: true });
    expect(ui().open.logbook).toBe(false);
    expect(engineSaw).toEqual(['l', 'l']);
  });
});
