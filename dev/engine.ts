/**
 * Engine flight lab — the real composition root (src/app/boot.ts) without the React UI, plus a
 * lil-gui panel to fly/jump between curated targets and scrub a frozen flight.
 *
 * Scripted screenshots (applied before `__READY__`):
 *   ?from=<id>&to=<id>&t=0.5     jump to `from`, fly towards `to`, freeze at progress t
 *   ?to=<id>                     cut straight to `to`
 *   ?ui=0                        hide the GUI and HUD
 * Ids are deep-link tokens (star / planet / moon ids) or `galaxy`.
 */
import GUI from 'lil-gui';
import { boot } from '../src/app/boot';
import type { SiderealHandle } from '../src/app/debug';
import { formatDistanceKm } from '../src/core/format';

const HOME = '1.399.0.-276.0';
const TARGETS: Record<string, string> = {
  'Galactic centre': 'galaxy',
  'Aurelia (home star)': HOME,
  'Halcyon (terran)': `${HOME}.d`,
  'Lanthorn (moon)': `${HOME}.d.1`,
  'Aurelia f (ringed giant)': `${HOME}.f`,
  'Aurelia f I (lava moon)': `${HOME}.f.1`,
  'Aurelia g (ice giant)': `${HOME}.g`,
  'Zenanor (F2V, 67 ly)': '1.399.-1.-277.1',
  'Ulria (A0V)': '3.99.-1.-70.0',
  'Core black hole': '8.0.0.0.0',
};

const params = new URLSearchParams(window.location.search);
const canvas = document.createElement('canvas');
Object.assign(canvas.style, {
  position: 'fixed',
  inset: '0',
  width: '100%',
  height: '100%',
  display: 'block',
  touchAction: 'none',
});
document.body.prepend(canvas);

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

boot(canvas, {
  async beforeReady() {
    const h = window.__SIDEREAL__;
    if (!h) return;
    const from = params.get('from');
    const to = params.get('to');
    const t = params.get('t');
    if (from) h.debug.jumpTo(from);
    if (to && from) h.debug.flyTo(to, t !== null ? { at: Number(t) } : undefined);
    else if (to) h.debug.jumpTo(to);
    if (from || to) await h.debug.frames(3);
    if (params.get('ui') !== '0') setUpGui(h);
    else document.getElementById('hud')?.remove();
    await nextFrame();
  },
});

function setUpGui(h: SiderealHandle): void {
  const { debug, engine, store } = h;
  const gui = new GUI({ title: 'Flight lab' });
  const state = {
    target: `${HOME}.d`,
    fly: () => store.getState().requestFocus(focusOf(state.target), 'fly'),
    jump: () => debug.jumpTo(state.target),
    up: () => store.getState().goUp(),
    frozen: engine.clock.frozen,
    progress: 0,
    labels: true,
    orbits: true,
    reducedMotion: store.getState().settings.reducedMotion,
  };
  gui.add(state, 'target', TARGETS).name('Target');
  gui.add(state, 'fly').name('Fly (van Wijk–Nuij)');
  gui.add(state, 'jump').name('Jump (cut)');
  gui.add(state, 'up').name('Up a level (Esc)');
  const scrub = gui.addFolder('Frozen flight');
  scrub
    .add(state, 'frozen')
    .name('Freeze clocks')
    .onChange((v: boolean) => debug.freeze(v));
  scrub
    .add(state, 'progress', 0, 1, 0.001)
    .name('Progress')
    .onChange((t: number) => {
      debug.freeze(true);
      state.frozen = true;
      engine.rig.setFlightProgress(t);
    })
    .listen();
  const view = gui.addFolder('View');
  view
    .add(state, 'labels')
    .onChange((v: boolean) => store.getState().updateSettings({ labels: v }));
  view
    .add(state, 'orbits')
    .onChange((v: boolean) => store.getState().updateSettings({ orbits: v }));
  view
    .add(state, 'reducedMotion')
    .name('Reduced motion')
    .onChange((v: boolean) => store.getState().updateSettings({ reducedMotion: v }));

  const hud = document.getElementById('hud');
  let last = 0;
  engine.hooks.push({
    afterRender(frame) {
      const now = performance.now();
      if (!hud || now - last < 200) return;
      last = now;
      const s = debug.state();
      const id = (f: { kind: string; id?: string }) =>
        f.kind === 'galaxy' ? 'galaxy point' : `${f.kind} ${f.id}`;
      hud.textContent = [
        `level ${s.level}   system ${s.systemId ?? '—'}`,
        `focus  ${id(s.focus)}`,
        `anchor ${id(s.anchor)}   offset ${formatDistanceKm(s.distanceKm)}`,
        `flight ${s.flight === null ? '—' : s.flight.toFixed(3)}   travel ${frame.travel.toFixed(2)}`,
        `${engine.stats.fps.toFixed(0)} fps   js ${engine.stats.jsMs.toFixed(1)} ms   scale ${engine.stats.renderScale.toFixed(2)}   dpr ${engine.stats.pixelRatio.toFixed(2)}   ${engine.stats.quality}`,
      ].join('\n');
      if (s.flight !== null && !state.frozen) state.progress = s.flight;
    },
  });
}

function focusOf(token: string) {
  if (token === 'galaxy') return { kind: 'galaxy', centerLy: [0, 0, 0] } as const;
  const parts = token.split('.');
  if (parts.length === 5) return { kind: 'star', id: token } as const;
  if (parts.length === 6) return { kind: 'planet', id: token } as const;
  return { kind: 'moon', id: token } as const;
}
