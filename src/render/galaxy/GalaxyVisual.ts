/**
 * GalaxyVisual — the galaxy as the sky: a volumetric emission–absorption pass for the diffuse
 * light and dust, plus flux-calibrated particles for star clouds, blue clusters and pink HII
 * knots. See ./README.md for the technique.
 *
 *  - ./GalaxyMap.ts       planar map (arm factor, dust, star formation, filaments), baked on the GPU
 *  - ./GalaxyVolume.ts    reduced-resolution raymarch + temporal resolve + additive composite
 *  - ./GalaxyParticles.ts particles with line-of-sight dust extinction and a near fade
 *  - ./calibration.ts     brightness/dust normalisation, so every seed looks alike
 *
 * Camera-relative: the camera sits at the origin; `cameraLy` (galactic, float64 on the CPU) is
 * handed to the shaders, and the particle object is offset by −cameraLy.
 */
import { type Data3DTexture, Group } from 'three';
import type { GalaxyModel } from '../../core/types';
import {
  type GalaxyStructure,
  getGalaxyStructure,
  HOME_RADIUS_FRACTION,
} from '../../gen/galaxy/structure';
import type { GalaxyVisualOptions, IGalaxyVisual, Quality, VisualFrame } from '../contracts';
import { type GalaxyCalibration, calibrate, populationColorInto } from './calibration';
import { GalaxyMap } from './GalaxyMap';
import { GalaxyParticles } from './GalaxyParticles';
import { GalaxyVolume } from './GalaxyVolume';
import { createNoiseTexture } from './noiseVolume';
import { DEFAULT_PARTICLE_OPTIONS, type ParticleOptions } from './particles';
import {
  defaultGalaxyLook,
  GALAXY_QUALITY,
  type GalaxyLook,
  type GalaxyQualityProfile,
} from './settings';
import { createFieldUniforms, type GalaxyFieldUniforms, setFieldMap } from './uniforms';

/** Pink Hα of diffuse ionised gas (linear sRGB, unit luminance applied below). */
const HII_GLOW: readonly [number, number, number] = [1, 0.3, 0.46];
const NOISE_SIZE = 64;
/** Population colours blend from inner to outer over this radius, × the home radius. */
const COLOR_GRADIENT = 0.8;
/**
 * The volume's unresolved light fades in over this multiple of `nearFadeLy` (the starfield owns
 * the foreground; farther light also keeps the band thin and the high-latitude sky dark).
 */
const VOLUME_NEAR_FADE = 1.6;
/** 3D clumping/mottling (instead of the planar map's) fades over this distance (ly). */
const NEAR_DUST_RANGE_LY = 8000;

export class GalaxyVisual implements IGalaxyVisual {
  readonly object = new Group();
  /** Artistic controls, read every frame (a dev GUI may bind to it). */
  readonly look: GalaxyLook = defaultGalaxyLook();
  readonly structure: GalaxyStructure;

  private quality: Quality;
  private profile: GalaxyQualityProfile;
  private map: GalaxyMap;
  private readonly fields: GalaxyFieldUniforms;
  private readonly noise: Data3DTexture;
  private readonly volume: GalaxyVolume;
  private readonly particles: GalaxyParticles;
  private calibration: GalaxyCalibration | null = null;
  private calibratedFor = { brightness: Number.NaN, dustOpacity: Number.NaN, dustHeight: Number.NaN };
  private readonly rgb = [0, 0, 0];

  constructor(model: GalaxyModel, quality: Quality) {
    this.structure = getGalaxyStructure(model.params);
    this.quality = quality;
    this.profile = GALAXY_QUALITY[quality];
    this.fields = createFieldUniforms(this.structure);
    this.map = new GalaxyMap(this.structure, this.profile.mapSize);
    this.noise = createNoiseTexture(NOISE_SIZE, this.structure.shape.seed);
    this.volume = new GalaxyVolume(
      this.fields,
      this.noise,
      this.profile.volumeScale,
      this.profile.volumeSteps,
    );
    this.particles = new GalaxyParticles(
      this.structure,
      this.fields,
      this.profile.particles,
      this.particleOptions(),
    );
    this.volume.guided = this.profile.guidedUpsample;
    this.object.name = 'GalaxyVisual';
    this.object.add(this.volume.mesh, this.particles.object);
    this.configureVolume();
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    const next = GALAXY_QUALITY[q];
    if (next.particles !== this.profile.particles) {
      this.particles.rebuild(next.particles, this.particleOptions());
    }
    if (next.mapSize !== this.profile.mapSize) {
      this.map.dispose();
      this.map = new GalaxyMap(this.structure, next.mapSize);
      this.fields.uGalMap.value = null;
    }
    this.quality = q;
    this.profile = next;
    this.volume.scale = next.volumeScale;
    this.volume.steps = next.volumeSteps;
    this.volume.guided = next.guidedUpsample;
    this.volume.resetHistory();
  }

  /** Regenerate the particles (after changing colour temperatures or saturation in `look`). */
  rebuildParticles(): void {
    this.particles.rebuild(this.profile.particles, this.particleOptions());
  }

  /** Dev check of the GPU map bake against the CPU model (see GalaxyMap.validate). */
  validateMap(frame: VisualFrame): { arm: number; dust: number } | null {
    return this.map.ready ? this.map.validate(frame.renderer) : null;
  }

  /** Dev: the volume pass's HDR radiance and distance (kly) at screen uv (see GalaxyVolume). */
  probeVolume(frame: VisualFrame, u: number, v: number): [number, number, number, number] {
    return this.volume.probe(frame.renderer, u, v);
  }

