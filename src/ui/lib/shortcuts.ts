/**
 * The UI's global keyboard shortcuts, installed once by App in the CAPTURE phase. The engine owns the
 * camera and clock keys (src/engine/input/keys.ts: arrows/WASD, + −, F, Space, H, [ ]) and also
 * listens for Esc ("up a level"), so anything the UI consumes is stopped before it gets there: closing
 * the search palette with Esc must not also fly you up a level.
 *
 *   Esc          close the top-most thing (photo preview → dialog → photo mode); else the engine's
 *   ⌘/Ctrl+K  /  search        ?  help        L  logbook        M  mute
 */
import { store } from '../../state/store';
import { anyPanelOpen, closePanels, openPanel, togglePanel } from './panels';
import { usePhotoStore } from './photoStore';

/** Close whatever is on top. Returns true when something was closed (the key is then consumed). */
export function closeTopmost(): boolean {
  const photo = usePhotoStore.getState();
  if (photo.shot) {
    photo.setShot(null);
    return true;
  }
  if (anyPanelOpen()) {
    closePanels();
    return true;
  }
  const s = store.getState();
  if (s.ui.photoMode) {
    s.setPhotoMode(false);
    return true;
  }
  return false;
}

const TEXT_INPUT =
  'input:not([type="checkbox"]):not([type="range"]):not([type="radio"]), textarea, select, [contenteditable=""], [contenteditable="true"]';
export function handleKeyDown(e: KeyboardEvent): void {
  const s = store.getState();
  const target = e.target instanceof Element ? e.target : null;
  const consume = () => {
    e.preventDefault();
    e.stopPropagation();
  };

  if (e.key === 'Escape') {
    if (closeTopmost()) consume();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    consume();
    togglePanel('search');
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (target?.matches(TEXT_INPUT)) return;

  switch (e.key) {
    case '/':
      consume();
      openPanel('search');
      return;
    case '?':
      consume();
      togglePanel('help');
      return;
    case 'l':
    case 'L':
      consume();
      togglePanel('logbook');
      return;
    case 'm':
    case 'M':
      consume();
      s.updateSettings({ audio: !s.settings.audio });
      return;
  }
}

/** Install the shortcuts; returns the cleanup. */
export function installShortcuts(target: Window = window): () => void {
  target.addEventListener('keydown', handleKeyDown, { capture: true });
  return () => target.removeEventListener('keydown', handleKeyDown, { capture: true });
}
