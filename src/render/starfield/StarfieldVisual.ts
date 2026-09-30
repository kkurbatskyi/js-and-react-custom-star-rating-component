/**
 * StarfieldVisual — catalogue stars as anti-aliased, physically-scaled sprites.
 *
 * Every star is one instance of a camera-facing quad (`InstancedBufferGeometry`, no point-size
 * limits). The vertex shader derives the apparent magnitude from the absolute one and the camera
 * distance, m = M + 5 log10(d / 10 pc), turns it into a flux and maps that through the SHARED
 * photometry (photometry.ts — the same code StarVisual's point-source mode runs), which yields the
 * sprite's peak radiance, core sigma, halo and diffraction spikes. The fragment shader evaluates the
 * profile analytically at the exact sub-pixel star position: a faint star never shrinks below a
 * ~0.8 px Gaussian, it dims instead, so stars neither shimmer nor pop as the camera moves.
 *
 * Precision: `setBlocks` merges the blocks into ONE GPU buffer of float32 offsets from `originLy`
 * (computed in float64 from each block's own origin) and reuses buffer capacity; the object is
 * placed at (origin - cameraLy), also in float64. Picking and anchors run on the CPU with the last
 * update's camera, project every star once per frame lazily into reusable typed arrays, and never
 * allocate per star.
 *
 * Ids: star `i` of block `b` is `${b.key}.${i}`. Hidden star: its sprite fades with `hiddenFade`
 * (peak scaling, like StarVisual's fade-in, so the two sum to a constant). Selected / hovered stars
 * get an animated reticle ring.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Uniform,
  Vector2,
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
import { MIN_FLUX, resolutionScale, SPRITE, spriteGlsl } from './photometry';

/** Chroma boost for the pale blackbody colours (ARCHITECTURE section 9). */
const SATURATION = 1.25;
const PC10_LY = 10 * LY_PER_PC;
const INITIAL_CAPACITY = 1024;

const vertexShader = /* glsl */ `
${spriteGlsl}
uniform float uExposure;
uniform float uPixelRatio;
uniform float uResScale;
uniform float uHiddenFade;
uniform float uSpikes;
uniform vec2 uViewport;      // device px
uniform int uHidden;
uniform int uSelected;
uniform int uHovered;

in vec3 iPos;
in vec3 iColor;
in float iAbsMag;

out vec2 vP;                 // offset from the star centre, CSS px
flat out vec3 vColor;        // colour x peak radiance x fade
flat out vec4 vA;            // sigma, halo radius, halo gain, spike length
flat out vec3 vB;            // spike gain, extent, mark (0 none, 1 hovered, 2 selected)

const float PC10_LY = ${PC10_LY.toFixed(6)};
const float MIN_FLUX = ${MIN_FLUX.toExponential(6)};

void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec4 clip = projectionMatrix * mv;
  float d = max(length(mv.xyz), 1e-7);
  // Apparent magnitude, then flux relative to magnitude 0: 10^(-0.4 m) = 2^(-1.3287712 m).
  float m = iAbsMag + 5.0 * log2(d / PC10_LY) * 0.30102999566;
  float flux = uExposure * exp2(-1.3287712 * m);
  float mark = (gl_InstanceID == uSelected) ? 2.0 : ((gl_InstanceID == uHovered) ? 1.0 : 0.0);
  float fade = (gl_InstanceID == uHidden) ? 1.0 - uHiddenFade : 1.0;
  if ((flux < MIN_FLUX && mark == 0.0) || fade < 0.002 || clip.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // culled: too faint / hidden / behind the camera
    vColor = vec3(0.0);
    vA = vec4(1.0);
    vB = vec3(0.0);
    vP = vec2(0.0);
    return;
  }
  float peak, sigma, haloR, haloGain, spikeLen, spikeGain, extent;
  starSpriteParams(flux, uResScale, peak, sigma, haloR, haloGain, spikeLen, spikeGain, extent);
  if (uSpikes < 0.5) { spikeLen = 0.0; spikeGain = 0.0; }
  if (mark > 0.5) {
    extent = max(extent, 30.0);
    if (mark < 1.5) peak = max(peak * 1.5, 0.05);
  }
  vec2 corner = position.xy;
  vec2 offPx = corner * extent;
  vP = offPx;
  vColor = iColor * (peak * fade);
  vA = vec4(sigma, haloR, haloGain, spikeLen);
  vB = vec3(spikeGain, extent, mark);
  gl_Position = clip;
  gl_Position.xy += offPx * uPixelRatio * 2.0 / uViewport * clip.w;
}
`;

