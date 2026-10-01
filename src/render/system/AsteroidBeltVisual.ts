/**
 * AsteroidBeltVisual — a belt of thousands of rocks on Keplerian orbits, plus a soft dust glow.
 *
 * Two point clouds share one orbital model (beltModel.ts): crisp constant-size rock sprites, and
 * large soft dust sprites that make the belt read as a dusty band from afar. Both rotate
 * differentially — ω ∝ a^−1.5, computed in the vertex shader — with per-rock eccentricity and
 * vertical oscillation (the belt's thickness), varied size / albedo / tint by composition, a soft
 * twinkle with the odd glint, and phase-lit shading from the star. Rocks that get close enough to
 * be a few pixels wide turn into shaded spheres. Dense views are "crowd"-dimmed so the band stays a
 * soft dusty ring rather than a white line; see asteroidBelt.glsl.ts.
 *
 * Time: the shader only ever sees Δt = simDays − epoch (beltModel.ts: float32-safe rebasing).
 * `centralMassSolar` sets the rotation speed (Kepler's third law); it defaults to 1 M☉ because the
 * engine's constructor call passes only (belt, quality) — pass `system.star.massSolar` for exact
 * periods.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  GLSL3,
  Group,
  Points,
  Quaternion,
  ShaderMaterial,
  Uniform,
  Vector3,
} from 'three';
import { TAU } from '../../core/math';
import type { AsteroidBelt, RGB } from '../../core/types';
import type {
  IAsteroidBeltVisual,
  Quality,
  SystemFurnitureOptions,
  VisualFrame,
} from '../contracts';
import { asteroidBeltShaders } from './asteroidBelt.glsl';
import { type BeltParticles, beltKappa, REBASE_DAYS, rebasePhases, sampleBelt } from './beltModel';

/** Rock count relative to `belt.count` (which is the suggestion for 'high'... ×3 gives the dusty look). */
const ROCK_SCALE: Readonly<Record<Quality, number>> = { low: 1.2, medium: 2, high: 3, ultra: 4.5 };
const MAX_ROCKS = 60_000;
const MAX_DUST = 6000;

/** Linear sprite colours (before albedo and lighting). */
const COLORS: Readonly<Record<AsteroidBelt['composition'], RGB>> = {
  rock: [0.64, 0.53, 0.42],
  metal: [0.66, 0.68, 0.72],
  ice: [0.74, 0.84, 0.97],
};
const ROCK_GAIN = 0.62;
const DUST_GAIN = 0.05;

interface Cloud {
  particles: BeltParticles;
  m0: Float32Array;
  points: Points<BufferGeometry, ShaderMaterial>;
}

export class AsteroidBeltVisual implements IAsteroidBeltVisual {
  readonly object = new Group();
  private readonly belt: AsteroidBelt;
  private readonly kappa: number;
  private clouds: Cloud[] = [];
  private epoch = Number.NaN;
  private readonly u = {
    dt: new Uniform(0),
    kappa: new Uniform(0),
    camS: new Uniform(new Vector3()),
    pixelRatio: new Uniform(1),
    focalPx: new Uniform(500),
    opacity: new Uniform(1),
    time: new Uniform(0),
    crowd: new Uniform(0),
    refRadius: new Uniform(1),
    color: new Uniform(new Color()),
  };
  private readonly qInv = new Quaternion();
  private readonly camS = new Vector3();

  constructor(belt: AsteroidBelt, quality: Quality, centralMassSolar = 1) {
    this.belt = belt;
    this.kappa = beltKappa(belt, centralMassSolar);
    this.u.kappa.value = this.kappa;
    this.u.refRadius.value = belt.innerRadiusKm;
    const [r, g, b] = COLORS[belt.composition];
    this.u.color.value.setRGB(r, g, b);
    this.object.name = 'AsteroidBeltVisual';
    this.build(quality);
  }

  private build(quality: Quality): void {
    const rocks = Math.min(MAX_ROCKS, Math.round(this.belt.count * ROCK_SCALE[quality]));
    const dust = Math.min(MAX_DUST, Math.max(600, Math.round(rocks * 0.4)));
    this.clouds = [
      this.makeCloud(sampleBelt(this.belt, { count: rocks, kind: 'rock' }), false, ROCK_GAIN),
      this.makeCloud(sampleBelt(this.belt, { count: dust, kind: 'dust' }), true, DUST_GAIN),
    ];
    for (const c of this.clouds) this.object.add(c.points);
    this.epoch = Number.NaN;
  }