  update(frame: VisualFrame, o: GalaxyVisualOptions): void {
    const visible = o.intensity > 0;
    this.object.visible = visible;
    if (!visible) return;
    if (!this.map.ready) {
      this.map.bake(frame.renderer);
      setFieldMap(this.fields, this.structure, this.map.target.texture, this.map.size);
    }
    const cal = this.syncLook();

    const p = this.particles.uniforms;
    p.uNearFade.value = o.nearFadeLy;
    p.uEmission.value = cal.emission * o.intensity;
    p.uLosSamples.value = this.profile.losSamples;
    this.particles.update(frame, o.cameraLy);
    this.volume.render(frame, o.cameraLy, o.intensity, VOLUME_NEAR_FADE * o.nearFadeLy);
  }

  dispose(): void {
    this.map.dispose();
    this.volume.dispose();
    this.particles.dispose();
    this.noise.dispose();
  }

  private particleOptions(): ParticleOptions {
    const l = this.look;
    return {
      ...DEFAULT_PARTICLE_OPTIONS,
      bulgeK: l.bulgeK,
      diskK: l.diskK,
      thickK: l.thickK,
      youngK: l.youngK,
      innerYoungK: l.innerYoungK,
      gradientLy: COLOR_GRADIENT * HOME_RADIUS_FRACTION * this.structure.gpu.radiusLy,
      saturation: l.saturation,
      kneeLight: this.calibrate().ridgeLight * l.coreKnee,
      kneeGamma: l.coreGamma,
    };
  }

  /** Calibration for the current look (recomputed only when its inputs change, ~1 ms). */
  private calibrate(): GalaxyCalibration {
    const l = this.look;
    const dustHeight = this.structure.gpu.dustHeightLy * l.dustThickness;
    const f = this.calibratedFor;
    if (
      !this.calibration ||
      f.brightness !== l.brightness ||
      f.dustOpacity !== l.dustOpacity ||
      f.dustHeight !== dustHeight
    ) {
      this.calibration = calibrate(this.structure, l.brightness, l.dustOpacity, dustHeight);
      this.calibratedFor = { brightness: l.brightness, dustOpacity: l.dustOpacity, dustHeight };
    }
    return this.calibration;
  }

  /** Bounds and step constants of the raymarch (fixed per galaxy). */
  private configureVolume(): void {
    const g = this.structure.gpu;
    const u = this.volume.uniforms;
    u.uBoundR.value = 1.25 * g.radiusLy;
    u.uBoundY.value = Math.max(
      3.2 * g.thickHeightLy,
      5 * g.bulgeALy * g.bulgeQ,
      4 * g.thinHeightLy,
    );
    u.uStepK.value.set(0.3, 0.12, 0.16, g.dustHeightLy); // w: rendered dust height (syncLook)
    u.uStepLimits.value.set(25, 6000, 1500);
  }

  /** Push `look` into the uniforms (recalibrating when its photometric inputs changed). */
  private syncLook(): GalaxyCalibration {
    const l = this.look;
    const cal = this.calibrate();
    const g = this.structure.gpu;
    const share = DEFAULT_PARTICLE_OPTIONS.share;
    const L = g.lightPerStar;
    const rgb = this.rgb;
    const u = this.volume.uniforms;
    const setColor = (
      target: { set(x: number, y: number, z: number): unknown },
      tempK: number,
      k: number,
    ): void => {
      populationColorInto(tempK, l.saturation, rgb);
      target.set((rgb[0] ?? 0) * k, (rgb[1] ?? 0) * k, (rgb[2] ?? 0) * k);
    };
    const kE = cal.emission;
    setColor(u.uColThin.value, l.diskK, kE * L.disk * (1 - share.disk));
    setColor(u.uColThinInner.value, l.bulgeK + 500, kE * L.disk * (1 - share.disk));
    setColor(u.uColThick.value, l.thickK, kE * L.disk * (1 - share.disk));
    setColor(u.uColArm.value, l.youngK, kE * L.arm * (1 - share.arm));
    setColor(u.uColArmInner.value, l.innerYoungK, kE * L.arm * (1 - share.arm));
    u.uArmDetail.value.set(l.armMottling, l.beading);
    setColor(u.uColSpheroid.value, l.bulgeK, kE * L.bulge * (1 - share.bulge));
    const hiiLum = 0.2126 * HII_GLOW[0] + 0.7152 * HII_GLOW[1] + 0.0722 * HII_GLOW[2];
    const hii = (kE * L.arm * g.armStrength * l.hiiGlow) / hiiLum;
    u.uColHii.value.set(HII_GLOW[0] * hii, HII_GLOW[1] * hii, HII_GLOW[2] * hii);
    u.uMottle.value = l.mottling;
    u.uLight.value.set(L.disk, L.arm, L.bulge, COLOR_GRADIENT * HOME_RADIUS_FRACTION * g.radiusLy);
    u.uKnee.value.set(cal.ridgeLight * l.coreKnee, l.coreGamma);
    const dustHeight = g.dustHeightLy * l.dustThickness;
    u.uStepK.value.w = dustHeight;
    this.fields.uGalInvHDust.value = 1 / dustHeight;
    u.uNear.value.x = l.nearDust;
    u.uNear.value.y = NEAR_DUST_RANGE_LY;

    this.fields.uGalDustDetail.value = l.dustDetail;
    this.fields.uGalExtinction.value
      .set(l.reddening[0], l.reddening[1], l.reddening[2])
      .multiplyScalar(cal.dustKappa);

    const p = this.particles.uniforms;
    p.uKindGain.value.set(l.particleGain, l.particleGain * l.clusterGain, l.particleGain * l.hiiGain);
    p.uMinSigmaPx.value = l.minSigmaPx;
    p.uMaxSigmaPx.value = l.maxSigmaPx;
    return cal;
  }
}
