// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusTarget } from '../core/types';
import { simDaysNow } from '../sim/time';
import { DEFAULT_GALAXY_SEED, getUniverse } from '../universe';
import { GEN_VERSION } from '../universe/contracts';
import {
  DEFAULT_TIME_SCALE,
  MAX_TIME_SCALE,
  MAX_TOASTS,
  MAX_VISITED,
  migratePersisted,
  parentFocus,
  STORAGE_KEY,
  sanitizePersisted,
  store,
  useStore,
} from './store';

const universe = getUniverse(DEFAULT_GALAXY_SEED);
const homeId = universe.homeStarId();
const home = universe.getSystem(homeId);
if (!home) throw new Error('home system missing');
const halcyon = home.planets.find((p) => p.properName === 'Halcyon');
if (!halcyon) throw new Error('Halcyon missing');
const lanthorn = halcyon.moons[0];

const act = () => store.getState();
const stored = (): Record<string, unknown> | null => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
};

/** Count store notifications while `fn` runs. */
function notifications(fn: () => void): number {
  let n = 0;
  const unsubscribe = store.subscribe(() => {
    n++;
  });
  fn();
  unsubscribe();
  return n;
}

beforeEach(() => {
  store.setState(store.getInitialState(), true);
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('defaults', () => {
  it('matches the documented initial state', () => {
    const s = act();
    expect(s.settings).toEqual({
      quality: 'auto',
      bloom: 1,
      labels: true,
      orbits: true,
      audio: false,
      volume: 0.6,
      reducedMotion: false,
      showFps: false,
      galaxySeed: DEFAULT_GALAXY_SEED,
      autoRotate: true,
    });
    expect(s.timeScale).toBe(DEFAULT_TIME_SCALE);
    expect(s.timeScale).toBe(3600);
    expect(s.paused).toBe(false);
    expect(s.focus).toEqual({ kind: 'galaxy', centerLy: [0, 0, 0] });
    expect(s.level).toBe('galaxy');
    expect(s.navRequest).toBeNull();
    expect(s.timeRequest).toBeNull();
    expect(s.flightTarget).toBeNull();
    expect(s.cameraLy).toEqual([0, 0, 0]);
    expect(s.userDataBySeed).toEqual({});
    expect(s.ready).toBe(false);
    expect(Math.abs(s.simDays - simDaysNow())).toBeLessThan(1);
    expect(s.ui.open).toEqual({ search: false, help: false, settings: false, logbook: false });
  });

  it('exposes the same store for React and non-React code', () => {
    expect(store).toBe(useStore);
  });
});

describe('navigation', () => {
  it('requestFocus issues monotonic requests (fly by default)', () => {
    act().requestFocus({ kind: 'star', id: homeId });
    const first = act().navRequest;
    expect(first).toMatchObject({ target: { kind: 'star', id: homeId }, mode: 'fly' });
    act().requestFocus({ kind: 'planet', id: halcyon.id }, 'jump');
    const second = act().navRequest;
    expect(second?.mode).toBe('jump');
    expect(second?.seq).toBe((first?.seq ?? 0) + 1);
  });

  it('consumeNavRequest only clears the matching request', () => {
    act().requestFocus({ kind: 'star', id: homeId });
    const seq = act().navRequest?.seq ?? -1;
    act().consumeNavRequest(seq - 1);
    expect(act().navRequest).not.toBeNull();
    act().consumeNavRequest(seq);
    expect(act().navRequest).toBeNull();
  });

  it('goUp climbs moon → planet → star → galaxy at the star → galactic centre, then stops', () => {
    store.setState({ focus: { kind: 'moon', id: lanthorn.id } });
    const steps: FocusTarget[] = [];
    for (let i = 0; i < 4; i++) {
      act().goUp();
      const target = act().navRequest?.target;
      if (target) steps.push(target);
      act().consumeNavRequest(act().navRequest?.seq ?? -1);
      if (target) store.setState({ focus: target });
    }
    const starPos = universe.getStar(homeId)?.posLy;
    expect(steps).toEqual([
      { kind: 'planet', id: halcyon.id },
      { kind: 'star', id: homeId },
      { kind: 'galaxy', centerLy: starPos },
      { kind: 'galaxy', centerLy: [0, 0, 0] },
    ]);
    act().goUp(); // already at the galactic centre
    expect(act().navRequest).toBeNull();
  });

  it('goUp selects the new target and climbs from a pending request', () => {
    act().requestFocus({ kind: 'moon', id: lanthorn.id });
    act().goUp();
    act().goUp();
    expect(act().navRequest?.target).toEqual({ kind: 'star', id: homeId });
    expect(act().selection).toEqual({ kind: 'star', id: homeId });
    act().goUp();
    expect(act().selection).toBeNull();
  });

  it('parentFocus falls back to the galactic centre for unknown stars', () => {
    expect(parentFocus({ kind: 'star', id: '0.9.9.9.999' }, universe)).toEqual({
      kind: 'galaxy',
      centerLy: [0, 0, 0],
    });
  });

  it('goUp climbs from the flight destination when no request is pending', () => {
    store.setState({
      focus: { kind: 'star', id: homeId },
      flightTarget: { kind: 'planet', id: halcyon.id },
    });
    act().goUp();
    expect(act().navRequest?.target).toEqual({ kind: 'star', id: homeId });
  });
});

describe('selection & hover', () => {
  it('select sets and clears, without notifying on repeats', () => {
    act().select({ kind: 'planet', id: halcyon.id });
    expect(act().selection).toEqual({ kind: 'planet', id: halcyon.id });
    expect(notifications(() => act().select({ kind: 'planet', id: halcyon.id }))).toBe(0);
    act().select(null);
    expect(act().selection).toBeNull();
  });

  it('setHover sets and clears, without notifying on repeats', () => {
    act().setHover({ kind: 'star', id: homeId });
    expect(act().hover).toEqual({ kind: 'star', id: homeId });
    expect(notifications(() => act().setHover({ kind: 'star', id: homeId }))).toBe(0);
    act().setHover(null);
    expect(act().hover).toBeNull();
  });
});

describe('time', () => {
  it('setTimeScale sets, clamps and ignores non-finite values', () => {
    act().setTimeScale(86_400);
    expect(act().timeScale).toBe(86_400);
    act().setTimeScale(-60);
    expect(act().timeScale).toBe(-60);
    act().setTimeScale(1e20);
    expect(act().timeScale).toBe(MAX_TIME_SCALE);
    act().setTimeScale(Number.NaN);
    expect(act().timeScale).toBe(MAX_TIME_SCALE);
  });

  it('requestTime issues monotonic clock requests; consumeTimeRequest clears the matching one', () => {
    act().requestTime(10_000);
    const first = act().timeRequest;
    expect(first?.simDays).toBe(10_000);
    act().requestTime(Number.NaN);
    expect(act().timeRequest).toBe(first);
    act().requestTime(12_000);
    const second = act().timeRequest;
    expect(second?.seq).toBe((first?.seq ?? 0) + 1);
    act().consumeTimeRequest(first?.seq ?? -1);
    expect(act().timeRequest).toBe(second);
    act().consumeTimeRequest(second?.seq ?? -1);
    expect(act().timeRequest).toBeNull();
  });

  it('togglePause flips paused', () => {
    act().togglePause();
    expect(act().paused).toBe(true);
    act().togglePause();
    expect(act().paused).toBe(false);
  });
});

describe('ratings, bookmarks, logbook', () => {
  it('rate clamps to integers 1..5 and ignores junk', () => {
    act().rate('a', 3.6);
    act().rate('b', 0);
    act().rate('c', 9);
    act().rate('d', Number.NaN);
    act().rate('', 3);
    expect(act().ratings).toEqual({ a: 4, b: 1, c: 5 });
  });

  it('rating a far-away planet makes its system searchable', () => {
    const star = universe
      .queryStars(universe.getStar(homeId)?.posLy ?? [0, 0, 0], 80)
      .find(
        (s) =>
          s.id !== homeId &&
          s.name !== s.designation &&
          (universe.getSystem(s.id)?.planets.length ?? 0) > 0,
      );
    const planet = star ? universe.getSystem(star.id)?.planets[0] : undefined;
    if (!planet) throw new Error('no mock planet found');
    act().rate(planet.id, 4);
    expect(universe.search(planet.name, 50).some((r) => r.ref.id === planet.id)).toBe(true);
  });

  it('clearRating removes one rating', () => {
    act().rate('a', 2);
    act().rate('b', 5);
    act().clearRating('a');
    expect(act().ratings).toEqual({ b: 5 });
    expect(notifications(() => act().clearRating('missing'))).toBe(0);
  });

  it('toggleBookmark adds (most recent first) and removes', () => {
    act().toggleBookmark('x');
    act().toggleBookmark('y');
    expect(act().bookmarks).toEqual(['y', 'x']);
    act().toggleBookmark('x');
    expect(act().bookmarks).toEqual(['y']);
  });

  it('markVisited keeps one entry per id, most recent first, capped', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    act().markVisited('a');
    now.mockReturnValue(2000);
    act().markVisited('b');
    now.mockReturnValue(3000);
    act().markVisited('a');
    expect(act().visited).toEqual([
      { id: 'a', at: 3000 },
      { id: 'b', at: 2000 },
    ]);
    for (let i = 0; i < MAX_VISITED + 5; i++) act().markVisited(`s${i}`);
    expect(act().visited).toHaveLength(MAX_VISITED);
    expect(act().visited[0].id).toBe(`s${MAX_VISITED + 4}`);
  });
});

describe('settings', () => {
  it('updateSettings merges, validates and clamps', () => {
    act().updateSettings({ bloom: 5, volume: -1, quality: 'high', labels: false });
    expect(act().settings).toMatchObject({
      bloom: 2,
      volume: 0,
      quality: 'high',
      labels: false,
      orbits: true,
    });
    // @ts-expect-error — runtime validation of untrusted input
    act().updateSettings({ quality: 'insane', bloom: 'lots' });
    expect(act().settings.quality).toBe('high');
    expect(act().settings.bloom).toBe(2);
  });

  it('updateSettings is a no-op when nothing changes', () => {
    expect(notifications(() => act().updateSettings({ labels: true, bloom: 1 }))).toBe(0);
  });

  it('switching seeds stashes and restores per-seed user data', () => {
    act().rate('a', 5);
    act().toggleBookmark('b');
    act().updateSettings({ galaxySeed: 42 });
    expect(act()).toMatchObject({ ratings: {}, bookmarks: [], visited: [] });
    expect(act().userDataBySeed[String(DEFAULT_GALAXY_SEED)]).toMatchObject({
      ratings: { a: 5 },
      bookmarks: ['b'],
    });
    act().rate('x', 2);
    act().updateSettings({ galaxySeed: DEFAULT_GALAXY_SEED });
    expect(act()).toMatchObject({ ratings: { a: 5 }, bookmarks: ['b'] });
    expect(Object.keys(act().userDataBySeed)).toEqual(['42']);
    expect(act().userDataBySeed['42'].ratings).toEqual({ x: 2 });
  });

  it('a new galaxy seed drops stale ids and jumps to the galactic centre', () => {
    act().select({ kind: 'star', id: homeId });
    act().setHover({ kind: 'star', id: homeId });
    act().updateSettings({ galaxySeed: 42 });
    const s = act();
    expect(s.settings.galaxySeed).toBe(42);
    expect(s.selection).toBeNull();
    expect(s.hover).toBeNull();
    expect(s.navRequest).toMatchObject({
      target: { kind: 'galaxy', centerLy: [0, 0, 0] },
      mode: 'jump',
    });
  });
});

describe('ui', () => {
  it('setPanel / togglePanel', () => {
    act().setPanel('search', true);
    expect(act().ui.open.search).toBe(true);
    act().togglePanel('search');
    act().togglePanel('logbook');
    expect(act().ui.open).toEqual({ search: false, help: false, settings: false, logbook: true });
    expect(notifications(() => act().setPanel('logbook', true))).toBe(0);
  });

  it('setPhotoMode, setPanelCollapsed, dismissOnboarding', () => {
    act().setPhotoMode(true);
    act().setPanelCollapsed(true);
    act().dismissOnboarding();
    expect(act().ui).toMatchObject({ photoMode: true, panelCollapsed: true, onboardingSeen: true });
    act().setPhotoMode(false);
    expect(act().ui.photoMode).toBe(false);
  });

  it('pushToast assigns increasing ids; dismissToast removes; the queue is capped', () => {
    act().pushToast({ text: 'Rated', tone: 'success' });
    act().pushToast({ text: 'Hmm', sub: 'details', tone: 'warning' });
    const [a, b] = act().toasts;
    expect(b.id).toBeGreaterThan(a.id);
    expect(b).toMatchObject({ text: 'Hmm', sub: 'details', tone: 'warning' });
    act().dismissToast(a.id);
    expect(act().toasts.map((t) => t.id)).toEqual([b.id]);
    for (let i = 0; i < MAX_TOASTS + 3; i++) act().pushToast({ text: `t${i}`, tone: 'info' });
    expect(act().toasts).toHaveLength(MAX_TOASTS);
    expect(act().toasts.at(-1)?.text).toBe(`t${MAX_TOASTS + 2}`);
  });
});

describe('engine bridge', () => {
  it('setFromEngine applies changes and skips no-op updates', () => {
    act().setFromEngine({
      level: 'system',
      focus: { kind: 'star', id: homeId },
      cameraDistanceKm: 1e8,
      ready: true,
    });
    expect(act()).toMatchObject({
      level: 'system',
      focus: { kind: 'star', id: homeId },
      cameraDistanceKm: 1e8,
      ready: true,
    });
    act().setFromEngine({ cameraLy: [1, 2, 3], flightTarget: { kind: 'planet', id: halcyon.id } });
    expect(act()).toMatchObject({
      cameraLy: [1, 2, 3],
      flightTarget: { kind: 'planet', id: halcyon.id },
    });
    const n = notifications(() =>
      act().setFromEngine({
        level: 'system',
        focus: { kind: 'star', id: homeId },
        cameraDistanceKm: 1e8,
        cameraLy: [1, 2, 3],
        flightTarget: { kind: 'planet', id: halcyon.id },
      }),
    );
    expect(n).toBe(0);
    act().setFromEngine({ flightTarget: null });
    expect(act().flightTarget).toBeNull();
    act().setFromEngine({
      boot: { progress: 0.5, message: 'Igniting stars…' },
      flightProgress: 0.25,
      simDays: 12,
    });
    expect(act()).toMatchObject({ boot: { progress: 0.5 }, flightProgress: 0.25, simDays: 12 });
  });
});

describe('persistence', () => {
  it('writes only the persisted slice under sidereal:v1', () => {
    act().rate('a', 4);
    act().toggleBookmark('b');
    act().markVisited('c');
    act().dismissOnboarding();
    act().updateSettings({ showFps: true });
    act().requestFocus({ kind: 'star', id: homeId });
    const saved = stored();
    expect(saved?.version).toBe(GEN_VERSION);
    const state = saved?.state as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual([
      'bookmarks',
      'onboardingSeen',
      'ratings',
      'settings',
      'userDataBySeed',
      'visited',
    ]);
    expect(state).toMatchObject({
      ratings: { a: 4 },
      bookmarks: ['b'],
      onboardingSeen: true,
      settings: { showFps: true },
    });
  });

  it('rehydrates and sanitises stored data', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          settings: { quality: 'ultra', bloom: 99, volume: 0.25, labels: 'yes' },
          ratings: { good: 4, bad: 'x', big: 12 },
          bookmarks: ['a', 'a', 7, 'b'],
          visited: [{ id: 'old', at: 1 }, { id: 'new', at: 5 }, { id: 'old', at: 3 }, { at: 9 }],
          onboardingSeen: true,
        },
      }),
    );
    await store.persist.rehydrate();
    const s = act();
    expect(s.settings).toMatchObject({ quality: 'ultra', bloom: 2, volume: 0.25, labels: true });
    expect(s.ratings).toEqual({ good: 4, big: 5 });
    expect(s.bookmarks).toEqual(['a', 'b']);
    expect(s.visited).toEqual([
      { id: 'new', at: 5 },
      { id: 'old', at: 3 },
    ]);
    expect(s.ui.onboardingSeen).toBe(true);
    expect(s.ui.open.search).toBe(false); // non-persisted UI state survives the merge
  });

  it('drops user data written by another generator version but keeps settings', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: GEN_VERSION + 1,
        state: {
          settings: { bloom: 1.5 },
          ratings: { old: 3 },
          userDataBySeed: { 7: { ratings: { z: 1 } } },
        },
      }),
    );
    await store.persist.rehydrate();
    expect(act().settings.bloom).toBe(1.5);
    expect(act().ratings).toEqual({});
    expect(act().userDataBySeed).toEqual({});
    expect(migratePersisted({ ratings: { a: 2 } }, GEN_VERSION).ratings).toEqual({ a: 2 });
  });

  it('ignores corrupt storage', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    await store.persist.rehydrate();
    expect(act().settings.quality).toBe('auto');
  });

  it('keeps working when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => act().rate('a', 3)).not.toThrow();
    expect(act().ratings.a).toBe(3);
    await expect(Promise.resolve(store.persist.rehydrate())).resolves.toBeUndefined();
  });

  it('sanitizePersisted caps the logbook', () => {
    const visited = Array.from({ length: MAX_VISITED + 50 }, (_, i) => ({ id: `s${i}`, at: i }));
    const p = sanitizePersisted({ visited });
    expect(p.visited).toHaveLength(MAX_VISITED);
    expect(p.visited[0]).toEqual({ id: `s${MAX_VISITED + 49}`, at: MAX_VISITED + 49 });
    expect(sanitizePersisted(null).settings.galaxySeed).toBe(DEFAULT_GALAXY_SEED);
    const stash = sanitizePersisted({
      userDataBySeed: { 12: { bookmarks: ['q'] }, nope: {}, 13: {} },
    }).userDataBySeed;
    expect(Object.keys(stash)).toEqual(['12']);
  });
});
