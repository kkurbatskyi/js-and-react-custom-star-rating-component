/**
 * Global app state (zustand). Implemented in src/state/store.ts.
 *
 * Data flow:
 *   UI  ──actions──▶ store ──navRequest──▶ engine (consumes, flies the camera)
 *   engine ──setFromEngine(level, focus, distance, simDays…)──▶ store ──▶ UI
 * The engine never re-renders React per frame: it writes throttled values (≤10 Hz).
 */
import type {
  FocusTarget,
  SelectionRef,
  StarId,
  ViewLevel,
} from '../core/types';
import type { Quality } from '../render/contracts';

export type QualitySetting = Quality | 'auto';

export interface NavRequest {
  target: FocusTarget;
  /** 'fly' animates (van Wijk–Nuij smooth zoom-pan); 'jump' cuts instantly. */
  mode: 'fly' | 'jump';
  /** Monotonic id so the engine can detect new requests. */
  seq: number;
}

export interface Settings {
  quality: QualitySetting;
  /** 0..2 bloom strength multiplier. */
  bloom: number;
  labels: boolean;
  orbits: boolean;
  audio: boolean;
  /** 0..1 */
  volume: number;
  reducedMotion: boolean;
  showFps: boolean;
  /** Galaxy seed; changing it regenerates the whole universe. */
  galaxySeed: number;
  /** Idle auto-rotation of the camera in galaxy view. */
  autoRotate: boolean;
}

export interface VisitEntry {
  id: StarId;
  /** Epoch ms of the (most recent) visit. */
  at: number;
}

export interface Toast {
  id: number;
  text: string;
  sub?: string;
  tone: 'info' | 'success' | 'warning';
}

export type PanelKey = 'search' | 'help' | 'settings' | 'logbook';

export interface UIState {
  open: Record<PanelKey, boolean>;
  photoMode: boolean;
  onboardingSeen: boolean;
  /** Collapsed object panel (mobile bottom sheet / desktop side panel). */
  panelCollapsed: boolean;
}

export interface AppState {
  // ── boot
  /** False until the engine has rendered its first frame. */
  ready: boolean;
  /** 0..1 boot progress with a human message. */
  boot: { progress: number; message: string };

  // ── navigation (engine-written)
  level: ViewLevel;
  focus: FocusTarget;
  /** Camera distance to focus centre, km (throttled). */
  cameraDistanceKm: number;
  /** Non-null while flying; 0..1. */
  flightProgress: number | null;
  /** Pending navigation command (UI-written, engine-consumed). */
  navRequest: NavRequest | null;

  // ── selection (both)
  selection: SelectionRef | null;
  hover: SelectionRef | null;

  // ── time
  /** Simulation clock in days (throttled for display; the engine keeps the precise value). */
  simDays: number;
  /** Simulated seconds per real second. */
  timeScale: number;
  paused: boolean;

  // ── persisted user data
  settings: Settings;
  /** 1..5 ratings keyed by star or planet id. */
  ratings: Record<string, number>;
  bookmarks: string[];
  visited: VisitEntry[];

  // ── ui
  ui: UIState;
  toasts: Toast[];

  // ── actions
  requestFocus(target: FocusTarget, mode?: 'fly' | 'jump'): void;
  /** Planet/moon → star → galaxy. */
  goUp(): void;
  select(sel: SelectionRef | null): void;
  setHover(sel: SelectionRef | null): void;
  setTimeScale(scale: number): void;
  togglePause(): void;
  rate(id: string, stars: number): void;
  clearRating(id: string): void;
  toggleBookmark(id: string): void;
  markVisited(id: StarId): void;
  updateSettings(patch: Partial<Settings>): void;
  setPanel(key: PanelKey, open: boolean): void;
  togglePanel(key: PanelKey): void;
  setPhotoMode(on: boolean): void;
  setPanelCollapsed(collapsed: boolean): void;
  dismissOnboarding(): void;
  pushToast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
  /** Engine → store (throttled). */
  setFromEngine(patch: Partial<Pick<AppState, 'level' | 'focus' | 'cameraDistanceKm' | 'flightProgress' | 'simDays' | 'ready' | 'boot'>>): void;
  /** Engine marks a navRequest consumed. */
  consumeNavRequest(seq: number): void;
}
