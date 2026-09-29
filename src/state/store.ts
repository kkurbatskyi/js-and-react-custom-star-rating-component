/**
 * Global app state — zustand 5 store implementing `AppState` (./contracts.ts).
 *
 *   UI ──actions──▶ store ──navRequest / timeRequest──▶ engine   (engine calls consume*(seq))
 *   engine ──setFromEngine (≤10 Hz)──▶ store ──▶ UI
 *
 * Persistence (localStorage key `sidereal:v1`, zustand-persist `version` = GEN_VERSION):
 * settings, `ui.onboardingSeen`, and the user data — ratings, bookmarks, visited — for the current
 * galaxy seed plus `userDataBySeed` for the others. Ids only mean something within one seed AND
 * one generator version, so switching seeds stashes/restores the user data, and a GEN_VERSION bump
 * keeps settings but drops user data that now points at different objects.
 * Storage is untrusted and may throw (sandboxed iframes, quota, private mode): every access is
 * wrapped, every loaded value validated, and the app runs fine without storage.
 * Non-React code uses `store.getState()` / `store.subscribe()`.
 */
import { create } from 'zustand';
import { type PersistStorage, persist } from 'zustand/middleware';
import { clamp } from '../core/math';
import type { FocusTarget, SelectionRef, Vec3Tuple } from '../core/types';
import { SECONDS_PER_YEAR } from '../core/units';
import { simDaysNow } from '../sim/time';
import { DEFAULT_GALAXY_SEED, getUniverse, planetIdOf, starIdOf } from '../universe';
import { GEN_VERSION, type Universe } from '../universe/contracts';
import type { AppState, NavRequest, QualitySetting, Settings, UIState, VisitEntry } from './contracts';

/** Storage key; the suffix is the storage *schema* version (the generator version is `version`). */
export const STORAGE_KEY = 'sidereal:v1';
export const MAX_VISITED = 200;
export const MAX_BOOKMARKS = 500;
/** Stashed per-seed user data kept for at most this many other seeds. */
export const MAX_STASHED_SEEDS = 16;
/** Oldest toasts are dropped beyond this many. */
export const MAX_TOASTS = 5;
/** One simulated hour per real second. */
export const DEFAULT_TIME_SCALE = 3600;
/** ±10 simulated years per real second. */
export const MAX_TIME_SCALE = 10 * SECONDS_PER_YEAR;

const GALACTIC_CENTRE: Vec3Tuple = [0, 0, 0];
const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];

export type UserData = AppState['userDataBySeed'][string];

// ───────────────────────────────────────────── Defaults

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

export function defaultSettings(): Settings {
  return {
    quality: 'auto',
    bloom: 1,
    labels: true,
    orbits: true,
    audio: false,
    volume: 0.6,
    reducedMotion: prefersReducedMotion(),
    showFps: false,
    galaxySeed: DEFAULT_GALAXY_SEED,
    autoRotate: true,
  };
}

function defaultUI(): UIState {
  return {
    open: { search: false, help: false, settings: false, logbook: false },
    photoMode: false,
    onboardingSeen: false,
    panelCollapsed: false,
  };
}

// ───────────────────────────────────────────── Validation of untrusted input

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isQualitySetting = (v: unknown): v is QualitySetting =>
  typeof v === 'string' && (QUALITY_SETTINGS as readonly string[]).includes(v);

/** Apply an untrusted settings patch onto `base`: unknown/invalid fields are dropped, ranges clamped. */
export function sanitizeSettings(patch: unknown, base: Settings): Settings {
  if (!isRecord(patch)) return base;
  const out: Settings = { ...base };
  if (isQualitySetting(patch.quality)) out.quality = patch.quality;
  const bloom = finite(patch.bloom);
  if (bloom !== null) out.bloom = clamp(bloom, 0, 2);
  const volume = finite(patch.volume);
  if (volume !== null) out.volume = clamp(volume, 0, 1);
  const seed = finite(patch.galaxySeed);
  if (seed !== null) out.galaxySeed = Math.trunc(seed) >>> 0;
  for (const key of ['labels', 'orbits', 'audio', 'reducedMotion', 'showFps', 'autoRotate'] as const) {
    const v = patch[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

const clampRating = (stars: number): number => clamp(Math.round(stars), 1, 5);

function sanitizeRatings(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [id, stars] of Object.entries(v)) {
    const n = finite(stars);
    if (id && n !== null) out[id] = clampRating(n);
  }
  return out;
}

function sanitizeBookmarks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const ids = v.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)].slice(0, MAX_BOOKMARKS);
}

