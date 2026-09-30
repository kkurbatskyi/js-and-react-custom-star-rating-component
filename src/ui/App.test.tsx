// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerEngineCommands, type ViewInsets } from '../state/bridge';
import { store } from '../state/store';
import { App } from './App';
import { useSheetStore } from './lib/sheetStore';
import { halcyon, homeId, lanthorn, resetStore } from './testing';

/** happy-dom has no layout: give the overlay a size so the responsive logic has something to read. */
function layoutSize(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  }));
}

beforeEach(() => {
  resetStore();
  useSheetStore.setState({ full: false });
  layoutSize(1280, 800);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const select = (kind: 'star' | 'planet' | 'moon', id: string) =>
  act(() => {
    store.setState({ selection: { kind, id }, focus: { kind, id } });
  });

describe('App', () => {
  it('lays out the instrument: banner, breadcrumbs, clock, details', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sidereal' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Location' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Simulation clock' })).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: 'Camera' })).toBeTruthy();
    // Nothing selected: the galaxy card, with somewhere to begin
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fly home/ })).toBeTruthy();
  });

  it('shows the selected star, and rating it writes to the store', () => {
    render(<App />);
    select('star', homeId);
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Aurelia' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Rate Aurelia 4 of 5 stars' }));
    expect(store.getState().ratings[homeId]).toBe(4);
    expect(within(panel).getByText('Recommended')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Rate Aurelia 4 of 5 stars' }));
    expect(store.getState().ratings[homeId]).toBeUndefined();
    // the surveyor's rating is read-only, with its own spoken value
    expect(
      within(panel).getByRole('img', { name: /Surveyor’s rating for Aurelia: .* of 5 stars/ }),
    ).toBeTruthy();
  });

  it('follows the focus when nothing is selected, and the flight destination while flying', () => {
    render(<App />);
    act(() => {
      store.setState({ focus: { kind: 'star', id: homeId } });
    });
    expect(
      within(screen.getByRole('complementary')).getByRole('heading', { level: 2, name: 'Aurelia' }),
    ).toBeTruthy();
    act(() => {
      store.setState({ flightTarget: { kind: 'planet', id: halcyon.id }, flightProgress: 0.4 });
    });
    expect(
      within(screen.getByRole('complementary')).getByRole('heading', { level: 2, name: 'Halcyon' }),
    ).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Location' });
    expect(within(nav).getByText('En route to')).toBeTruthy();
    expect(within(nav).getByText('Halcyon')).toBeTruthy();
  });

  it('describes a planet and a moon, and links its children and parents', () => {
    render(<App />);
    select('planet', halcyon.id);
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByText('Terran world · habitable zone')).toBeTruthy();
    expect(within(panel).getByRole('meter', { name: 'Habitability index' })).toBeTruthy();
    expect(within(panel).getByRole('heading', { name: /^Atmosphere/ })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /Lanthorn.*Fly there/ }));
    expect(store.getState().navRequest?.target).toEqual({ kind: 'moon', id: lanthorn.id });
    select('moon', lanthorn.id);
    expect(within(screen.getByRole('complementary')).getByText(/of Halcyon$/)).toBeTruthy();
  });

  it('bookmarks and copies a link', async () => {
    render(<App />);
    select('planet', halcyon.id);
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark Halcyon' }));
    expect(store.getState().bookmarks).toContain(halcyon.id);
    expect(
      screen
        .getByRole('button', { name: 'Remove bookmark for Halcyon' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('"Reset view" replaces "Fly here" when you are already there, and calls the engine', () => {
    let resets = 0;
    const off = registerEngineCommands({
      zoomBy() {},
      resetView: () => resets++,
      capture: async () => null,
      setViewInsets() {},
    });
    render(<App />);
    select('star', homeId); // selection and focus agree
    const panel = () => within(screen.getByRole('complementary'));
    fireEvent.click(panel().getByRole('button', { name: /Reset view/ }));
    expect(resets).toBe(1);
    act(() => {
      store.setState({ focus: { kind: 'galaxy', centerLy: [0, 0, 0] } });
    });
    fireEvent.click(panel().getByRole('button', { name: /Fly here/ }));
    expect(store.getState().navRequest?.target).toEqual({ kind: 'star', id: homeId });
    off();
  });

  it('collapses the details plate to a tab and back', () => {
    render(<App />);
    select('star', homeId);
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(store.getState().ui.panelCollapsed).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(store.getState().ui.panelCollapsed).toBe(false);
  });

  it('opens dialogs from the top bar, makes the rest inert, and closes with Escape', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Logbook' }));
    expect(screen.getByRole('dialog', { name: 'Logbook' })).toBeTruthy();
    expect(document.querySelector('.sd-main')?.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.sd-main')?.hasAttribute('inert')).toBe(false);
  });

  it('toggles sound from the top bar', () => {
    render(<App />);
    const before = store.getState().settings.audio;
    fireEvent.click(
      screen.getByRole('button', { name: before ? 'Turn sound off' : 'Turn sound on' }),
    );
    expect(store.getState().settings.audio).toBe(!before);
  });

  it('photo mode hides the interface and marks the document', () => {
    render(<App />);
    act(() => store.getState().setPhotoMode(true));
    expect(screen.queryByRole('navigation', { name: 'Location' })).toBeNull();
    expect(screen.getByRole('button', { name: /Take a photo/ })).toBeTruthy();
    expect(document.documentElement.dataset.sdPhoto).toBe('on');
    fireEvent.click(screen.getByRole('button', { name: /Exit photo mode/ }));
    expect(screen.getByRole('navigation', { name: 'Location' })).toBeTruthy();
    expect(document.documentElement.dataset.sdPhoto).toBeUndefined();
  });

  it('shows the boot screen until the engine is ready, then removes it', async () => {
    act(() => {
      store.setState({ ready: false, boot: { progress: 0.4, message: 'Lighting the stars…' } });
    });
    render(<App />);
    const status = screen.getByRole('status');
    expect(within(status).getByText('Lighting the stars…')).toBeTruthy();
    expect(within(status).getByText('40%')).toBeTruthy();
    expect(status.className).not.toContain('is-done');
    act(() => {
      store.setState({ ready: true });
    });
    expect(screen.getByRole('status').className).toContain('is-done');
  });

  it('marks the focused star as visited once the camera has arrived', () => {
    render(<App />);
    act(() => {
      store.setState({ focus: { kind: 'planet', id: halcyon.id }, flightProgress: 0.5 });
    });
    expect(store.getState().visited).toHaveLength(0); // still flying
    act(() => {
      store.setState({ flightProgress: null });
    });
    expect(store.getState().visited[0]?.id).toBe(homeId);
  });

  it('keeps working when the selected object no longer exists', () => {
    render(<App />);
    select('star', '0.999.999.999.0');
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByText('Uncharted')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /Fly home/ }));
    expect(store.getState().navRequest?.target).toEqual({ kind: 'star', id: homeId });
  });

  describe('on a phone', () => {
    beforeEach(() => layoutSize(390, 844));

    it('uses a bottom sheet: the first selection arrives as a peek with stars and a fly button', () => {
      render(<App />);
      expect(screen.queryByRole('complementary')).toBeNull(); // nothing selected, no sheet
      act(() => {
        store.setState({ selection: { kind: 'planet', id: halcyon.id } });
      });
      const sheet = screen.getByRole('complementary');
      expect(sheet.getAttribute('data-sheet')).toBe('peek');
      expect(document.querySelector('.sd-layout')?.getAttribute('data-sheet')).toBe('peek');
      expect(within(sheet).getAllByRole('radio')).toHaveLength(5); // one rating control, not two
      expect(within(sheet).getByRole('button', { name: /Fly here/ })).toBeTruthy();
      expect(within(sheet).queryByRole('heading', { name: 'Specifications' })).toBeNull();
    });

    it('expands to half and collapses again with the chevron, and with the arrow keys on the grip', () => {
      render(<App />);
      select('planet', halcyon.id);
      fireEvent.click(screen.getByRole('button', { name: 'Expand details' }));
      expect(screen.getByRole('complementary').getAttribute('data-sheet')).toBe('half');
      expect(
        within(screen.getByRole('complementary')).getByRole('heading', { name: 'Specifications' }),
      ).toBeTruthy();
      fireEvent.keyDown(screen.getByRole('button', { name: 'Resize details' }), { key: 'ArrowUp' });
      expect(screen.getByRole('complementary').getAttribute('data-sheet')).toBe('full');
      fireEvent.keyDown(screen.getByRole('button', { name: 'Resize details' }), {
        key: 'ArrowDown',
      });
      fireEvent.click(screen.getByRole('button', { name: 'Collapse details' }));
      expect(screen.getByRole('complementary').getAttribute('data-sheet')).toBe('peek');
    });

    it('keeps the top bar to four buttons; help moves into settings', () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      fireEvent.click(screen.getByRole('button', { name: /Controls & shortcuts/ }));
      expect(screen.getByRole('dialog', { name: /Controls/ })).toBeTruthy();
    });
  });
});

