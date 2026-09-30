/**
 * The engine's scene pass for PostFX: renders the frame's layer slices far → near into the HDR input
 * buffer, clearing depth between slices (docs/ARCHITECTURE.md §5). Each slice gets its own tight
 * near/far, so a moon 1 km below the camera and its ringed giant 10⁶ km away both keep full depth
 * precision without a logarithmic depth buffer.
 *
 * The plan is rebuilt every frame by the engine (`begin` / `push`) into pooled entries — no
 * per-frame allocation. Contract with PostFX: clear colour and depth ourselves, draw into
 * `inputBuffer` (or the screen when `renderToScreen`), `needsSwap = false`.
 */
import { Pass } from 'postprocessing';
import type { PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';

interface SliceEntry {
  scene: Scene | null;
  camera: PerspectiveCamera | null;
  near: number;
  far: number;
}

export class LayerStackPass extends Pass {
  private readonly entries: SliceEntry[] = [];
  private count = 0;

  constructor() {
    super('LayerStackPass');
    this.needsSwap = false;
  }

  /** Number of slices in the current plan. */
  get size(): number {
    return this.count;
  }

  begin(): void {
    for (let i = 0; i < this.count; i++) {
      this.entries[i].scene = null; // drop references so disposed layers can be collected
      this.entries[i].camera = null;
    }
    this.count = 0;
  }

  push(scene: Scene, camera: PerspectiveCamera, near: number, far: number): void {
    let e = this.entries[this.count];
    if (!e) {
      e = { scene: null, camera: null, near: 0, far: 0 };
      this.entries.push(e);
    }
    e.scene = scene;
    e.camera = camera;
    e.near = near;
    e.far = far;
    this.count++;
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget | null): void {
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    for (let i = 0; i < this.count; i++) {
      const { scene, camera, near, far } = this.entries[i];
      if (!scene || !camera) continue;
      if (camera.near !== near || camera.far !== far) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      if (i > 0) renderer.clearDepth();
      renderer.render(scene, camera);
    }
  }
}
