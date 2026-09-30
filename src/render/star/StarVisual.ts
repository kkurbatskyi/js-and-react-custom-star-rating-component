/**
 * StarVisual — a star from 1.3 stellar radii out to the edge of its system.
 *
 *   resolved sphere ──▶ glow ──▶ point source
 *
 * Three camera-facing quads share one group (all camera-relative, precision-safe at 1e10 km):
 *   1. photosphere — an analytic ray-cast sphere: exact silhouette and sub-pixel anti-aliasing at
 *      any size, true depth (planets pass in front/behind), Eddington limb darkening + reddening,
 *      animated Worley granulation, supergranulation, starspots and faculae, flares. See star.glsl.ts.
 *   2. corona — chromosphere rim, K-corona with streamers, animated prominence arches.
 *   3. sprite — the point source. It uses the SAME photometry and sprite profile as the starfield
 *      (starfield/photometry.ts), so the starfield → StarVisual hand-off changes neither brightness
 *      nor size nor shape; its weight fades out only once the disc itself is several pixels wide.
 * Neutron stars and black holes add their own showpiece meshes (see exotics.ts).
 *
 * HDR conventions follow ARCHITECTURE section 5: photospheres 6-40, coronas fall off from ~4.
 * Animation uses `frame.timeSec`; rotation phase is computed in float64 from `simDays`.
 */