const fragmentShader = /* glsl */ `
${spriteGlsl}
uniform float uTime;
in vec2 vP;
flat in vec3 vColor;
flat in vec4 vA;
flat in vec3 vB;
out vec4 fragColor;

void main() {
  float v = starPsf(vP, vA.x, vA.y, vA.z, vA.w, vB.x, vB.y);
  vec3 c = vColor * v;
  if (vB.z > 0.5) {
    float r = length(vP);
    if (vB.z > 1.5) {
      // Selected: a slowly turning four-gap reticle that breathes, plus an outgoing ripple.
      float ang = atan(vP.y, vP.x);
      float r0 = 11.0 + 1.1 * sin(uTime * 2.6);
      float ring = exp(-0.5 * pow((r - r0) / 0.85, 2.0));
      float gaps = smoothstep(0.10, 0.24, abs(sin(2.0 * (ang + uTime * 0.35))));
      float ph = fract(uTime * 0.55);
      float ripple = exp(-0.5 * pow((r - (12.0 + 15.0 * ph)) / 1.2, 2.0)) * (1.0 - ph) * (1.0 - ph);
      c += vec3(0.95, 0.66, 0.24) * (0.75 * ring * gaps + 0.28 * ripple);
    } else {
      float ring = exp(-0.5 * pow((r - 9.0) / 0.8, 2.0));
      c += vec3(0.72, 0.84, 1.0) * (0.5 * ring);
    }
  }
  fragColor = vec4(c, 1.0);
}
`;

export class StarfieldVisual implements IStarfieldVisual {
  readonly object: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly uniforms = {
    uExposure: new Uniform(1),
    uPixelRatio: new Uniform(1),
    uResScale: new Uniform(1),
    uHiddenFade: new Uniform(0),
    uSpikes: new Uniform(1),
    uTime: new Uniform(0),
    uViewport: new Uniform(new Vector2(1, 1)),
    uHidden: new Uniform(-1),
    uSelected: new Uniform(-1),
    uHovered: new Uniform(-1),
  };

  // Star table: index k = instance index.
  private capacity = 0;
  private count = 0;
  private blocks: readonly StarBlock[] = [];
  private readonly blockStartByKey = new Map<string, number>();
  private blockFirst = new Int32Array(0);
  private starBlock = new Int32Array(0);
  private absMag = new Float32Array(0);
  private offsets: Float32Array = new Float32Array(0); // count x 3, relative to `origin` (shared with the GPU buffer)
  private readonly origin = new Vector3();

  // Last-update camera state for CPU picking / anchors.
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
  private readonly shift = new Vector3();

  constructor(quality: Quality) {
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
    this.object = new Mesh(new InstancedBufferGeometry(), material);
    this.object.name = 'StarfieldVisual';
    this.object.frustumCulled = false; // stars surround the camera
    this.allocate(INITIAL_CAPACITY);
    this.setQuality(quality);
  }

  setQuality(q: Quality): void {
    this.uniforms.uSpikes.value = q === 'low' ? 0 : 1;
  }

  setBlocks(blocks: readonly StarBlock[], originLy: Vector3): void {
    let total = 0;
    for (const b of blocks) total += b.count;
    if (total > this.capacity) this.allocate(2 ** Math.ceil(Math.log2(Math.max(total, 1))));
    const geometry = this.object.geometry;
    const posAttr = geometry.getAttribute('iPos') as InstancedBufferAttribute;
    const colAttr = geometry.getAttribute('iColor') as InstancedBufferAttribute;
    const magAttr = geometry.getAttribute('iAbsMag') as InstancedBufferAttribute;
    const p = posAttr.array as Float32Array;
    const c = colAttr.array as Float32Array;
    const m = magAttr.array as Float32Array;
    this.origin.copy(originLy);
    this.blockStartByKey.clear();
    if (this.blockFirst.length < blocks.length) this.blockFirst = new Int32Array(blocks.length * 2);
    let k = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      this.blockStartByKey.set(b.key, k);
      this.blockFirst[bi] = k;
      // Block origin relative to the rebase origin in float64; star offsets are small.
      const bx = b.originLy[0] - originLy.x;
      const by = b.originLy[1] - originLy.y;
      const bz = b.originLy[2] - originLy.z;
      const off = b.offsetsLy;
      const col = b.colorRGB;
      for (let i = 0; i < b.count; i++, k++) {
        p[k * 3] = bx + off[i * 3];
        p[k * 3 + 1] = by + off[i * 3 + 1];
        p[k * 3 + 2] = bz + off[i * 3 + 2];
        writeSaturated(col, i * 3, c, k * 3);
        m[k] = b.absMag[i];
        this.starBlock[k] = bi;
      }
    }
    this.absMag.set(m.subarray(0, total));
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    magAttr.needsUpdate = true;
    geometry.instanceCount = total;
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
    const camera = frame.camera;
    camera.updateMatrixWorld();
    const ppr = frame.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const u = this.uniforms;
    u.uExposure.value = o.exposure;
    u.uPixelRatio.value = frame.pixelRatio;
    u.uResScale.value = resolutionScale(ppr);
    u.uTime.value = frame.timeSec;
    u.uViewport.value.set(frame.width * frame.pixelRatio, frame.height * frame.pixelRatio);
    this.hiddenIndex = this.indexOf(o.hiddenStarId);
    this.hiddenFade = o.hiddenFade;
    u.uHidden.value = this.hiddenIndex;
    u.uHiddenFade.value = o.hiddenFade;
    u.uSelected.value = this.indexOf(o.selectedId);
    u.uHovered.value = this.indexOf(o.hoveredId);

