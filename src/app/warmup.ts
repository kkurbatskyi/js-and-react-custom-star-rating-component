/**
 * Shader pre-warming (docs/ARCHITECTURE.md §10): compile representative programs at boot with
 * `renderer.compileAsync` so the first arrival at a star or planet never hitches on compilation.
 * The warm-up uses the REAL assets of the home system (kept in the caches afterwards), so the
 * programs stay referenced and the most likely first destination is ready to draw.
 */
import { PerspectiveCamera, Scene } from 'three';
import { log } from '../core/log';
import type { Engine } from '../engine/Engine';
import type { Universe } from '../universe/contracts';
import type { LayerContext } from './layers/context';

const WARMUP_TIMEOUT_MS = 5000;

export async function warmUpShaders(
  engine: Engine,
  ctx: LayerContext,
  universe: Universe,
): Promise<void> {
  const system = universe.getSystem(universe.homeStarId());
  if (!system) return;
  const scene = new Scene();
  try {
    const assets = ctx.assets.get(system);
    const objects = [
      assets.star.object,
      assets.orbitLines.object,
      ...assets.belts.map((b) => b.object),
      ...assets.bodies.map((b) => b.lite.object),
    ];
    // One full visual of each kind that differs in shaders: a rocky/ocean world and a giant.
    const terran = system.planets.find((p) => p.type === 'terran' || p.type === 'ocean');
    const giant = system.planets.find((p) => p.type === 'gas-giant' || p.type === 'ice-giant');
    for (const body of [terran, giant]) {
      if (body) objects.push(ctx.fullVisuals.get(body, system).object);
    }
    for (const o of objects) scene.add(o);
    const camera = new PerspectiveCamera(50, 1, 1, 1e13);
    const renderer = engine.renderer;
    if (renderer.extensions.has('KHR_parallel_shader_compile')) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        renderer.compileAsync(scene, camera),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, WARMUP_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
    } else {
      renderer.compile(scene, camera); // no parallel compile: synchronous, still off the first flight
    }
    for (const o of objects) o.removeFromParent();
  } catch (err) {
    log.child('boot').warn('shader warm-up skipped', err);
    scene.clear();
  }
}
