/**
 * boot — the composition root. Builds the engine, the four layers (galaxy ▸ starfield ▸ system ▸
 * planet), input, labels, audio, FX, store sync, deep links and the debug handle; reports charming
 * progress into `store.boot`; pre-warms shader programs; shows the galaxy overview (or the deep-linked
 * object) and flags `store.ready` / `window.__READY__` once real frames are on screen.
 */
import { formatCount } from '../core/format';
import { log } from '../core/log';
import { Engine } from '../engine/Engine';
import type { LabelSpec } from '../engine/contracts';
import { InputController } from '../engine/input/InputController';
import { LabelOverlay } from '../engine/labels/LabelOverlay';
import { registerEngineCommands } from '../state/bridge';
import { store } from '../state/store';
import { getUniverse } from '../universe';
import { AudioBridge } from './AudioBridge';
import { installDebugHandle } from './debug';
import { parseDeepLink } from './deepLink';
import { FxBridge } from './fx';
import { createInputActions } from './interaction';
import type { LayerContext } from './layers/context';
import { FullVisualCache } from './layers/FullVisualCache';
import { GalaxyLayer } from './layers/GalaxyLayer';
import { PlanetLayer } from './layers/PlanetLayer';
import { StarfieldLayer } from './layers/StarfieldLayer';
import { SystemAssetCache } from './layers/SystemAssets';
import { SystemLayer } from './layers/SystemLayer';
import { StoreSync } from './StoreSync';
import { warmUpShaders } from './warmup';

export interface BootHandle {
  dispose(): void;
}

const bootLog = log.child('boot');
/** Rendered frames before `ready`: shaders compiled, first images on screen. */
const READY_AFTER_FRAMES = 3;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });

function progress(value: number, message: string): void {
  store.getState().setFromEngine({ boot: { progress: value, message } });
}

export function boot(canvas: HTMLCanvasElement): BootHandle {
  const disposers: (() => void)[] = [];
  let disposed = false;
  void start(canvas, disposers, () => disposed).catch((err: unknown) => {
    bootLog.error('boot failed', err);
    progress(0, 'Something went wrong while charting the galaxy. Try reloading.');
  });
  return {
    dispose() {
      disposed = true;
      for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
      disposers.length = 0;
    },
  };
}

async function start(
  canvas: HTMLCanvasElement,
  disposers: (() => void)[],
  isDisposed: () => boolean,
): Promise<void> {
  const initial = store.getState();
  let universe = getUniverse(initial.settings.galaxySeed);
  const stars = formatCount(universe.galaxy.params.estimatedStarCount);
  progress(0.05, `Seeding ${stars} stars…`);
  await nextFrame();

  let engine: Engine;
  try {
    engine = new Engine(canvas, {
      universe,
      quality: initial.settings.quality,
      simDays: initial.simDays,
      timeScale: initial.timeScale,
      bloom: initial.settings.bloom,
    });
  } catch (err) {
    bootLog.error('WebGL unavailable', err);
    progress(0, 'This device cannot run WebGL 2 — Sidereal needs it to draw the sky.');
    return;
  }
  disposers.push(() => engine.dispose());
  if (isDisposed()) return;

  progress(0.25, 'Igniting the galactic core…');
  await nextFrame();
  const quality = engine.quality;
  const assets = new SystemAssetCache(quality);
  const fullVisuals = new FullVisualCache(quality);
  disposers.push(() => {
    assets.clear();
    fullVisuals.clear();
  });
  let sync: StoreSync | null = null;
  let labelsOn = initial.settings.labels;
  const ctx: LayerContext = {
    engine,
    assets,
    fullVisuals,
    universe: () => universe,
    selectedId: () => store.getState().selection?.id ?? null,
    hoveredId: () => store.getState().hover?.id ?? null,
    orbitOpacity: () => sync?.orbitOpacity ?? 1,
    labelsEnabled: () => labelsOn,
  };
  const layers = [
    new GalaxyLayer(ctx, quality),
    new StarfieldLayer(ctx, quality),
    new SystemLayer(ctx, quality),
    new PlanetLayer(ctx, quality),
  ];
  engine.setLayers(layers);
  disposers.push(() => {
    for (const l of layers) l.dispose();
  });

  progress(0.55, 'Calibrating the star-rating instrument…');
  await nextFrame();
  await warmUpShaders(engine, ctx, universe);
  if (isDisposed()) return;

  progress(0.8, 'Plotting a course…');
  const audio = new AudioBridge();
  disposers.push(() => audio.dispose());
  sync = new StoreSync(engine, {
    onUniverseChange(next) {
      universe = next;
      assets.clear();
      fullVisuals.clear();
    },
    onFlightStart() {
      audio.sfx('travel-start');
    },
    onArrive() {
      audio.sfx('arrive');
    },
  });
  const storeSync = sync;
  engine.hooks.push(storeSync);
  disposers.push(() => storeSync.dispose());

  const fx = new FxBridge(engine.post);
  disposers.push(() => fx.dispose());

  const input = new InputController(canvas, createInputActions(engine, canvas, audio));
  disposers.push(() => input.dispose());

  const overlay = new LabelOverlay(document.body, {
    select(ref) {
      store.getState().select(ref);
      audio.sfx('select');
    },
    fly(ref) {
      store.getState().select(ref);
      store.getState().requestFocus(ref, 'fly');
    },
  });
  disposers.push(() => overlay.dispose());
  const labelBuffer: LabelSpec[] = [];

  engine.hooks.push({
    beforeUpdate(_e, dt) {
      input.update(dt || 1 / 60);
    },
    beforeRender(frame) {
      fx.update(frame);
    },
    afterRender(frame) {
      const s = store.getState();
      labelsOn = s.settings.labels;
      const showLabels = labelsOn && !s.ui.photoMode;
      overlay.setVisible(showLabels);
      if (showLabels) {
        const n = engine.collectLabels(labelBuffer);
        overlay.update(labelBuffer, n, frame.width, frame.height, frame.dtSec);
      }
      audio.setTravel(frame.travel);
      audio.setScene(frame.level, engine.rig.focus, s.settings.galaxySeed);
    },
  });

  disposers.push(
    registerEngineCommands({
      zoomBy(factor) {
        engine.rig.zoom(factor);
      },
      resetView() {
        engine.rig.resetView(store.getState().settings.reducedMotion, engine.clock.simDays);
      },
      capture() {
        return new Promise((resolve) => {
          try {
            engine.renderNow(); // same task as toBlob: the drawing buffer is still intact
            canvas.toBlob((blob) => resolve(blob), 'image/png');
          } catch {
            resolve(null);
          }
        });
      },
    }),
  );

  installDebugHandle(engine, storeSync);
  disposers.push(() => {
    delete window.__SIDEREAL__;
  });

  // Deep link: jump straight to the linked object (switching galaxies first if the token says so).
  const link = parseDeepLink(window.location.hash);
  if (link) {
    const s = store.getState();
    if (link.seed !== null && link.seed !== s.settings.galaxySeed) s.updateSettings({ galaxySeed: link.seed });
    store.getState().requestFocus(link.target, 'jump');
  }

  engine.start();
  for (let i = 0; i < READY_AFTER_FRAMES; i++) await nextFrame();
  if (isDisposed()) return;
  storeSync.write();
  store.getState().setFromEngine({ ready: true, boot: { progress: 1, message: 'Ready' } });
  window.__READY__ = true;
}
