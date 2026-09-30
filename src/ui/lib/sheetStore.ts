/**
 * Bottom-sheet snap state that only the phone layout cares about. `peek` / `half` come from the
 * persisted `ui.panelCollapsed` flag; whether a half-open sheet is stretched to `full` lives here.
 */
import { create } from 'zustand';

export type SheetState = 'peek' | 'half' | 'full';

interface SheetStore {
  full: boolean;
  setFull(full: boolean): void;
}

export const useSheetStore = create<SheetStore>()((set) => ({
  full: false,
  setFull: (full) => set({ full }),
}));

export function sheetStateOf(collapsed: boolean, full: boolean): SheetState {
  return collapsed ? 'peek' : full ? 'full' : 'half';
}
