/** Panels are exclusive: opening one closes the others (search, logbook, settings, help). */
import type { PanelKey } from '../../state/contracts';
import { store } from '../../state/store';

export const PANEL_KEYS: readonly PanelKey[] = ['search', 'logbook', 'settings', 'help'];

export function openPanel(key: PanelKey): void {
  const s = store.getState();
  for (const other of PANEL_KEYS) if (other !== key) s.setPanel(other, false);
  s.setPanel(key, true);
}

export function togglePanel(key: PanelKey): void {
  if (store.getState().ui.open[key]) store.getState().setPanel(key, false);
  else openPanel(key);
}

export function closePanels(): boolean {
  const s = store.getState();
  const anyOpen = PANEL_KEYS.some((k) => s.ui.open[k]);
  for (const k of PANEL_KEYS) s.setPanel(k, false);
  return anyOpen;
}

export const anyPanelOpen = (): boolean => PANEL_KEYS.some((k) => store.getState().ui.open[k]);