/** Most recent first, one entry per id, at most MAX_VISITED. */
function sanitizeVisited(v: unknown): VisitEntry[] {
  if (!Array.isArray(v)) return [];
  const entries = v
    .filter(isRecord)
    .map((e) => ({ id: e.id, at: finite(e.at) }))
    .filter((e): e is VisitEntry => typeof e.id === 'string' && e.id.length > 0 && e.at !== null)
    .sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const out: VisitEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length === MAX_VISITED) break;
  }
  return out;
}

function sanitizeUserData(v: unknown): UserData {
  const r = isRecord(v) ? v : {};
  return { ratings: sanitizeRatings(r.ratings), bookmarks: sanitizeBookmarks(r.bookmarks), visited: sanitizeVisited(r.visited) };
}

const isEmptyUserData = (d: UserData): boolean =>
  Object.keys(d.ratings).length === 0 && d.bookmarks.length === 0 && d.visited.length === 0;

/** Seeds are uint32 decimal strings; empty entries are dropped; at most MAX_STASHED_SEEDS kept. */
function sanitizeUserDataBySeed(v: unknown): Record<string, UserData> {
  const out: Record<string, UserData> = {};
  if (!isRecord(v)) return out;
  for (const [seed, data] of Object.entries(v)) {
    if (!/^(0|[1-9]\d{0,9})$/.test(seed) || Number(seed) > 0xffffffff) continue;
    const clean = sanitizeUserData(data);
    if (!isEmptyUserData(clean)) out[seed] = clean;
    if (Object.keys(out).length === MAX_STASHED_SEEDS) break;
  }
  return out;
}

/** The persisted subset of AppState (flat, so versioning and validation stay simple). */
export interface PersistedSlice extends UserData {
  settings: Settings;
  userDataBySeed: Record<string, UserData>;
  onboardingSeen: boolean;
}

export function sanitizePersisted(v: unknown): PersistedSlice {
  const r = isRecord(v) ? v : {};
  return {
    settings: sanitizeSettings(r.settings, defaultSettings()),
    ...sanitizeUserData(r),
    userDataBySeed: sanitizeUserDataBySeed(r.userDataBySeed),
    onboardingSeen: r.onboardingSeen === true,
  };
}

/**
 * A different GEN_VERSION generated a different universe: keep settings and onboarding, drop
 * user data whose ids now point at other objects (or at nothing).
 */
export function migratePersisted(persisted: unknown, version: number): PersistedSlice {
  const p = sanitizePersisted(persisted);
  if (version === GEN_VERSION) return p;
  return { ...p, ratings: {}, bookmarks: [], visited: [], userDataBySeed: {} };
}

// ───────────────────────────────────────────── Storage (never throws)

