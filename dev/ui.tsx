/**
 * UI dev page: mounts the real overlay (src/ui/App) over a cheap static backdrop — a 2D-canvas
 * starfield with a lit planet — using mock data, and no WebGL, so screenshots are fast.
 *
 *   ?sel=none|star|planet|moon|giant|core|neutron   what the info panel shows (also sets the focus)
 *   ?open=search,logbook,settings,help              open dialogs        ?q=hal   search text
 *   ?photo=1                                        photo mode          ?shot=1  show the captured preview
 *   ?mobile=1                                       390×844 device frame (container queries follow it)
 *   ?data=rich|empty                                seed ratings / bookmarks / visits (default rich)
 *   ?flight=0.4                                     pretend to be flying to the selection
 *   ?loading=0.4                                    show the boot screen at 40 %
 *   ?onboard=1                                      show the first-run notes
 *   ?hover=planet|star                              show the hover tooltip
 *   ?toast=1                                        push sample toasts
 *   ?dist=1.5e8                                     camera distance, km (scale ruler)
 *   ?sheet=peek|half|full                           phone sheet state
 *   ?insets=1                                       outline the free area reported by setViewInsets
 *   ?panel=0                                        hide this page's own controls
 */
import { createRoot } from 'react-dom/client';
import { createRng } from '../src/core/rng';
import type { FocusTarget, SelectionRef } from '../src/core/types';
import { registerEngineCommands } from '../src/state/bridge';
import { store } from '../src/state/store';
import { App } from '../src/ui/App';
import { useSheetStore } from '../src/ui/lib/sheetStore';
import { getUniverse } from '../src/universe';

declare global {
  interface Window {
    __READY__?: boolean;
    __UI__?: unknown;
  }
}

const params = new URLSearchParams(location.search);
const flag = (k: string) => params.get(k) !== null && params.get(k) !== '0';
const universe = getUniverse();
const homeId = universe.homeStarId();
const home = universe.getSystem(homeId);
if (!home) throw new Error('home system missing');
const halcyon = home.planets.find((p) => p.properName === 'Halcyon') ?? home.planets[0];
const giant = home.planets.find((p) => p.type === 'gas-giant') ?? home.planets[0];
if (!halcyon || !giant) throw new Error('mock system changed');
const lanthorn = halcyon.moons[0];

