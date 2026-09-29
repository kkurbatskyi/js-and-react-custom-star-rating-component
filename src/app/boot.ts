/**
 * boot — TEMPORARY composition root (integration phase). The engine specialist replaces this with
 * the real engine (layer stack, camera rig, flights, input, picking, labels); `boot(canvas)` stays
 * the entry point called by src/main.tsx.
 *
 * What it does now: renders the GalaxyVisual stub through the shared HDR PostFX pipeline with a
 * slowly orbiting, camera-relative camera; runs the simulation clock; answers the store's
 * navRequest/timeRequest by jumping (no flights yet); writes throttled engine state (≤ 10 Hz);
 * exposes `window.__SIDEREAL__ = { store, universe }` and sets `window.__READY__` after the first
 * frames (scripts/shot.mjs waits for it).
 */
import { RenderPass } from 'postprocessing';
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { FocusTarget, ViewLevel } from '../core/types';
import { KM_PER_LY } from '../core/units';
import type { Quality, VisualFrame } from '../render/contracts';
import { GalaxyVisual } from '../render/galaxy/GalaxyVisual';
import { PostFX } from '../render/post/PostFX';
import { advanceSimDays } from '../sim/time';
import type { QualitySetting } from '../state/contracts';
import { store } from '../state/store';
import { getUniverse } from '../universe';
import type { Universe } from '../universe/contracts';

export interface BootHandle {
  dispose(): void;
}

interface DebugWindow {
  __SIDEREAL__?: { store: typeof store; universe: Universe };
  __READY__?: boolean;
}

/** Rendering-scale caps per quality (ARCHITECTURE §8). */
const DPR_CAP: Readonly<Record<Quality, number>> = { low: 0.75, medium: 1, high: 1.5, ultra: 2 };
/** Store writes are throttled to this interval. */
const STORE_INTERVAL_MS = 100;
/** Frames rendered before `__READY__` / `ready`. */
const READY_AFTER_FRAMES = 3;

function resolveQuality(q: QualitySetting): Quality {
  if (q !== 'auto') return q;
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse ? 'low' : 'medium';
}

function levelFor(target: FocusTarget): ViewLevel {
  return target.kind === 'galaxy' ? 'galaxy' : target.kind === 'star' ? 'system' : 'planet';
}

export function boot(canvas: HTMLCanvasElement): BootHandle {
  const debug = window as Window & DebugWindow;
  const initial = store.getState();
  const universe = getUniverse(initial.settings.galaxySeed);
  debug.__SIDEREAL__ = { store, universe };

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
  } catch {
    initial.setFromEngine({ boot: { progress: 0, message: 'This device cannot run WebGL 2.' } });
    return { dispose() {} };
  }

  const quality = resolveQuality(initial.settings.quality);
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 10, 1e6); // light-years; camera stays at the origin
  const scenePass = new RenderPass(scene, camera);
  const post = new PostFX(renderer, {
    quality,
    scenePass,
    bloom: { intensity: 0.9 * initial.settings.bloom, threshold: 1, radius: 0.75 },
  });
  const galaxy = new GalaxyVisual(universe.galaxy, quality);
  scene.add(galaxy.object);

  const frame: VisualFrame = {
    renderer,
    timeSec: 0,
    dtSec: 0,
    simDays: initial.simDays,
    camera,
    width: 1,
    height: 1,
    pixelRatio: 1,
    quality,
  };

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP[quality]);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    post.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frame.width = width;
    frame.height = height;
    frame.pixelRatio = pixelRatio;
  }
  resize();
  window.addEventListener('resize', resize);

  // A slow orbit around the galactic centre, 35° above the disk.
  const params = universe.galaxy.params;
  const orbitRadiusLy = params.radiusLy * 1.6;
  const elevation = 0.62;
  let azimuth = 0.9;
  const cameraLy = new Vector3();
  const galaxyOptions = { cameraLy, nearFadeLy: 2500, intensity: 1 };

  let simDays = initial.simDays;
  let frames = 0;
  let lastStoreWrite = Number.NEGATIVE_INFINITY;
  const start = performance.now();
  let last = start;
  let raf = 0;

  function tick(now: number): void {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const s = store.getState();

    // UI → engine requests. No flights yet: acknowledge by jumping.
    if (s.navRequest) {
      const { target, seq } = s.navRequest;
      s.consumeNavRequest(seq);
      s.setFromEngine({
        focus: target,
        level: levelFor(target),
        flightTarget: null,
        flightProgress: null,
      });
    }
    if (s.timeRequest) {
      simDays = s.timeRequest.simDays;
      s.consumeTimeRequest(s.timeRequest.seq);
    }
    if (!s.paused) simDays = advanceSimDays(simDays, dt, s.timeScale);

    const spin = s.settings.autoRotate ? (s.settings.reducedMotion ? 0.004 : 0.02) : 0; // rad/s
    azimuth += spin * dt;
    cameraLy.set(
      orbitRadiusLy * Math.cos(elevation) * Math.cos(azimuth),
      orbitRadiusLy * Math.sin(elevation),
      orbitRadiusLy * Math.cos(elevation) * Math.sin(azimuth),
    );
    // Camera-relative rendering: the camera stays at the origin and looks at the centre's offset.
    camera.position.set(0, 0, 0);
    camera.lookAt(-cameraLy.x, -cameraLy.y, -cameraLy.z);

    frame.timeSec = (now - start) / 1000;
    frame.dtSec = dt;
    frame.simDays = simDays;
    galaxy.update(frame, galaxyOptions);
    post.render(dt);
    frames++;

    if (now - lastStoreWrite >= STORE_INTERVAL_MS) {
      lastStoreWrite = now;
      s.setFromEngine({
        simDays,
        cameraLy: [cameraLy.x, cameraLy.y, cameraLy.z],
        cameraDistanceKm: orbitRadiusLy * KM_PER_LY,
      });
    }
    if (frames === READY_AFTER_FRAMES) {
      s.setFromEngine({ ready: true, boot: { progress: 1, message: 'Ready' } });
      debug.__READY__ = true;
    }
  }
  raf = requestAnimationFrame(tick);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      scene.remove(galaxy.object);
      galaxy.dispose();
      post.dispose();
      scenePass.dispose();
      renderer.dispose();
    },
  };
}
