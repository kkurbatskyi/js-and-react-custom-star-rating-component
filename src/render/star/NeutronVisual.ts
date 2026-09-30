/**
 * Neutron star (pulsar): two opposite beams from the magnetic poles sweep around the spin axis like
 * a lighthouse, and a faint blue wind nebula surrounds it (equatorial termination-shock ring, filaments,
 * polar jets). The real spin period (ms to seconds) is slowed for display to 1.6-6 s.
 * The tiny stellar sphere and the point-source glare come from StarVisual itself.
 */
import {
  AdditiveBlending,
  GLSL3,
  Mesh,
  type Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
} from 'three';
import { hash32, hashToUnit } from '../../core/hash';
import type { StarDetails } from '../../core/types';
import type { Exotics } from './exotics';
import { beamsFragment, nebulaFragment, nebulaVertex } from './neutron.glsl';
import { spriteVertex } from './star.glsl';
import type { StarLook } from './starLook';
import type { LensState, StarFrameState } from './types';

const TAU = Math.PI * 2;
/** Nebula half-size, km (a compact wind bubble: ~0.2 AU). */
const NEBULA_KM = 3e7;

export class NeutronVisual implements Exotics {
  readonly lens: LensState = {
    active: false,
    uvX: 0.5,
    uvY: 0.5,
    einsteinRadiusPx: 0,
    innerRadiusPx: 0,
    strength: 0,
    viewportHeightPx: 1,
  };
  readonly replacesSphere = false;

  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly beams: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly nebula: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly parent: Object3D;
  private readonly periodSec: number;
  private readonly alpha: number;
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();
  private readonly magnetic = new Vector3();
  private readonly beamU = {
    uViewport: new Uniform(new Vector2(1, 1)),
    uPixelRatio: new Uniform(1),
    uExtentPx: new Uniform(200),
    uColor: new Uniform(new Vector3(0.55, 0.78, 1.0)),
    uBeam: new Uniform(new Vector3(0, 1, 0)),
    uLenPx: new Uniform(200),
    uFade: new Uniform(1),
  };
  private readonly nebulaU = {
    uExtentKm: new Uniform(NEBULA_KM),
    uColor: new Uniform(new Vector3(0.28, 0.5, 1.0)),
    uEquator: new Uniform(new Vector2(1, 0)),
    uTilt: new Uniform(0.6),
    uSeed: new Uniform(0),
    uTime: new Uniform(0),
    uFade: new Uniform(1),
  };

  constructor(star: StarDetails, _look: StarLook, parent: Object3D) {
    this.parent = parent;
    const real = star.pulsarPeriodSec ?? 1;
    this.periodSec = Math.min(6, Math.max(1.6, 3 * real ** 0.25));
    // Inclination of the magnetic axis to the spin axis: 55-80 degrees.
    this.alpha = ((55 + 25 * hashToUnit(hash32(star.seed, 31))) * Math.PI) / 180;
    this.nebulaU.uSeed.value = 30 * hashToUnit(hash32(star.seed, 32));

    const additive = {
      glslVersion: GLSL3,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    } as const;
    this.beams = new Mesh(
      this.geometry,
      new ShaderMaterial({
        ...additive,
        vertexShader: spriteVertex,
        fragmentShader: beamsFragment,
        uniforms: this.beamU,
      }),
    );
    this.nebula = new Mesh(
      this.geometry,
      new ShaderMaterial({
        ...additive,
        vertexShader: nebulaVertex,
        fragmentShader: nebulaFragment,
        uniforms: this.nebulaU,
      }),
    );
    this.beams.name = 'pulsar-beams';
    this.nebula.name = 'wind-nebula';
    for (const m of [this.nebula, this.beams]) {
      m.frustumCulled = false;
      parent.add(m);
    }
    this.nebula.renderOrder = 0;
    this.beams.renderOrder = 4;
  }

  setQuality(): void {}

  update(st: StarFrameState, timeSec: number): void {
    const frame = st.frame;
    const cam = frame.camera;
    // Magnetic axis: spin axis tilted by alpha, swept around it once per display period.
    const s = st.axisWorld;
    if (Math.abs(s.y) < 0.9) this.e1.set(0, 1, 0);
    else this.e1.set(1, 0, 0);
    this.e1.cross(s).normalize();
    this.e2.crossVectors(s, this.e1);
    const phi = TAU * ((timeSec / this.periodSec) % 1);
    this.magnetic
      .copy(s)
      .multiplyScalar(Math.cos(this.alpha))
      .addScaledVector(this.e1, Math.sin(this.alpha) * Math.cos(phi))
      .addScaledVector(this.e2, Math.sin(this.alpha) * Math.sin(phi))
      .transformDirection(cam.matrixWorldInverse);

    const b = this.beamU;
    b.uViewport.value.set(frame.width * frame.pixelRatio, frame.height * frame.pixelRatio);
    b.uPixelRatio.value = frame.pixelRatio;
    const len = 0.42 * Math.min(frame.width, frame.height);
    b.uExtentPx.value = len;
    b.uLenPx.value = len;
    (b.uBeam.value as Vector3).copy(this.magnetic);
    b.uFade.value = st.intensity;
    this.beams.visible = st.intensity > 0.001;

    const n = this.nebulaU;
    n.uTime.value = timeSec;
    // Inside the bubble (closer than ~0.3 of its radius) it would be a flat veil: fade it out.
    const inside = Math.min(1, Math.max(0, (st.distanceKm / NEBULA_KM - 0.1) / 0.4));
    n.uFade.value = st.intensity * inside * inside * (3 - 2 * inside);
    const ax = st.axisView;
    const l = Math.hypot(ax.x, ax.y);
    if (l > 0.05) (n.uEquator.value as Vector2).set(-ax.y / l, ax.x / l);
    else (n.uEquator.value as Vector2).set(1, 0);
    n.uTilt.value = Math.abs(ax.z);
    // The nebula is only worth drawing while it is a few pixels wide.
    const nebulaPx = (NEBULA_KM / st.distanceKm) * st.ppr;
    this.nebula.visible = st.intensity > 0.001 && nebulaPx > 4;
  }

  dispose(): void {
    this.parent.remove(this.beams, this.nebula);
    this.geometry.dispose();
    this.beams.material.dispose();
    this.nebula.material.dispose();
  }
}