  private makeCloud(particles: BeltParticles, dust: boolean, gain: number): Cloud {
    const geometry = new BufferGeometry();
    // `position` is unused by the shader but gives three.js its draw count.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(particles.count * 3), 3),
    );
    geometry.setAttribute('aOrbit', new BufferAttribute(particles.orbit, 4));
    geometry.setAttribute('aRock', new BufferAttribute(particles.rock, 4));
    geometry.setAttribute('aLook', new BufferAttribute(particles.look, 4));
    const m0 = new Float32Array(particles.count);
    const m0Attribute = new BufferAttribute(m0, 1);
    m0Attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aM0', m0Attribute);
    const u = this.u;
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: asteroidBeltShaders.vertex,
      fragmentShader: asteroidBeltShaders.fragment,
      defines: dust ? { DUST: '' } : {},
      uniforms: {
        uDt: u.dt,
        uKappa: u.kappa,
        uCamS: u.camS,
        uPixelRatio: u.pixelRatio,
        uFocalPx: u.focalPx,
        uOpacity: u.opacity,
        uTime: u.time,
        uCrowd: u.crowd,
        uRefRadius: u.refRadius,
        uColor: u.color,
        uGain: new Uniform(gain),
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false; // vertices are placed in the shader
    points.name = dust ? 'belt-dust' : 'belt-rocks';
    return { particles, m0, points };
  }

  private clear(): void {
    for (const c of this.clouds) {
      this.object.remove(c.points);
      c.points.geometry.dispose();
      c.points.material.dispose();
    }
    this.clouds = [];
  }

  setQuality(q: Quality): void {
    this.clear();
    this.build(q);
  }

  /** Re-anchors every rock's mean anomaly at `simDays` (float64 maths; see beltModel.ts). */
  private rebase(simDays: number): void {
    this.epoch = simDays;
    for (const c of this.clouds) {
      rebasePhases(c.particles, this.kappa, simDays, c.m0);
      (c.points.geometry.getAttribute('aM0') as BufferAttribute).needsUpdate = true;
    }
  }

  update(frame: VisualFrame, o: SystemFurnitureOptions): void {
    const visible = o.opacity > 0.002;
    this.object.visible = visible;
    if (!visible) return;
    this.object.position.set(0, 0, 0);
    this.object.quaternion.copy(o.eclipticToWorld);
    // Rock positions are S-frame vectors about the star: place the group at the star instead.
    this.object.position.copy(o.starPositionKm);

    if (!(Math.abs(o.simDays - this.epoch) <= REBASE_DAYS)) this.rebase(o.simDays);
    const u = this.u;
    u.dt.value = o.simDays - this.epoch;
    u.opacity.value = o.opacity;
    u.pixelRatio.value = frame.pixelRatio;
    u.time.value = frame.timeSec % TAU; // twinkle rates are integers: seamless every 2π s
    const focalPx =
      frame.camera.projectionMatrix.elements[5] * 0.5 * frame.height * frame.pixelRatio;
    u.focalPx.value = focalPx;

    // Camera in frame S, for the phase function; and how crowded the belt looks from here.
    this.qInv.copy(o.eclipticToWorld).invert();
    const camS = this.camS.copy(o.starPositionKm).negate().applyQuaternion(this.qInv);
    u.camS.value.copy(camS);
    const b = this.belt;
    const dist = Math.max(camS.length(), 0.5 * (b.innerRadiusKm + b.outerRadiusKm));
    const pxPerKm = focalPx / dist;
    const areaKm2 = Math.PI * (b.outerRadiusKm ** 2 - b.innerRadiusKm ** 2);
    const faceOn = Math.max(0.2, Math.abs(camS.y) / Math.max(camS.length(), 1));
    const rocks = (this.clouds[0] as Cloud).particles.count;
    u.crowd.value = Math.min(1e4, (2 * rocks * pxPerKm * pxPerKm) / (areaKm2 * faceOn));
  }

  dispose(): void {
    this.clear();
  }
}
