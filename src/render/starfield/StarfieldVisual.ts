/**
 * StarfieldVisual — STUB (integration phase). The starfield specialist replaces the internals;
 * the public API (`IStarfieldVisual`) stays.
 *
 * Catalogue blocks as additive point sprites. Per star the vertex shader derives the apparent
 * magnitude from its absolute magnitude and camera distance, m = M + 5·log₁₀(d / 10 pc), and maps
 * the flux F = 10^(−0.4 m) to sprite size (∝ F^0.35) and peak radiance (∝ F^0.75, HDR, so bright
 * stars bloom). Stars fainter than ~m 6.8 are culled.
 *
 * Precision: `setBlocks` rebases every star to `originLy` (chosen near the camera) in float64 and
 * stores float32 offsets; the object is placed at (origin − cameraLy), also computed in float64.
 * Picking and anchors run on the CPU in float64 with the last update's camera, cached per frame in
 * reusable typed arrays (no per-star objects, no per-frame allocation beyond the returned list).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  Matrix4,
  Points,
  ShaderMaterial,
  Uniform,
  Vector3,
} from 'three';
import type { StarBlock, StarId } from '../../core/types';
import { LY_PER_PC } from '../../core/units';
import type {
  IStarfieldVisual,
  Quality,
  ScreenAnchor,
  ScreenHit,
  StarfieldOptions,
  VisualFrame,
} from '../contracts';

/** Faintest apparent magnitude drawn (flux cut-off 10^(−0.4·m)). */
const LIMITING_MAG = 6.8;
const MIN_FLUX = 10 ** (-0.4 * LIMITING_MAG);
/** Chroma boost for the pale blackbody colours (ARCHITECTURE §9). */
const SATURATION = 1.25;

const vertexShader = /* glsl */ `
uniform float uExposure;
uniform float uPixelRatio;
uniform int uHidden;
uniform float uHiddenFade;
uniform int uSelected;
uniform int uHovered;

in vec3 aColor;
in float aAbsMag;

out vec3 vColor;

const float LY_PER_PC = ${LY_PER_PC.toFixed(6)};
const float MIN_FLUX = ${MIN_FLUX.toExponential(6)};

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dLy = max(length(mv.xyz), 1e-6);
  // Apparent magnitude and flux relative to m = 0: F = 10^(-0.4 m) = 2^(-1.3288 m).
  float m = aAbsMag + 5.0 * log2(dLy / (10.0 * LY_PER_PC)) * 0.30103;
  float flux = uExposure * exp2(-1.3287712 * m);
  if (gl_VertexID == uHidden) flux *= 1.0 - uHiddenFade;
  bool marked = gl_VertexID == uSelected || gl_VertexID == uHovered;
  if (flux < MIN_FLUX && !marked) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull: too faint
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
  float sizePx = clamp(2.4 + 3.6 * pow(flux, 0.35), 2.4, 30.0);
  float peak = min(2.5 * pow(flux, 0.75), 30.0);
  if (marked) {
    sizePx += 3.0;
    peak = max(peak * 1.6, 0.6);
  }
  vColor = aColor * peak;
  gl_PointSize = sizePx * uPixelRatio;
}
`;

const fragmentShader = /* glsl */ `
in vec3 vColor;
out vec4 fragColor;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  // Tight core plus a faint wide skirt — a stand-in for a real PSF.
  float psf = exp(-r2 * 9.0) + 0.18 * exp(-r2 * 2.5);
  fragColor = vec4(vColor * psf, 1.0);
}
`;

export class StarfieldVisual implements IStarfieldVisual {
  readonly object: Points<BufferGeometry, ShaderMaterial>;
  private readonly uniforms = {
    uExposure: new Uniform(1),
    uPixelRatio: new Uniform(1),
    uHidden: new Uniform(-1),
    uHiddenFade: new Uniform(0),
    uSelected: new Uniform(-1),
    uHovered: new Uniform(-1),
  };

  // Star table (index = vertex index).
  private capacity = 0;
  private count = 0;
  private blocks: readonly StarBlock[] = [];
  private readonly blockStart = new Map<string, number>();
  private starBlock = new Int32Array(0);
  private absPos = new Float64Array(0);
  private absMag = new Float32Array(0);
  private readonly origin = new Vector3();