// ── backdrop ────────────────────────────────────────────────────────────────────────────────
function paintBackdrop(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  const rng = createRng(20260929).fork('backdrop');
  const bg = g.createRadialGradient(w * 0.45, h * 0.5, 0, w * 0.45, h * 0.5, Math.max(w, h) * 0.8);
  bg.addColorStop(0, '#0a1020');
  bg.addColorStop(1, '#010204');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // A faint Milky Way band.
  g.save();
  g.translate(w * 0.5, h * 0.52);
  g.rotate(-0.42);
  for (let i = 0; i < 5200; i++) {
    const x = rng.normal(0, w * 0.34);
    const y = rng.normal(0, h * 0.075);
    const a = 0.05 + rng.next() * 0.28;
    g.fillStyle = rng.chance(0.2) ? `rgb(255 214 170 / ${a})` : `rgb(190 208 255 / ${a})`;
    g.fillRect(x, y, 1, 1);
  }
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.4);
  glow.addColorStop(0, 'rgb(120 130 170 / 0.16)');
  glow.addColorStop(1, 'rgb(0 0 0 / 0)');
  g.scale(1, 0.24);
  g.fillStyle = glow;
  g.fillRect(-w, -w, w * 2, w * 2);
  g.restore();
  // Field stars.
  for (let i = 0; i < 1400; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    const r = rng.next() ** 6 * 1.6 + 0.35;
    const warm = rng.chance(0.35);
    g.fillStyle = `rgb(${warm ? '255 232 205' : '205 222 255'} / ${0.35 + rng.next() * 0.65})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // A lit world, lower-left of centre, so the glass has something bright to blur.
  const cx = w * 0.36;
  const cy = h * 0.72;
  const R = Math.min(w, h) * 0.34;
  const disc = g.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx, cy, R);
  disc.addColorStop(0, '#d9c7a4');
  disc.addColorStop(0.5, '#7b8f9a');
  disc.addColorStop(0.86, '#1c2733');
  disc.addColorStop(1, '#04060a');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  const rim = g.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.06);
  rim.addColorStop(0, 'rgb(120 170 255 / 0.0)');
  rim.addColorStop(0.5, 'rgb(120 170 255 / 0.35)');
  rim.addColorStop(1, 'rgb(120 170 255 / 0)');
  g.fillStyle = rim;
  g.beginPath();
  g.arc(cx, cy, R * 1.06, 0, Math.PI * 2);
  g.fill();
  // The sun.
  const sun = g.createRadialGradient(w * 0.12, h * 0.3, 0, w * 0.12, h * 0.3, 90);
  sun.addColorStop(0, 'rgb(255 250 240 / 1)');
  sun.addColorStop(0.08, 'rgb(255 236 200 / 0.9)');
  sun.addColorStop(1, 'rgb(255 200 140 / 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w * 0.4, h * 0.7);
}

const mobile = flag('mobile');
const host = document.createElement('div');
Object.assign(
  host.style,
  mobile
    ? {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: '390px',
        height: '844px',
        transform: 'translate(-50%, -50%)',
        overflow: 'hidden',
        border: '1px solid #2a2f3a',
        borderRadius: '28px',
        background: '#000',
      }
    : { position: 'fixed', inset: '0', overflow: 'hidden' },
);
document.body.appendChild(host);

const canvas = document.createElement('canvas');
Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
host.appendChild(canvas);
const bounds = () => host.getBoundingClientRect();
paintBackdrop(canvas, bounds().width, bounds().height);

const appRoot = document.createElement('div');
Object.assign(appRoot.style, {
  position: 'absolute',
  inset: '0',
  pointerEvents: 'none',
  zIndex: '1',
});
host.appendChild(appRoot);

// ── mock engine ─────────────────────────────────────────────────────────────────────────────
// `?insets=1` outlines the free rectangle the overlay reports to the engine (centre cross included).
let viewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const freeRect = document.createElement('div');
Object.assign(freeRect.style, {
  position: 'absolute',
  zIndex: '0',
  pointerEvents: 'none',
  border: '1px dashed rgb(141 182 242 / 0.7)',
  display: flag('insets') ? 'block' : 'none',
  background:
    'linear-gradient(rgb(141 182 242 / .5), rgb(141 182 242 / .5)) center / 1px 24px no-repeat, linear-gradient(rgb(141 182 242 / .5), rgb(141 182 242 / .5)) center / 24px 1px no-repeat',
});
host.appendChild(freeRect);

registerEngineCommands({
  setViewInsets: (insets) => {
    viewInsets = insets;
    Object.assign(freeRect.style, {
      left: `${insets.left}px`,
      top: `${insets.top}px`,
      right: `${insets.right}px`,
      bottom: `${insets.bottom}px`,
    });
  },
  zoomBy: (f) => store.getState().pushToast({ text: `zoomBy(${f})`, tone: 'info' }),
  resetView: () => store.getState().pushToast({ text: 'resetView()', tone: 'info' }),
  capture: () =>
    new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png')),
});

const SELECTIONS: Record<string, { ref: SelectionRef | null; focus: FocusTarget }> = {
  none: { ref: null, focus: { kind: 'galaxy', centerLy: [0, 0, 0] } },
  star: { ref: { kind: 'star', id: homeId }, focus: { kind: 'star', id: homeId } },
  planet: { ref: { kind: 'planet', id: halcyon.id }, focus: { kind: 'planet', id: halcyon.id } },
  giant: { ref: { kind: 'planet', id: giant.id }, focus: { kind: 'planet', id: giant.id } },
  moon: lanthorn
    ? { ref: { kind: 'moon', id: lanthorn.id }, focus: { kind: 'moon', id: lanthorn.id } }
    : { ref: null, focus: { kind: 'galaxy', centerLy: [0, 0, 0] } },
  core: {
    ref: { kind: 'star', id: universe.coreStarId() },
    focus: { kind: 'star', id: universe.coreStarId() },
  },
  neutron: (() => {
    const near = universe
      .queryStars(universe.galaxy.params.homeLy, 60, { limit: 400 })
      .find((s) => s.kind === 'neutron-star' || s.kind === 'white-dwarf');
    const id = near?.id ?? homeId;
    return {
      ref: { kind: 'star', id } as SelectionRef,
      focus: { kind: 'star', id } as FocusTarget,
    };
  })(),
};

const s = store.getState();
const sel = SELECTIONS[params.get('sel') ?? 'star'] ?? SELECTIONS.star;
if (!sel) throw new Error('no selection');

// Persisted user data, so the logbook and ratings have something to show.
if (params.get('data') !== 'empty') {
  const rated: [string, number][] = [
    [halcyon.id, 5],
    [homeId, 4],
    [giant.id, 4],
    [lanthorn?.id ?? `${halcyon.id}.1`, 3],
    [universe.coreStarId(), 5],
  ];
  const near = universe.queryStars(universe.galaxy.params.homeLy, 25, { limit: 12 });
  for (const n of near.slice(1, 5)) rated.push([n.id, 2 + (n.index % 3)]);
  store.setState({
    ratings: Object.fromEntries(rated),
    bookmarks: [halcyon.id, giant.id, universe.coreStarId()],
    visited: [
      { id: homeId, at: Date.now() - 12 * 60_000 },
      ...near.slice(1, 4).map((n, i) => ({ id: n.id, at: Date.now() - (i + 2) * 3_600_000 * 7 })),
      { id: universe.coreStarId(), at: Date.now() - 3 * 86_400_000 },
    ],
  });
}

const focusPoint =
  sel.focus.kind === 'galaxy'
    ? sel.focus.centerLy
    : (universe.getRecord(sel.ref?.id.split('.').slice(0, 5).join('.') ?? homeId)?.posLy ?? [
        0, 0, 0,
      ]);
const distance = params.get('dist')
  ? Number(params.get('dist'))
  : sel.focus.kind === 'galaxy'
    ? 1.4e18
    : sel.focus.kind === 'star'
      ? 2.4e9
      : sel.focus.kind === 'planet'
        ? 2.1e4
        : 4.6e3;
const loading = params.get('loading');
store.setState({
  ready: loading === null,
  boot: {
    progress: loading === null ? 1 : Number(loading),
    message: 'Compiling the shaders that draw the stars…',
  },
  level: sel.focus.kind === 'galaxy' ? 'galaxy' : sel.focus.kind === 'star' ? 'system' : 'planet',
  focus: sel.focus,
  selection: sel.ref,
  cameraDistanceKm: distance,
  cameraLy:
    sel.focus.kind === 'galaxy' ? [0, 62000, 4000] : [focusPoint[0], focusPoint[1], focusPoint[2]],
  simDays: Date.now() / 86_400_000 - 10957.5,
  flightProgress: params.get('flight') ? Number(params.get('flight')) : null,
  flightTarget: params.get('flight') ? sel.focus : null,
  hover:
    params.get('hover') === 'planet'
      ? { kind: 'planet', id: giant.id }
      : params.get('hover') === 'star'
        ? { kind: 'star', id: homeId }
        : null,
  ui: {
    ...s.ui,
    onboardingSeen: !flag('onboard'),
    photoMode: flag('photo'),
    panelCollapsed: params.get('sheet') === 'peek',
    open: {
      search: false,
      logbook: false,
      settings: false,
      help: false,
      ...Object.fromEntries(
        (params.get('open') ?? '')
          .split(',')
          .filter(Boolean)
          .map((k) => [k, true]),
      ),
    },
  },
});
useSheetStore.getState().setFull(params.get('sheet') === 'full');
if (flag('toast')) {
  store.getState().pushToast({
    text: 'Link copied',
    sub: 'Anyone who opens it lands at Halcyon.',
    tone: 'success',
  });
  store.getState().pushToast({
    text: 'Setting course for Kiranth',
    sub: 'A ringed giant · Aurelia',
    tone: 'info',
  });
  store.getState().pushToast({ text: 'Could not capture this view', tone: 'warning' });
}

// The engine ticks the clock; do the same, gently.
setInterval(() => {
  const st = store.getState();
  if (!st.paused) st.setFromEngine({ simDays: st.simDays + (st.timeScale * 0.1) / 86_400 });
}, 100);

createRoot(appRoot).render(<App />);

// The tooltip follows the pointer; give it one to follow.
if (params.get('hover')) {
  setTimeout(() => {
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: Number(params.get('px') ?? 470),
        clientY: Number(params.get('py') ?? 300),
        pointerType: 'mouse',
      }),
    );
  }, 350);
}

// ── dev controls ────────────────────────────────────────────────────────────────────────────
function control(label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  Object.assign(b.style, {
    font: '11px ui-monospace, monospace',
    padding: '3px 7px',
    background: '#141a26',
    color: '#cfd6e6',
    border: '1px solid #2b3446',
    borderRadius: '3px',
    cursor: 'pointer',
  });
  return b;
}
if (params.get('panel') !== '0') {
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed',
    left: '50%',
    bottom: '4px',
    transform: 'translateX(-50%)',
    zIndex: '1000',
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '96vw',
    padding: '4px',
    background: 'rgb(0 0 0 / .55)',
    borderRadius: '4px',
  });
  for (const k of Object.keys(SELECTIONS)) {
    bar.append(
      control(k, () => {
        const c = SELECTIONS[k];
        if (!c) return;
        store.setState({ selection: c.ref, focus: c.focus });
      }),
    );
  }
  for (const k of ['search', 'logbook', 'settings', 'help'] as const)
    bar.append(control(k, () => store.getState().togglePanel(k)));
  bar.append(control('photo', () => store.getState().setPhotoMode(true)));
  bar.append(
    control('toast', () =>
      store.getState().pushToast({ text: 'A toast', sub: 'With a sub-line', tone: 'info' }),
    ),
  );
  bar.append(
    control(mobile ? 'desktop' : 'mobile', () => {
      const u = new URL(location.href);
      if (mobile) u.searchParams.delete('mobile');
      else u.searchParams.set('mobile', '1');
      location.href = u.toString();
    }),
  );
  document.body.appendChild(bar);
}

// The engine owns Space (pause) and H (photo mode); stand in for it so this page behaves like the app.
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as Element | null;
  if (target?.closest('input, textarea, select, [role="combobox"]')) return;
  if (e.key === ' ' && target?.closest('button, a, summary, [role="radio"], [role="tab"]')) return;
  const st = store.getState();
  if (e.key === ' ') st.togglePause();
  else if (e.key === 'h' && !Object.values(st.ui.open).some(Boolean))
    st.setPhotoMode(!st.ui.photoMode);
});

// Handy for `shot.mjs --eval`: type into the palette, poke the store.
window.__UI__ = {
  store,
  get insets() {
    return viewInsets;
  },
  setQuery(q: string) {
    const el = document.querySelector<HTMLInputElement>('.sd-palette__field input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (el && setter) {
      setter.call(el, q);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },
};

void document.fonts.ready.then(() => {
  setTimeout(() => {
    window.__READY__ = true;
  }, 700);
});