import {
  AdditiveBlending,
  GLSL3,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { hash32, hashToUnit } from '../../core/hash';
import { smoothstep } from '../../core/math';
import type { StarDetails } from '../../core/types';
import type { IStarVisual, Quality, StarVisualOptions, VisualFrame } from '../contracts';
import { createPointSource, pointSource, visualLuminositySolar } from '../starfield/photometry';
import { createExotics, type Exotics } from './exotics';
import {
  coronaFragment,
  coronaVertex,
  discFragment,
  discVertex,
  spriteFragment,
  spriteVertex,
} from './star.glsl';
import { type StarLook, starLook } from './starLook';
import type { LensState, StarFrameState } from './types';

const QUALITY_LEVEL: Readonly<Record<Quality, number>> = { low: 0, medium: 1, high: 2, ultra: 3 };
/** The point-source sprite fades out as the disc grows from ~3 to ~24 CSS px in radius. */
const SPRITE_FADE_PX: readonly [number, number] = [3, 24];
/** Below this disc radius (CSS px) the photosphere mesh is skipped (the sprite carries the light). */
const MIN_DISC_PX = 0.08;
const CORONA_FADE_PX: readonly [number, number] = [4, 14];
const TAU = Math.PI * 2;
const Y_AXIS = new Vector3(0, 1, 0);

export class StarVisual implements IStarVisual {
  readonly object = new Group();
  /** Gravitational-lensing state for the engine (black holes only). See lensing.ts. */
  readonly lens: LensState;

  private readonly star: StarDetails;
  private readonly look: StarLook;
  private readonly plane = new PlaneGeometry(2, 2);
  private readonly disc: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly corona: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly sprite: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly exotics: Exotics | null;
  private qualityLevel: number;

  private readonly discU = {
    uQuadKm: new Uniform(1),
    uRadius: new Uniform(1),
    uPxKm: new Uniform(1),
    uDiscPx: new Uniform(1),
    uColor: new Uniform(new Vector3()),
    uTeff: new Uniform(5772),
    uBrightness: new Uniform(14),
    uIntensity: new Uniform(1),
    uTime: new Uniform(0),
    uBodyFromView: new Uniform(new Matrix3()),
    uSeed3: new Uniform(new Vector3()),
    uConvection: new Uniform(1),
    uGranScale: new Uniform(24),
    uActivity: new Uniform(0),
    uSpotAnywhere: new Uniform(0),
    uLimbSoft: new Uniform(0),
    uFlare: new Uniform(new Vector4(0, 0, 1, 0)),
    uQuality: new Uniform(2),
  };
  private readonly coronaU = {
    uExtent: new Uniform(6),
    uRadius: new Uniform(1),
    uColor: new Uniform(new Vector3()),
    uHotColor: new Uniform(new Vector3()),
    uBrightness: new Uniform(14),
    uIntensity: new Uniform(1),
    uTime: new Uniform(0),
    uSeed: new Uniform(0),
    uPxPerR: new Uniform(100),
    uEquator: new Uniform(new Vector2(1, 0)),
    uGain: new Uniform(0.2),
    uFall: new Uniform(3.2),
    uHaloGain: new Uniform(0.03),
    uStreamer: new Uniform(0.7),
    uChromo: new Uniform(0.8),
    uProm: new Uniform(0),
    uFlareBoost: new Uniform(0),
    uCoronaVis: new Uniform(1),
  };
  private readonly spriteU = {
    uViewport: new Uniform(new Vector2(1, 1)),
    uPixelRatio: new Uniform(1),
    uExtentPx: new Uniform(8),
    uColor: new Uniform(new Vector3()),
    uPeak: new Uniform(1),
    uSigma: new Uniform(1),
    uHaloR: new Uniform(3),
    uHaloGain: new Uniform(0.05),
    uSpikeLen: new Uniform(0),
    uSpikeGain: new Uniform(0),
    uExtent: new Uniform(8),
    uFade: new Uniform(1),
  };

  // Scratch (no per-frame allocation).
  private readonly ps = createPointSource();
  private readonly qAlign = new Quaternion();
  private readonly qSpin = new Quaternion();
  private readonly qBody = new Quaternion();
  private readonly mBody = new Matrix4();
  private readonly mView = new Matrix4();
  private readonly axisWorld = new Vector3();
  private readonly state: StarFrameState;
  private readonly luminosityV: number;
  private readonly flareOffset: number;
  private readonly flareDir = new Vector3();

  constructor(star: StarDetails, quality: Quality) {
    this.star = star;
    this.look = starLook(star);
    this.qualityLevel = QUALITY_LEVEL[quality];
    this.luminosityV = visualLuminositySolar(star.absMag);
    this.object.name = `StarVisual:${star.id}`;
    this.flareOffset = hashToUnit(hash32(star.seed, 77)) * 100;

    // Spin axis: mostly along +Y with a seed-dependent tilt.
    const tilt = 0.08 + 0.5 * hashToUnit(hash32(star.seed, 11));
    const az = TAU * hashToUnit(hash32(star.seed, 12));
    this.axisWorld.set(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    this.qAlign.setFromUnitVectors(Y_AXIS, this.axisWorld);
    this.state = {
      frame: null as unknown as VisualFrame,
      positionKm: this.object.position,
      distanceKm: 1,
      ppr: 1,
      discPx: 0,
      pxKm: 1,
      intensity: 1,
      axisView: new Vector3(0, 1, 0),
      viewToWorld: this.mView,
      axisWorld: this.axisWorld,
    };

    const l = this.look;
    const d = this.discU;
    d.uColor.value.set(l.color[0], l.color[1], l.color[2]);
    d.uTeff.value = l.tempK;
    d.uBrightness.value = l.brightness;
    d.uSeed3.value.set(
      60 * hashToUnit(hash32(star.seed, 1)),
      60 * hashToUnit(hash32(star.seed, 2)),
      60 * hashToUnit(hash32(star.seed, 3)),
    );
    d.uConvection.value = l.convection;
    d.uGranScale.value = l.granuleScale;
    d.uActivity.value = l.activity;
    d.uSpotAnywhere.value = l.spotAnywhere;
    d.uLimbSoft.value = l.limbSoft;
    d.uRadius.value = star.radiusKm;
    d.uQuality.value = this.qualityLevel;

    const c = this.coronaU;
    c.uExtent.value = l.coronaExtent;
    c.uRadius.value = star.radiusKm;
    c.uColor.value.set(l.color[0], l.color[1], l.color[2]);
    c.uHotColor.value.set(l.hotColor[0], l.hotColor[1], l.hotColor[2]);
    c.uBrightness.value = l.brightness;
    c.uSeed.value = 20 * hashToUnit(hash32(star.seed, 4));
    c.uGain.value = l.coronaGain;
    c.uFall.value = l.coronaFall;
    c.uHaloGain.value = l.haloGain;
    c.uStreamer.value = l.streamers;
    c.uChromo.value = l.chromosphere;
    c.uProm.value = l.prominences;

    this.spriteU.uColor.value.set(l.color[0], l.color[1], l.color[2]);

    this.disc = new Mesh(
      this.plane,
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: discVertex,
        fragmentShader: discFragment,
        uniforms: d,
        blending: NormalBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: true,
        toneMapped: false,
      }),
    );
    this.corona = new Mesh(
      this.plane,
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: coronaVertex,
        fragmentShader: coronaFragment,
        uniforms: c,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.sprite = new Mesh(
      this.plane,
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: spriteVertex,
        fragmentShader: spriteFragment,
        uniforms: this.spriteU,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    for (const [mesh, name, order] of [
      [this.disc, 'photosphere', 1],
      [this.corona, 'corona', 2],
      [this.sprite, 'sprite', 3],
    ] as const) {
      mesh.name = name;
      mesh.frustumCulled = false; // expanded in the vertex shader
      mesh.renderOrder = order;
      this.object.add(mesh);
    }

    this.exotics = createExotics(star, this.look, this.object);
    this.lens = this.exotics?.lens ?? {
      active: false,
      uvX: 0.5,
      uvY: 0.5,
      einsteinRadiusPx: 0,
      innerRadiusPx: 0,
      strength: 0,
    };
    if (this.exotics?.replacesSphere) {
      this.disc.visible = false;
      this.corona.visible = false;
    }
  }

  setQuality(q: Quality): void {
    this.qualityLevel = QUALITY_LEVEL[q];
    this.discU.uQuality.value = this.qualityLevel;
    this.exotics?.setQuality(this.qualityLevel);
  }

  update(frame: VisualFrame, o: StarVisualOptions): void {
    this.object.position.copy(o.positionKm);
    this.object.visible = o.intensity > 0.001;
    if (!this.object.visible) {
      this.lens.active = false;
      return;
    }
    const star = this.star;
    const look = this.look;
    const R = star.radiusKm;
    const cam = frame.camera;
    cam.updateMatrixWorld();
    const d = Math.max(o.positionKm.length(), R * 1.0005);
    const ppr = frame.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const dpr = frame.pixelRatio;
    const tanA = R / Math.sqrt(d * d - R * R);
    const discPx = ppr * tanA;
    const pxKm = d / (ppr * dpr);

    // World → body → view maths: spin phase in float64.
    const phase = ((frame.simDays / look.rotationDays) % 1) * TAU;
    this.qSpin.setFromAxisAngle(this.axisWorld, phase);
    this.qBody.multiplyQuaternions(this.qSpin, this.qAlign); // body → world
    this.mBody.makeRotationFromQuaternion(this.qBody).transpose(); // world → body
    this.mView.extractRotation(cam.matrixWorld); // view → world
    const st = this.state;
    st.frame = frame;
    st.distanceKm = d;
    st.ppr = ppr;
    st.discPx = discPx;
    st.pxKm = pxKm;
    st.intensity = o.intensity;
    st.axisView.copy(this.axisWorld).transformDirection(cam.matrixWorldInverse);
    const time = frame.timeSec;

    // ── point-source sprite (shared photometry)
    const ps = pointSource(this.luminosityV, d, ppr, 1, this.ps);
    const su = this.spriteU;
    su.uViewport.value.set(frame.width * dpr, frame.height * dpr);
    su.uPixelRatio.value = dpr;
    su.uExtentPx.value = ps.radiusPx;
    su.uExtent.value = ps.radiusPx;
    su.uPeak.value = ps.peakHdr;
    su.uSigma.value = ps.sigmaPx;
    su.uHaloR.value = ps.haloPx;
    su.uHaloGain.value = ps.haloGain;
    su.uSpikeLen.value = this.qualityLevel === 0 ? 0 : ps.spikePx;
    su.uSpikeGain.value = ps.spikeGain;
    const resolved = smoothstep(SPRITE_FADE_PX[0], SPRITE_FADE_PX[1], discPx);
    su.uFade.value = o.intensity * (1 - resolved);
    this.sprite.visible = su.uFade.value > 0.001;

    if (this.exotics) {
      this.exotics.update(st, time, phase);
    }

    if (this.exotics?.replacesSphere) return;

    // ── photosphere
    this.disc.visible = discPx > MIN_DISC_PX;
    if (this.disc.visible) {
      const u = this.discU;
      u.uQuadKm.value = (R * d) / Math.sqrt(d * d - R * R) + 2.5 * pxKm;
      u.uPxKm.value = pxKm;
      u.uDiscPx.value = discPx * dpr;
      u.uIntensity.value = o.intensity;
      u.uTime.value = time;
      (u.uBodyFromView.value as Matrix3).setFromMatrix4(this.mBody.multiply(this.mView));
      this.updateFlare(time, u.uFlare.value as Vector4);
    }

    // ── corona / prominences
    const vis = smoothstep(CORONA_FADE_PX[0], CORONA_FADE_PX[1], discPx);
    this.corona.visible = vis > 0.001;
    if (this.corona.visible) {
      const c = this.coronaU;
      c.uCoronaVis.value = vis;
      c.uIntensity.value = o.intensity;
      c.uTime.value = time;
      c.uPxPerR.value = discPx * dpr;
      c.uFlareBoost.value = (this.discU.uFlare.value as Vector4).w;
      // Equator direction on screen: perpendicular to the projected spin axis.
      const ax = st.axisView;
      const len = Math.hypot(ax.x, ax.y);
      if (len > 0.05) c.uEquator.value.set(-ax.y / len, ax.x / len);
      else c.uEquator.value.set(1, 0);
    }
  }

  dispose(): void {
    this.exotics?.dispose();
    this.plane.dispose();
    this.disc.material.dispose();
    this.corona.material.dispose();
    this.sprite.material.dispose();
  }

  /** Flare envelope (fast rise, slow decay) and a body-fixed kernel direction per cycle. */
  private updateFlare(time: number, out: Vector4): void {
    const period = this.look.flarePeriodSec;
    if (period <= 0) {
      out.w = 0;
      return;
    }
    const t = time + this.flareOffset;
    const cycle = Math.floor(t / period);
    const tau = t - cycle * period; // seconds since this cycle's flare began
    const env = (1 - Math.exp(-tau / 0.6)) * Math.exp(-tau / 5.5);
    out.w = Math.min(1, env * 2.2) * this.look.flareStrength;
    const h = hash32(this.star.seed, cycle, 991);
    const lat = (hashToUnit(h) - 0.5) * 1.6;
    const lon = TAU * hashToUnit(hash32(h, 5));
    this.flareDir.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    out.x = this.flareDir.x;
    out.y = this.flareDir.y;
    out.z = this.flareDir.z;
  }
}