    // Snapshot for pick()/anchors(): the camera sits at the origin of layer space.
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
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDist = 0;
    const px = this.projX;
    const py = this.projY;
    const vis = this.projVisible;
    const mag = this.projMag;
    for (let k = 0; k < this.count; k++) {
      if (vis[k] === 0) continue;
      const dx = px[k] - x;
      const dy = py[k] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxDistPx * maxDistPx) continue;
      const d = Math.sqrt(d2);
      // Brighter stars are easier to hit: up to 4 px of forgiveness for the brightest.
      const score = d - Math.min(4, Math.max(0, (6.5 - mag[k]) * 0.6));
      if (score < bestScore) {
        bestScore = score;
        bestDist = d;
        best = k;
      }
    }
    return best < 0 ? null : { id: this.idOf(best), distPx: bestDist };
  }

  anchors(max: number): ScreenAnchor[] {
    if (max <= 0) return [];
    this.project();
    const mag = this.projMag;
    const vis = this.projVisible;
    // Keep the `max` brightest: insertion into a short sorted list, O(n) for small max.
    const top: number[] = [];
    for (let k = 0; k < this.count; k++) {
      if (vis[k] === 0) continue;
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
    const geometry = new InstancedBufferGeometry();
    // The unit quad every instance expands (corners in [-1, 1]).
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3),
    );
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.setAttribute('iPos', new InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute(
      'iColor',
      new InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    );
    geometry.setAttribute('iAbsMag', new InstancedBufferAttribute(new Float32Array(capacity), 1));
    geometry.instanceCount = 0;
    this.object.geometry = geometry;
    old.dispose();
    this.capacity = capacity;
    this.offsets = (geometry.getAttribute('iPos') as InstancedBufferAttribute).array as Float32Array;
    this.starBlock = new Int32Array(capacity);
    this.absMag = new Float32Array(capacity);
    this.projX = new Float32Array(capacity);
    this.projY = new Float32Array(capacity);
    this.projMag = new Float32Array(capacity);
    this.projVisible = new Uint8Array(capacity);
  }

  private idOf(k: number): StarId {
    const bi = this.starBlock[k];
    return `${this.blocks[bi].key}.${k - this.blockFirst[bi]}`;
  }

  /** Instance index of a StarId shown by this visual, or -1. */
  private indexOf(id: StarId | null): number {
    if (id === null) return -1;
    const dot = id.lastIndexOf('.');
    if (dot < 0) return -1;
    const start = this.blockStartByKey.get(id.slice(0, dot));
    if (start === undefined) return -1;
    const i = Number(id.slice(dot + 1));
    const block = this.blocks[this.starBlock[start]];
    return Number.isInteger(i) && i >= 0 && i < block.count ? start + i : -1;
  }

  /**
   * Screen position (CSS px) and apparent magnitude of every visible star, computed once per update
   * into reusable buffers — mirrors the shader's culling rule (flux >= MIN_FLUX).
   */
  private project(): void {
    if (this.projectedFrame === this.frameId) return;
    this.projectedFrame = this.frameId;
    const e = this.viewProjection.elements;
    const magLimit = SPRITE.limitingMag + 2.5 * Math.log10(Math.max(this.exposure, 1e-9));
    // Star = origin + offset; camera-relative = offset + (origin - camera), the shift in float64.
    const sx = this.origin.x - this.cameraLy.x;
    const sy = this.origin.y - this.cameraLy.y;
    const sz = this.origin.z - this.cameraLy.z;
    void this.shift;
    const off = this.offsets;
    const absMag = this.absMag;
    const halfW = this.width * 0.5;
    const halfH = this.height * 0.5;
    for (let k = 0; k < this.count; k++) {
      this.projVisible[k] = 0;
      if (k === this.hiddenIndex && this.hiddenFade > 0.5) continue;
      const x = off[k * 3] + sx;
      const y = off[k * 3 + 1] + sy;
      const z = off[k * 3 + 2] + sz;
      const d = Math.max(Math.sqrt(x * x + y * y + z * z), 1e-7);
      const mag = absMag[k] + 5 * Math.log10(d / PC10_LY);
      if (mag > magLimit) continue;
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue; // behind the camera
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      if (nx < -1.05 || nx > 1.05 || ny < -1.05 || ny > 1.05) continue;
      this.projX[k] = (nx + 1) * halfW;
      this.projY[k] = (1 - ny) * halfH;
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
