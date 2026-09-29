/**
 * StarfieldVisual — STUB (integration phase). The starfield specialist replaces the internals;
 * the public API (`IStarfieldVisual`) stays.
 *
 * Catalogue stars as additive point sprites. Per star the vertex shader derives the apparent
 * magnitude from its absolute magnitude and camera distance, m = M + 5·log₁₀(d / 10 pc), and maps
 * the flux F = 10^(−0.4 m) to sprite size (∝ F^0.35) and peak radiance (∝ F^0.75, HDR, so bright
 * stars bloom). Stars fainter than ~m 6.8 are culled.
 *
 * Precision: positions are float32 offsets from a rebase origin chosen near the camera
 * (`setStars`); the object is placed at (origin − cameraLy), computed in float64.
 * Picking and labels run on the CPU in float64 with the last update's camera, cached per frame.
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
import { saturateRGB } from '../../core/color';
import type { StarRecord } from '../../core/types';
import { LY_PER_PC } from '../../core/units';
import type {
  IStarfieldVisual,
  LabelCandidate,
  Quality,
  ScreenHit,
  StarfieldOptions,
  VisualFrame,
} from '../contracts';

/** Faintest apparent magnitude drawn (flux cut-off 10^(−0.4·m)). */
const LIMITING_MAG = 6.8;
const MIN_FLUX = 10 ** (-0.4 * LIMITING_MAG);

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
  private capacity = 0;
  private stars: readonly StarRecord[] = [];
  private readonly origin = new Vector3();
  private readonly uniforms = {
    uExposure: new Uniform(1),
    uPixelRatio: new Uniform(1),
    uHidden: new Uniform(-1),
    uHiddenFade: new Uniform(0),
    uSelected: new Uniform(-1),
    uHovered: new Uniform(-1),
  };

  // Last-update camera state for CPU picking/labels.
  private readonly cameraLy = new Vector3();
  private readonly viewProjection = new Matrix4();
  private width = 1;
  private height = 1;
  private exposure = 1;
  private hiddenIndex = -1;
  private hiddenFade = 0;
  private frameId = 0;
  private projectedFrame = -1;
  // Per-star projection cache (CSS px, apparent magnitude, visibility), reused across frames.
  private projX = new Float32Array(0);
  private projY = new Float32Array(0);
  private projMag = new Float32Array(0);
  private projVisible = new Uint8Array(0);
  private readonly indexById = new Map<string, number>();

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

  setStars(stars: readonly StarRecord[], originLy: Vector3): void {
    if (stars.length > this.capacity) this.allocate(2 ** Math.ceil(Math.log2(stars.length)));
    const geometry = this.object.geometry;
    const pos = geometry.getAttribute('position') as BufferAttribute;
    const col = geometry.getAttribute('aColor') as BufferAttribute;
    const mag = geometry.getAttribute('aAbsMag') as BufferAttribute;
    const p = pos.array as Float32Array;
    const c = col.array as Float32Array;
    const m = mag.array as Float32Array;
    this.origin.copy(originLy);
    this.indexById.clear();
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      p[i * 3] = s.posLy[0] - originLy.x;
      p[i * 3 + 1] = s.posLy[1] - originLy.y;
      p[i * 3 + 2] = s.posLy[2] - originLy.z;
      const rgb = saturateRGB(s.colorRGB, 1.25); // ARCHITECTURE §9 star-colour boost
      c[i * 3] = rgb[0];
      c[i * 3 + 1] = rgb[1];
      c[i * 3 + 2] = rgb[2];
      m[i] = s.absMag;
      this.indexById.set(s.id, i);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    mag.needsUpdate = true;
    geometry.setDrawRange(0, stars.length);
    this.stars = stars;
    this.projectedFrame = -1;
  }

  update(frame: VisualFrame, o: StarfieldOptions): void {
    this.object.position.set(this.origin.x - o.cameraLy.x, this.origin.y - o.cameraLy.y, this.origin.z - o.cameraLy.z);
    const u = this.uniforms;
    u.uExposure.value = o.exposure;
    u.uPixelRatio.value = frame.pixelRatio;
    this.hiddenIndex = o.hiddenStarId === null ? -1 : (this.indexById.get(o.hiddenStarId) ?? -1);
    this.hiddenFade = o.hiddenFade;
    u.uHidden.value = this.hiddenIndex;
    u.uHiddenFade.value = o.hiddenFade;
    u.uSelected.value = o.selectedId === null ? -1 : (this.indexById.get(o.selectedId) ?? -1);
    u.uHovered.value = o.hoveredId === null ? -1 : (this.indexById.get(o.hoveredId) ?? -1);

    // Snapshot for pick()/labels(): the camera sits at the origin of layer space.
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
    for (let i = 0; i < this.stars.length; i++) {
      if (!this.projVisible[i]) continue;
      const d = Math.hypot(this.projX[i] - x, this.projY[i] - y);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    return best < 0 ? null : { id: this.stars[best].id, distPx: bestD };
  }

  labels(max: number): LabelCandidate[] {
    if (max <= 0) return [];
    this.project();
    const mag = this.projMag;
    // Keep the `max` brightest (insertion into a short sorted list: O(n·max) worst case, ~O(n)).
    const top: number[] = [];
    for (let i = 0; i < this.stars.length; i++) {
      if (!this.projVisible[i]) continue;
      if (top.length === max && mag[i] >= mag[top[max - 1]]) continue;
      let at = top.length;
      while (at > 0 && mag[top[at - 1]] > mag[i]) at--;
      top.splice(at, 0, i);
      if (top.length > max) top.pop();
    }
    return top.map((i) => {
      const s = this.stars[i];
      return { id: s.id, text: s.name, sub: s.spectralType, x: this.projX[i], y: this.projY[i], priority: -mag[i] };
    });
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
    this.projX = new Float32Array(capacity);
    this.projY = new Float32Array(capacity);
    this.projMag = new Float32Array(capacity);
    this.projVisible = new Uint8Array(capacity);
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
    for (let i = 0; i < this.stars.length; i++) {
      this.projVisible[i] = 0;
      if (i === this.hiddenIndex && this.hiddenFade > 0.5) continue;
      const s = this.stars[i];
      const x = s.posLy[0] - this.cameraLy.x;
      const y = s.posLy[1] - this.cameraLy.y;
      const z = s.posLy[2] - this.cameraLy.z;
      const d = Math.max(Math.hypot(x, y, z), 1e-6);
      const mag = s.absMag + 5 * Math.log10(d / (10 * LY_PER_PC));
      if (mag > magLimit) continue;
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue; // behind the camera
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
      this.projX[i] = (nx * 0.5 + 0.5) * this.width;
      this.projY[i] = (0.5 - ny * 0.5) * this.height;
      this.projMag[i] = mag;
      this.projVisible[i] = 1;
    }
  }
}