function localStorageOrNull(): Storage | null {
  try {
    // Merely touching `localStorage` throws a SecurityError in some sandboxed iframes.
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function createSafeStorage(): PersistStorage<PersistedSlice> {
  let last: PersistedSlice | null = null;
  return {
    getItem(name) {
      try {
        const raw = localStorageOrNull()?.getItem(name) ?? null;
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return null;
        // The version tells `migrate` which generator produced the ids.
        return { state: sanitizePersisted(parsed.state), version: finite(parsed.version) ?? 0 };
      } catch {
        return null; // corrupt JSON or blocked storage: start from defaults
      }
    },
    setItem(name, value) {
      // `persist` calls this after EVERY set() — including the engine's 10 Hz updates — so skip the
      // synchronous storage write unless a persisted field actually changed (they are immutable).
      const s = value.state;
      if (
        last &&
        s.settings === last.settings &&
        s.ratings === last.ratings &&
        s.bookmarks === last.bookmarks &&
        s.visited === last.visited &&
        s.userDataBySeed === last.userDataBySeed &&
        s.onboardingSeen === last.onboardingSeen
      ) {
        return;
      }
      last = s;
      try {
        localStorageOrNull()?.setItem(name, JSON.stringify(value));
      } catch {
        // Quota exceeded or storage blocked: keep running without persistence.
      }
    },
    removeItem(name) {
      last = null;
      try {
        localStorageOrNull()?.removeItem(name);
      } catch {
        // Storage blocked: nothing to remove.
      }
    },
  };
}

// ───────────────────────────────────────────── Navigation helpers

const sameRef = (a: SelectionRef | null, b: SelectionRef | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);

const sameTuple = (a: Vec3Tuple, b: Vec3Tuple): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function sameFocus(a: FocusTarget | null, b: FocusTarget | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.kind === 'galaxy' || b.kind === 'galaxy') {
    return a.kind === 'galaxy' && b.kind === 'galaxy' && sameTuple(a.centerLy, b.centerLy);
  }
  return a.kind === b.kind && a.id === b.id;
}

const isGalacticCentre = (t: FocusTarget): boolean => t.kind === 'galaxy' && sameTuple(t.centerLy, GALACTIC_CENTRE);

/** One level up: moon → planet → star → galaxy (centred on the star) → galactic centre. */
export function parentFocus(target: FocusTarget, universe: Universe): FocusTarget | null {
  switch (target.kind) {
    case 'moon': {
      const planetId = planetIdOf(target.id);
      return planetId ? { kind: 'planet', id: planetId } : { kind: 'galaxy', centerLy: GALACTIC_CENTRE };
    }
    case 'planet': {
      const starId = starIdOf(target.id);
      return starId ? { kind: 'star', id: starId } : { kind: 'galaxy', centerLy: GALACTIC_CENTRE };
    }
    case 'star': {
      const pos = universe.getRecord(target.id)?.posLy ?? GALACTIC_CENTRE;
      return { kind: 'galaxy', centerLy: [pos[0], pos[1], pos[2]] };
    }
    case 'galaxy':
      return isGalacticCentre(target) ? null : { kind: 'galaxy', centerLy: GALACTIC_CENTRE };
  }
}

const selectionFor = (target: FocusTarget): SelectionRef | null =>
  target.kind === 'galaxy' ? null : { kind: target.kind, id: target.id };

// ───────────────────────────────────────────── Store

type EnginePatch = Parameters<AppState['setFromEngine']>[0];

/** Monotonic counters live outside the state so resets can never make a `seq` go backwards. */
let navSeq = 0;
let timeSeq = 0;
let toastSeq = 0;

const nextNav = (target: FocusTarget, mode: NavRequest['mode']): NavRequest => {
  navSeq += 1;
  return { target, mode, seq: navSeq };
};

/** Make user-touched ids searchable (star, planet or moon ids). */
function rememberIds(seed: number, ids: Iterable<string>): void {
  const universe = getUniverse(seed);
  for (const id of ids) universe.remember(id);
}

const userDataIds = (d: UserData): string[] => [...Object.keys(d.ratings), ...d.bookmarks, ...d.visited.map((v) => v.id)];

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ready: false,
      boot: { progress: 0, message: 'Charting the galaxy…' },

      level: 'galaxy',
      focus: { kind: 'galaxy', centerLy: GALACTIC_CENTRE },
      cameraDistanceKm: 0,
      cameraLy: GALACTIC_CENTRE,
      flightProgress: null,
      flightTarget: null,
      navRequest: null,

      selection: null,
      hover: null,

      simDays: simDaysNow(),
      timeScale: DEFAULT_TIME_SCALE,
      paused: false,
      timeRequest: null,

      settings: defaultSettings(),
      ratings: {},
      bookmarks: [],
      visited: [],
      userDataBySeed: {},

      ui: defaultUI(),
      toasts: [],

      requestFocus: (target, mode = 'fly') => set({ navRequest: nextNav(target, mode) }),

      goUp: () => {
        const { navRequest, flightTarget, focus, settings } = get();
        // Climb from where we are *heading*, so repeated Esc presses go up several levels.
        const current = navRequest?.target ?? flightTarget ?? focus;
        const target = parentFocus(current, getUniverse(settings.galaxySeed));
        if (target) set({ navRequest: nextNav(target, 'fly'), selection: selectionFor(target) });
      },

      requestTime: (simDays) => {
        if (!Number.isFinite(simDays)) return;
        timeSeq += 1;
        set({ timeRequest: { simDays, seq: timeSeq } });
      },

      consumeTimeRequest: (seq) => {
        if (get().timeRequest?.seq === seq) set({ timeRequest: null });
      },

      select: (sel) => {
        if (!sameRef(get().selection, sel)) set({ selection: sel });
      },

      setHover: (sel) => {
        if (!sameRef(get().hover, sel)) set({ hover: sel });
      },

      setTimeScale: (scale) => {
        if (Number.isFinite(scale)) set({ timeScale: clamp(scale, -MAX_TIME_SCALE, MAX_TIME_SCALE) });
      },

      togglePause: () => set((s) => ({ paused: !s.paused })),

      rate: (id, stars) => {
        if (!id || !Number.isFinite(stars)) return;
        set((s) => ({ ratings: { ...s.ratings, [id]: clampRating(stars) } }));
        rememberIds(get().settings.galaxySeed, [id]);
      },

      clearRating: (id) => {
        if (!(id in get().ratings)) return;
        set((s) => ({ ratings: Object.fromEntries(Object.entries(s.ratings).filter(([key]) => key !== id)) }));
      },

      toggleBookmark: (id) => {
        if (!id) return;
        const { bookmarks } = get();
        if (bookmarks.includes(id)) {
          set({ bookmarks: bookmarks.filter((b) => b !== id) });
        } else {
          set({ bookmarks: [id, ...bookmarks].slice(0, MAX_BOOKMARKS) });
          rememberIds(get().settings.galaxySeed, [id]);
        }
      },

      markVisited: (id) => {
        if (!id) return;
        set((s) => ({
          visited: [{ id, at: Date.now() }, ...s.visited.filter((v) => v.id !== id)].slice(0, MAX_VISITED),
        }));
        rememberIds(get().settings.galaxySeed, [id]);
      },

      updateSettings: (patch) => {
        const s = get();
        const prev = s.settings;
        const next = sanitizeSettings(patch, prev);
        const changed = (Object.keys(next) as (keyof Settings)[]).some((k) => next[k] !== prev[k]);
        if (!changed) return;
        if (next.galaxySeed === prev.galaxySeed) {
          set({ settings: next });
          return;
        }
        // A new galaxy: stash this seed's user data, restore the new seed's, and drop every id in
        // flight (they belong to the old universe).
        const prevKey = String(prev.galaxySeed);
        const nextKey = String(next.galaxySeed);
        const current: UserData = { ratings: s.ratings, bookmarks: s.bookmarks, visited: s.visited };
        const kept = Object.entries(s.userDataBySeed).filter(([k]) => k !== prevKey && k !== nextKey);
        if (!isEmptyUserData(current)) kept.push([prevKey, current]);
        const stash = Object.fromEntries(kept.slice(-MAX_STASHED_SEEDS)); // oldest stashes go first
        const restored = s.userDataBySeed[nextKey] ?? { ratings: {}, bookmarks: [], visited: [] };
        set({
          settings: next,
          ...restored,
          userDataBySeed: stash,
          selection: null,
          hover: null,
          navRequest: nextNav({ kind: 'galaxy', centerLy: GALACTIC_CENTRE }, 'jump'),
        });
        rememberIds(next.galaxySeed, userDataIds(restored));
      },

      setPanel: (key, open) => {
        const { ui } = get();
        if (ui.open[key] !== open) set({ ui: { ...ui, open: { ...ui.open, [key]: open } } });
      },

      togglePanel: (key) => get().setPanel(key, !get().ui.open[key]),

      setPhotoMode: (on) => {
        const { ui } = get();
        if (ui.photoMode !== on) set({ ui: { ...ui, photoMode: on } });
      },

      setPanelCollapsed: (collapsed) => {
        const { ui } = get();
        if (ui.panelCollapsed !== collapsed) set({ ui: { ...ui, panelCollapsed: collapsed } });
      },

      dismissOnboarding: () => {
        const { ui } = get();
        if (!ui.onboardingSeen) set({ ui: { ...ui, onboardingSeen: true } });
      },

      pushToast: (t) => {
        toastSeq += 1;
        const toast = { ...t, id: toastSeq };
        set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }));
      },

      dismissToast: (id) => {
        if (get().toasts.some((t) => t.id === id)) set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },

      setFromEngine: (patch) => {
        const s = get();
        const changed = (Object.keys(patch) as (keyof EnginePatch)[]).some((k) => {
          switch (k) {
            case 'focus':
              return patch.focus !== undefined && !sameFocus(patch.focus, s.focus);
            case 'flightTarget':
              return patch.flightTarget !== undefined && !sameFocus(patch.flightTarget, s.flightTarget);
            case 'cameraLy':
              return patch.cameraLy !== undefined && !sameTuple(patch.cameraLy, s.cameraLy);
            case 'boot':
              return patch.boot !== undefined && (patch.boot.progress !== s.boot.progress || patch.boot.message !== s.boot.message);
            default:
              return !Object.is(patch[k], s[k]);
          }
        });
        if (changed) set(patch);
      },

      consumeNavRequest: (seq) => {
        if (get().navRequest?.seq === seq) set({ navRequest: null });
      },
    }),
    {
      name: STORAGE_KEY,
      version: GEN_VERSION,
      storage: createSafeStorage(),
      partialize: (s): PersistedSlice => ({
        settings: s.settings,
        ratings: s.ratings,
        bookmarks: s.bookmarks,
        visited: s.visited,
        userDataBySeed: s.userDataBySeed,
        onboardingSeen: s.ui.onboardingSeen,
      }),
      migrate: migratePersisted,
      merge: (persisted, current) => {
        const p = sanitizePersisted(persisted);
        return {
          ...current,
          settings: p.settings,
          ratings: p.ratings,
          bookmarks: p.bookmarks,
          visited: p.visited,
          userDataBySeed: p.userDataBySeed,
          ui: { ...current.ui, onboardingSeen: p.onboardingSeen },
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const ids = userDataIds(state);
        if (ids.length > 0) rememberIds(state.settings.galaxySeed, ids);
      },
    },
  ),
);

/** Alias for non-React code: `store.getState()`, `store.subscribe(listener)`. */
export const store = useStore;