  // Last-update camera state for CPU picking/anchors.
  private readonly cameraLy = new Vector3();
  private readonly viewProjection = new Matrix4();
  private width = 1;
  private height = 1;
  private exposure = 1;
  private hiddenIndex = -1;
  private hiddenFade = 0;
  private frameId = 0;
  private projectedFrame = -1;
  private projX = new Float32Array(0);
  private projY = new Float32Array(0);
  private projMag = new Float32Array(0);
  private projVisible = new Uint8Array(0);

  constructor(_quality: Quality) {
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.object = new Points(new BufferGeometry(), material);
    this.object.name = 'StarfieldVisual';
    this.object.frustumCulled = false; // stars surround the camera
    this.allocate(1024);
  }

  setBlocks(blocks: readonly StarBlock[], originLy: Vector3): void {
    let total = 0;
    for (const b of blocks) total += b.count;
    if (total > this.capacity) this.allocate(2 ** Math.ceil(Math.log2(total)));
    const geometry = this.object.geometry;
    const pos = geometry.getAttribute('position') as BufferAttribute;
    const col = geometry.getAttribute('aColor') as BufferAttribute;
    const mag = geometry.getAttribute('aAbsMag') as BufferAttribute;
    const p = pos.array as Float32Array;
    const c = col.array as Float32Array;
    const m = mag.array as Float32Array;
    this.origin.copy(originLy);
    this.blockStart.clear();
    let k = 0;
    blocks.forEach((b, bi) => {
      this.blockStart.set(b.key, k);
      // Block origin relative to the rebase origin, in float64; star offsets are small.
      const bx = b.originLy[0] - originLy.x;
      const by = b.originLy[1] - originLy.y;
      const bz = b.originLy[2] - originLy.z;
      for (let i = 0; i < b.count; i++, k++) {
        const ox = b.offsetsLy[i * 3];
        const oy = b.offsetsLy[i * 3 + 1];
        const oz = b.offsetsLy[i * 3 + 2];
        p[k * 3] = bx + ox;
        p[k * 3 + 1] = by + oy;
        p[k * 3 + 2] = bz + oz;
        this.absPos[k * 3] = b.originLy[0] + ox;
        this.absPos[k * 3 + 1] = b.originLy[1] + oy;
        this.absPos[k * 3 + 2] = b.originLy[2] + oz;
        writeSaturated(b.colorRGB, i * 3, c, k * 3);
        m[k] = b.absMag[i];
        this.absMag[k] = b.absMag[i];
        this.starBlock[k] = bi;
      }
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    mag.needsUpdate = true;
    geometry.setDrawRange(0, total);
    this.blocks = blocks;
    this.count = total;
    this.projectedFrame = -1;
  }

  update(frame: VisualFrame, o: StarfieldOptions): void {
    this.object.position.set(
      this.origin.x - o.cameraLy.x,
      this.origin.y - o.cameraLy.y,
      this.origin.z - o.cameraLy.z,
    );
    const u = this.uniforms;
    u.uExposure.value = o.exposure;
    u.uPixelRatio.value = frame.pixelRatio;
    this.hiddenIndex = this.indexOf(o.hiddenStarId);
    this.hiddenFade = o.hiddenFade;
    u.uHidden.value = this.hiddenIndex;
    u.uHiddenFade.value = o.hiddenFade;
    u.uSelected.value = this.indexOf(o.selectedId);
    u.uHovered.value = this.indexOf(o.hoveredId);

    // Snapshot for pick()/anchors(): the camera sits at the origin of layer space.
    const camera = frame.camera;
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.cameraLy.copy(o.cameraLy);
    this.width = frame.width;
    this.height = frame.height;
    this.exposure = o.exposure;
    this.frameId++;
  }

  pick(x: number, y: number, maxDistPx: number): ScreenHit | null {
    this.project();
    let best = -1;
    let bestD = maxDistPx;
    for (let k = 0; k < this.count; k++) {
      if (!this.projVisible[k]) continue;
      const d = Math.hypot(this.projX[k] - x, this.projY[k] - y);
      if (d <= bestD) {
        best = k;
        bestD = d;
      }
    }
    return best < 0 ? null : { id: this.idOf(best), distPx: bestD };
  }

  anchors(max: number): ScreenAnchor[] {
    if (max <= 0) return [];
    this.project();
    const mag = this.projMag;
    // Keep the `max` brightest (insertion into a short sorted list: O(n·max) worst case, ~O(n)).
    const top: number[] = [];
    for (let k = 0; k < this.count; k++) {
      if (!this.projVisible[k]) continue;
      if (top.length === max && mag[k] >= mag[top[max - 1]]) continue;
      let at = top.length;
      while (at > 0 && mag[top[at - 1]] > mag[k]) at--;
      top.splice(at, 0, k);
      if (top.length > max) top.pop();
    }
    return top.map((k) => ({
      id: this.idOf(k),
      x: this.projX[k],
      y: this.projY[k],
      priority: -mag[k],
    }));
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  // ───────────────────────────────────────────── internals

  private allocate(capacity: number): void {
    const old = this.object.geometry;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('aAbsMag', new BufferAttribute(new Float32Array(capacity), 1));
    geometry.setDrawRange(0, 0);
    this.object.geometry = geometry;
    old.dispose();
    this.capacity = capacity;
    this.starBlock = new Int32Array(capacity);
    this.absPos = new Float64Array(capacity * 3);
    this.absMag = new Float32Array(capacity);
    this.projX = new Float32Array(capacity);
    this.projY = new Float32Array(capacity);
    this.projMag = new Float32Array(capacity);
    this.projVisible = new Uint8Array(capacity);
  }

  private idOf(k: number): StarId {
    const block = this.blocks[this.starBlock[k]];
    return `${block.key}.${k - (this.blockStart.get(block.key) ?? 0)}`;
  }

  /** Vertex index of a StarId shown by this visual, or −1. */
  private indexOf(id: StarId | null): number {
    if (id === null) return -1;
    const dot = id.lastIndexOf('.');
    const start = this.blockStart.get(id.slice(0, dot));
    if (start === undefined) return -1;
    const i = Number(id.slice(dot + 1));
    const block = this.blocks[this.starBlock[start]];
    return Number.isInteger(i) && i >= 0 && i < block.count ? start + i : -1;
  }

  /**
   * Screen position (CSS px) and apparent magnitude of every *visible* star, computed once per
   * update in float64 into reusable buffers — mirrors the shader's visibility rule.
   */
  private project(): void {
    if (this.projectedFrame === this.frameId) return;
    this.projectedFrame = this.frameId;
    const e = this.viewProjection.elements;
    const magLimit = LIMITING_MAG + 2.5 * Math.log10(Math.max(this.exposure, 1e-9));
    for (let k = 0; k < this.count; k++) {
      this.projVisible[k] = 0;
      if (k === this.hiddenIndex && this.hiddenFade > 0.5) continue;
      const x = this.absPos[k * 3] - this.cameraLy.x;
      const y = this.absPos[k * 3 + 1] - this.cameraLy.y;
      const z = this.absPos[k * 3 + 2] - this.cameraLy.z;
      const d = Math.max(Math.hypot(x, y, z), 1e-6);
      const mag = this.absMag[k] + 5 * Math.log10(d / (10 * LY_PER_PC));
      if (mag > magLimit) continue;
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue; // behind the camera
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
      this.projX[k] = (nx * 0.5 + 0.5) * this.width;
      this.projY[k] = (0.5 - ny * 0.5) * this.height;
      this.projMag[k] = mag;
      this.projVisible[k] = 1;
    }
  }
}

/** Saturation boost about the Rec. 709 luminance axis, keeping the brightest channel unchanged. */
function writeSaturated(src: Float32Array, si: number, dst: Float32Array, di: number): void {
  const r = src[si];
  const g = src[si + 1];
  const b = src[si + 2];
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const r2 = Math.max(0, y + (r - y) * SATURATION);
  const g2 = Math.max(0, y + (g - y) * SATURATION);
  const b2 = Math.max(0, y + (b - y) * SATURATION);
  const k = Math.max(r, g, b) / Math.max(r2, g2, b2, 1e-9);
  dst[di] = r2 * k;
  dst[di + 1] = g2 * k;
  dst[di + 2] = b2 * k;
}
