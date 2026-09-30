/**
 * Global keyboard shortcuts, installed once by App in the CAPTURE phase. The engine also listens for
 * keys (Esc = up a level), so anything the UI consumes is stopped before it gets there: closing the
 * search palette with Esc must not also fly you up a level.
 *
 *   Esc            close the top-most thing (photo preview → dialog → photo mode); else falls through
 *   ⌘/Ctrl+K  /    search          ?  help       L  logbook       M  mute
 *   H              toggle photo mode (P enters it)
 *   Space          pause / resume time      ,  .  slower / faster
 */
import { stepTimeScale } from '../../sim/time';
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

const TEXT_INPUT = 'input:not([type="checkbox"]):not([type="range"]):not([type="radio"]), textarea, select, [contenteditable=""], [contenteditable="true"]';
const ACTIVATES_ON_SPACE = 'button, a[href], summary, [role="radio"], [role="tab"], [role="switch"], [role="option"], input, select, textarea';

function changeSpeed(direction: 1 | -1): void {
  const s = store.getState();
  if (direction > 0) {
    if (s.paused) s.togglePause();
    else s.setTimeScale(stepTimeScale(s.timeScale === 0 ? 1 : s.timeScale, 1));
    return;
  }
  if (s.paused) return;
  const next = stepTimeScale(s.timeScale, -1);
  if (next <= 0) s.togglePause();
  else s.setTimeScale(next);
}

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
    case 'h':
    case 'H':
      if (anyPanelOpen()) return;
      consume();
      s.setPhotoMode(!s.ui.photoMode);
      return;
    case 'p':
    case 'P':
      if (anyPanelOpen()) return;
      consume();
      s.setPhotoMode(true);
      return;
    case ' ':
      if (target?.closest(ACTIVATES_ON_SPACE) || anyPanelOpen()) return;
      consume();
      s.togglePause();
      return;
    case ',':
      consume();
      changeSpeed(-1);
      return;
    case '.':
      consume();
      changeSpeed(1);
      return;
  }
}

/** Install the shortcuts; returns the cleanup. */
export function installShortcuts(target: Window = window): () => void {
  target.addEventListener('keydown', handleKeyDown, { capture: true });
  return () => target.removeEventListener('keydown', handleKeyDown, { capture: true });
}
