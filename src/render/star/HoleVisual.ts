/**
 * Black hole (stellar and supermassive): one quad running the geodesic ray tracer of hole.glsl.ts,
 * and the LensState the engine forwards to the lensing post effect (lensing.ts).
 *
 * Geometry: `star.radiusKm` is the Schwarzschild radius r_s. Everything is expressed in r_s and the
 * quad covers the disk's outer edge plus margin; when the camera is so close that the disk would
 * fill the view (D < ~1.6 x the quad half-size) the quad becomes full-screen.
 */
import {
  GLSL3,
  Mesh,
  NormalBlending,
  type Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Uniform,
  Vector3,
} from 'three';
import type { StarDetails } from '../../core/types';
import type { Exotics } from './exotics';
import { holeFragment, holeVertex } from './hole.glsl';
import type { StarLook } from './starLook';
import type { LensState, StarFrameState } from './types';

/** ISCO of a Schwarzschild hole and the visible outer edge of the disk, in r_s. */
const R_INNER = 3;
const R_OUTER = 15;
/** Quad half-size in r_s: the outer edge with margin (the lensed far side rises above the shadow). */
const QUAD_HALF = R_OUTER * 1.3 + 3;
/** Integration steps per quality level (low, medium, high, ultra). */
const STEPS: readonly number[] = [56, 84, 112, 160];
/** Supermassive holes (> 1e6 km Schwarzschild radius) glow gold, stellar ones blue-white. */
const SMBH_KM = 1e6;

export class HoleVisual implements Exotics {
  readonly lens: LensState = {
    active: false,
    uvX: 0.5,
    uvY: 0.5,
    einsteinRadiusPx: 0,
    innerRadiusPx: 0,
    strength: 0,
    viewportHeightPx: 1,
  };
  readonly replacesSphere = true;

  private readonly star: StarDetails;
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly parent: Object3D;
  private readonly view = new Vector3();
  private readonly uniforms = {
    uQuadKm: new Uniform(1),
    uFullscreen: new Uniform(0),
    uD: new Uniform(100),
    uAxis: new Uniform(new Vector3(0, 1, 0)),
    uInner: new Uniform(R_INNER),
    uOuter: new Uniform(R_OUTER),
    uTmax: new Uniform(7000),
    uGain: new Uniform(2),
    uBeaming: new Uniform(0.85),
    uTime: new Uniform(0),
    uIntensity: new Uniform(1),
    uSteps: new Uniform(STEPS[2]),
    uShadowPx: new Uniform(10),
  };

  constructor(star: StarDetails, _look: StarLook, parent: Object3D) {
    this.star = star;
    this.parent = parent;
    const u = this.uniforms;
    const supermassive = star.radiusKm > SMBH_KM;
    u.uTmax.value = supermassive ? 7000 : 15000;
    // `accretion` (0..1) is the visual brightness of the flow; a hole with none is a bare shadow.
    const accretion = star.accretion ?? 0;
    u.uGain.value = accretion > 0.02 ? 0.6 + 2.2 * accretion : 0;
    this.mesh = new Mesh(
      this.geometry,
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: holeVertex,
        fragmentShader: holeFragment,
        uniforms: u,
        blending: NormalBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.name = 'black-hole';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
  }

  setQuality(level: number): void {
    this.uniforms.uSteps.value = STEPS[Math.min(STEPS.length - 1, Math.max(0, level))];
  }

  update(st: StarFrameState, timeSec: number): void {
    const rs = this.star.radiusKm;
    const D = st.distanceKm / rs;
    const frame = st.frame;
    const u = this.uniforms;
    const ppr = st.ppr;
    const dpr = frame.pixelRatio;
    const shadowPx = (2.598 * ppr) / D; // CSS px
    const fullscreen = D < QUAD_HALF * 1.6;

    u.uD.value = D;
    (u.uAxis.value as Vector3).copy(st.axisView);
    u.uTime.value = timeSec;
    u.uIntensity.value = st.intensity;
    u.uQuadKm.value = QUAD_HALF * rs;
    u.uFullscreen.value = fullscreen ? 1 : 0;
    u.uShadowPx.value = shadowPx * dpr;
    // Nothing to draw while the whole thing is under a fraction of a pixel; the sprite carries it.
    this.mesh.visible = shadowPx > 0.15;

    // Lensing state for the post effect.
    const lens = this.lens;
    const cam = frame.camera;
    const e = cam.projectionMatrix.elements;
    this.view.copy(st.positionKm).applyMatrix4(cam.matrixWorldInverse);
    const v = this.view;
    if (v.z < -1e-3) {
      lens.uvX = 0.5 + 0.5 * ((e[0] * v.x + e[8] * v.z) / -v.z);
      lens.uvY = 0.5 + 0.5 * ((e[5] * v.y + e[9] * v.z) / -v.z);
    }
    const einsteinPx = ppr * Math.sqrt(2 / D);
    lens.einsteinRadiusPx = Math.min(einsteinPx, frame.height * 0.9);
    lens.innerRadiusPx = (QUAD_HALF / D) * ppr * 1.02;
    lens.strength = st.intensity;
    lens.viewportHeightPx = frame.height;
    lens.active =
      !fullscreen &&
      v.z < -1e-3 &&
      lens.uvX > -0.5 &&
      lens.uvX < 1.5 &&
      lens.uvY > -0.5 &&
      lens.uvY < 1.5 &&
      st.intensity > 0.01;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