describe('App → engine view insets', () => {
  let calls: ViewInsets[];
  let unregister: () => void;
  const last = () => calls.at(-1);

  const restore: (() => void)[] = [];
  /** Override a layout getter wherever happy-dom defines it (walking up the prototype chain). */
  function stub(name: string, get: (el: HTMLElement) => number) {
    let proto: object | null = HTMLElement.prototype;
    while (proto && !Object.getOwnPropertyDescriptor(proto, name))
      proto = Object.getPrototypeOf(proto);
    const owner = proto ?? HTMLElement.prototype;
    const original = Object.getOwnPropertyDescriptor(owner, name);
    Object.defineProperty(owner, name, {
      configurable: true,
      get(this: HTMLElement) {
        return get(this);
      },
    });
    restore.push(() => {
      if (original) Object.defineProperty(owner, name, original);
      else Reflect.deleteProperty(owner, name);
    });
  }

  /** happy-dom has no layout: report the geometry a real browser would for each piece of chrome. */
  function geometry(g: {
    layout: [number, number];
    topbar: [top: number, height: number];
    panel: [left: number, top: number];
  }) {
    while (restore.length) restore.pop()?.();
    const is = (el: Element, cls: string) => el.classList.contains(cls);
    stub('clientWidth', (el) => (is(el, 'sd-layout') ? g.layout[0] : 0));
    stub('clientHeight', (el) => (is(el, 'sd-layout') ? g.layout[1] : 0));
    stub('offsetTop', (el) =>
      is(el, 'sd-topbar') ? g.topbar[0] : is(el, 'sd-info') ? g.panel[1] : 0,
    );
    stub('offsetHeight', (el) => (is(el, 'sd-topbar') ? g.topbar[1] : 0));
    stub('offsetLeft', (el) => (is(el, 'sd-info') ? g.panel[0] : 0));
  }

  beforeEach(() => {
    calls = [];
    unregister = registerEngineCommands({
      zoomBy() {},
      resetView() {},
      capture: async () => null,
      setViewInsets: (insets) => calls.push(insets),
    });
  });
  afterEach(() => {
    unregister();
    while (restore.length) restore.pop()?.();
  });

  it('desktop: reports the top bar and the info plate', () => {
    geometry({ layout: [1280, 800], topbar: [0, 58], panel: [884, 62] });
    render(<App />);
    select('planet', halcyon.id);
    expect(last()).toEqual({ top: 58, right: 396, bottom: 0, left: 0 });
  });

  it('desktop: a collapsed plate frees the right side again, and expanding takes it back', () => {
    geometry({ layout: [1280, 800], topbar: [0, 58], panel: [884, 62] });
    render(<App />);
    select('planet', halcyon.id);
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(last()).toEqual({ top: 58, right: 0, bottom: 0, left: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(last()?.right).toBe(396);
  });

  it('phone: reports the sheet as a bottom inset, and follows it as it changes', () => {
    layoutSize(390, 844);
    geometry({ layout: [390, 844], topbar: [0, 98], panel: [0, 668] });
    render(<App />);
    act(() => {
      store.setState({ selection: { kind: 'planet', id: halcyon.id } });
    });
    expect(last()).toEqual({ top: 98, right: 0, bottom: 176, left: 0 });
    geometry({ layout: [390, 844], topbar: [0, 98], panel: [0, 372] }); // half-open
    fireEvent.click(screen.getByRole('button', { name: 'Expand details' }));
    expect(last()?.bottom).toBe(472);
  });

  it('phone: no selection, no sheet, no bottom inset', () => {
    layoutSize(390, 844);
    geometry({ layout: [390, 844], topbar: [0, 98], panel: [0, 668] });
    render(<App />);
    expect(last()).toEqual({ top: 98, right: 0, bottom: 0, left: 0 });
  });

  it('photo mode gives the whole view back', () => {
    geometry({ layout: [1280, 800], topbar: [0, 58], panel: [884, 62] });
    render(<App />);
    expect(last()?.right).toBe(396);
    act(() => store.getState().setPhotoMode(true));
    expect(last()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('re-sends once the engine is ready (it registers its commands just before)', () => {
    geometry({ layout: [1280, 800], topbar: [0, 58], panel: [884, 62] });
    act(() => {
      store.setState({ ready: false });
    });
    render(<App />);
    const before = calls.length;
    act(() => {
      store.setState({ ready: true });
    });
    expect(calls.length).toBeGreaterThan(before);
    expect(last()).toEqual({ top: 58, right: 396, bottom: 0, left: 0 });
  });
});
