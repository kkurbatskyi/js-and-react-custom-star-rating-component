/**
 * OrbitLines — the orrery's orbit rings.
 *
 * Thin, constant-pixel-width, antialiased ribbons, one per planet (and one per moon of the
 * highlighted planet's family), each brightest at its body and fading into a faint tail behind it,
 * so the direction of motion reads at a glance. Gold for the highlighted body's orbit, blue-grey
 * for the rest.
 *
 * Kink-free at every zoom, by construction (details in orbitGeometry.ts): the ellipse is
 * re-tessellated every frame in float64, relative to the camera, with vertices chosen so the chord
 * error stays under a fraction of a pixel; the ribbon is extruded on the GPU from the analytic
 * tangent. Nothing large ever reaches float32 near the camera.
 *
 * Fades: `opacity` (the engine's overall fade), orbit size on screen (rings that collapse to a dot
 * dissolve), a mild far-side dimming for depth, and a gap around the focused body once it is big on
 * screen, so a line never slices through a planet you are looking at.
 *
 * Frames: the group sits at the camera and carries only the S → world rotation; vertices are
 * camera-relative frame-S positions.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  GLSL3,
  Group,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
} from 'three';
import { smoothstep } from '../../core/math';
import type { Moon, OrbitalElements, Planet, StarSystem } from '../../core/types';
import { eccentricAnomalyAt, orbitalPositionKm } from '../../sim/kepler';
import { equatorialFrame, moonPositionKm } from '../../sim/orientation';
import type { IOrbitLines, OrbitLinesOptions, Quality, VisualFrame } from '../contracts';
import {
  OrbitCurve,
  OrbitTessellator,
  SEGMENT_STRIDE,
  type TessellationOptions,
  type TessellationView,
} from './orbitGeometry';
import { orbitFragmentShader, orbitVertexShader } from './orbitLines.glsl';

interface QualityTier {
  /** Uniform pieces each orbit starts with. */
  base: number;
  /** Chord tolerance, px. */
  tolerancePx: number;
  /** Maximum vertices per orbit. */
  capacity: number;
}

const TIERS: Readonly<Record<Quality, QualityTier>> = {
  low: { base: 48, tolerancePx: 0.4, capacity: 500 },
  medium: { base: 72, tolerancePx: 0.28, capacity: 900 },
  high: { base: 96, tolerancePx: 0.2, capacity: 1400 },
  ultra: { base: 128, tolerancePx: 0.14, capacity: 2000 },
};

/** Geometry nearer than this along the view axis is clipped on the CPU (below any layer near plane). */
const MIN_DEPTH_KM = 0.05;

interface Style {
  color: Color;
  /** Peak brightness at the body (linear HDR, additive; stays below the bloom threshold). */
  alpha: number;
  /** Half width of the solid core, CSS px. */
  corePx: number;
  /** 0..1 halo strength. */
  glow: number;
  /** Tail brightness one orbit behind the body, relative to the head. */
  floor: number;
  /** Tail falloff exponent. */
  gamma: number;
}

const PLANET_STYLE: Style = {
  color: new Color(0.36, 0.53, 0.8),
  alpha: 0.55,
  corePx: 0.6,
  glow: 0,
  floor: 0.1,
  gamma: 2.2,
};
const MOON_STYLE: Style = {
  color: new Color(0.5, 0.6, 0.78),
  alpha: 0.5,
  corePx: 0.55,
  glow: 0,
  floor: 0.12,
  gamma: 2,
};
const HIGHLIGHT_STYLE: Style = {
  color: new Color(1, 0.78, 0.42),
  alpha: 0.95,
  corePx: 0.85,
  glow: 0.32,
  floor: 0.2,
  gamma: 1.9,
};

/** Extra ribbon half width beyond the core: 0.5 px of antialiasing + margin, and the halo. */
const AA_MARGIN_PX = 1;
const GLOW_MARGIN_PX = 3;

interface Shared {
  res: Uniform<Vector2>;
  focus: Uniform<Vector3>;
  zone: Uniform<Vector2>;
}

interface Quad {
  position: BufferAttribute;
  index: BufferAttribute;
}

function createQuad(): Quad {
  // x picks the segment end (0 = start, 1 = end), y the side of the ribbon.
  return {
    position: new BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3),
    index: new BufferAttribute(new Uint16Array([0, 2, 1, 1, 2, 3]), 1),
  };
}

/** One drawn orbit: its curve, tessellator, instance buffer and material. */
class Ribbon {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly curve = new OrbitCurve();
  private readonly tess: OrbitTessellator;
  private readonly data: Float32Array;
  private readonly buffer: InstancedInterleavedBuffer;
  private readonly u: {
    halfWidth: Uniform<number>;
    color: Uniform<Color>;
    opacity: Uniform<number>;
    core: Uniform<number>;
    glow: Uniform<number>;
    floor: Uniform<number>;
    gamma: Uniform<number>;
    depth: Uniform<Vector2>;
  };

  constructor(name: string, quad: Quad, shared: Shared, capacity: number) {
    this.tess = new OrbitTessellator(capacity);
    this.data = new Float32Array(capacity * SEGMENT_STRIDE);
    this.buffer = new InstancedInterleavedBuffer(this.data, SEGMENT_STRIDE, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.position);
    geometry.setAttribute('iP0', new InterleavedBufferAttribute(this.buffer, 3, 0));
    geometry.setAttribute('iT0', new InterleavedBufferAttribute(this.buffer, 4, 3));
    geometry.setAttribute('iP1', new InterleavedBufferAttribute(this.buffer, 3, 7));
    geometry.setAttribute('iT1', new InterleavedBufferAttribute(this.buffer, 4, 10));
    geometry.instanceCount = 0;
    this.u = {
      halfWidth: new Uniform(2),
      color: new Uniform(new Color()),
      opacity: new Uniform(0),
      core: new Uniform(1),
      glow: new Uniform(0),
      floor: new Uniform(0.2),
      gamma: new Uniform(2),
      depth: new Uniform(new Vector2(1, 1)),
    };
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: orbitVertexShader,
      fragmentShader: orbitFragmentShader,
      uniforms: {
        uRes: shared.res,
        uHalfWidthPx: this.u.halfWidth,
        uColor: this.u.color,
        uOpacity: this.u.opacity,
        uCorePx: this.u.core,
        uGlow: this.u.glow,
        uFloor: this.u.floor,
        uGamma: this.u.gamma,
        uFocus: shared.focus,
        uFocusZone: shared.zone,
        uDepth: this.u.depth,
        uDepthCue: new Uniform(0.4),
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = name;
    // Vertices are rebuilt around the camera every frame; there is no meaningful bounding volume.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * Restyles and rebuilds the ribbon. `alpha` ≈ 0 hides it. `depthMid`/`depthSize`: distance from
   * the camera to the orbit's centre and the orbit's size, for the far-side dimming.
   */
  draw(
    orbit: OrbitalElements,
    parentFrame: Quaternion | null,
    parentS: Vector3 | null,
    cameraS: Vector3,
    headE: number,
    style: Style,
    alpha: number,
    pixelRatio: number,
    depthMid: number,
    view: TessellationView,
    opts: TessellationOptions,
  ): void {
    const mesh = this.mesh;
    if (alpha < 0.002 || !(orbit.semiMajorAxisKm > 0)) {
      mesh.visible = false;
      return;
    }
    const u = this.u;
    u.color.value.copy(style.color);
    u.opacity.value = alpha * style.alpha;
    u.core.value = style.corePx * pixelRatio;
    u.glow.value = style.glow;
    u.floor.value = style.floor;
    u.gamma.value = style.gamma;
    u.halfWidth.value =
      style.corePx * pixelRatio + AA_MARGIN_PX + (style.glow > 0 ? GLOW_MARGIN_PX * pixelRatio : 0);
    u.depth.value.set(depthMid, orbit.semiMajorAxisKm);

    this.curve.set(orbit, parentFrame, parentS, cameraS);
    this.tess.build(this.curve, headE, view, opts);
    const n = this.tess.writeSegments(this.data, view, MIN_DEPTH_KM);
    mesh.geometry.instanceCount = n;
    mesh.visible = n > 0;
    if (n > 0) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, n * SEGMENT_STRIDE);
      this.buffer.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Largest visual extent of a body from its centre (rings included), km. */
function extentKm(body: Planet | Moon): number {
  return Math.max(body.radiusKm * 1.1, body.rings?.outerRadiusKm ?? 0);
}

export class OrbitLines implements IOrbitLines {
  readonly object = new Group();
  private readonly planets: readonly Planet[];
  private readonly prefixes: readonly string[];
  private readonly shared: Shared = {
    res: new Uniform(new Vector2(1, 1)),
    focus: new Uniform(new Vector3()),
    zone: new Uniform(new Vector2()),
  };
  private readonly quad = createQuad();
  private planetRibbons: Ribbon[] = [];
  /** Per planet, per moon; created on first use. */
  private moonRibbons: (Ribbon | null)[][] = [];
  private tier: QualityTier;
  private readonly opts: TessellationOptions;
  private readonly view: TessellationView = { fx: 0, fy: 0, fz: -1, focalPx: 1 };

  // Per-frame scratch (no allocations in update).
  private readonly qInv = new Quaternion();
  private readonly qEq = new Quaternion();
  private readonly camQ = new Quaternion();
  private readonly cameraS = new Vector3();
  private readonly fwd = new Vector3();
  private readonly focusS = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly planetPos: Vector3[];
  private readonly planetE: Float64Array;

  constructor(system: StarSystem, quality: Quality) {
    this.planets = system.planets;
    this.prefixes = system.planets.map((p) => `${p.id}.`);
    this.planetPos = system.planets.map(() => new Vector3());
    this.planetE = new Float64Array(system.planets.length);
    this.tier = TIERS[quality];
    this.opts = {
      baseSegments: this.tier.base,
      tolerancePx: this.tier.tolerancePx,
      minDepthKm: MIN_DEPTH_KM,
    };
    this.object.name = `OrbitLines:${system.id}`;
    this.build();
  }

  private build(): void {
    this.planetRibbons = this.planets.map((p) => {
      const ribbon = new Ribbon(`orbit:${p.id}`, this.quad, this.shared, this.tier.capacity);
      this.object.add(ribbon.mesh);
      return ribbon;
    });
    this.moonRibbons = this.planets.map((p) => p.moons.map(() => null));
  }

  private clear(): void {
    for (const r of this.planetRibbons) r.dispose();
    for (const row of this.moonRibbons) for (const r of row) r?.dispose();
    this.object.clear();
    this.planetRibbons = [];
    this.moonRibbons = [];
  }

  setQuality(q: Quality): void {
    const next = TIERS[q];
    if (next === this.tier) return;
    this.tier = next;
    this.opts.baseSegments = next.base;
    this.opts.tolerancePx = next.tolerancePx;
    this.clear();
    this.build();
  }

  private moonRibbon(pi: number, mi: number, moon: Moon): Ribbon {
    const row = this.moonRibbons[pi] as (Ribbon | null)[];
    let ribbon = row[mi] ?? null;
    if (!ribbon) {
      ribbon = new Ribbon(`orbit:${moon.id}`, this.quad, this.shared, this.tier.capacity);
      this.object.add(ribbon.mesh);
      row[mi] = ribbon;
    }
    return ribbon;
  }

  /**
   * Extent (km) of the focused body, found by matching `focusPositionKm` against the bodies'
   * positions (the focus is always one of them, so the match is exact); 0 when unknown.
   */
  private focusExtent(simDays: number): number {
    const f = this.focusS;
    const tol = 1e-7 * f.length();
    const planets = this.planets;
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i] as Planet;
      this.tmp.copy(this.planetPos[i] as Vector3).sub(this.cameraS);
      if (this.tmp.distanceTo(f) <= 0.25 * p.radiusKm + tol) return extentKm(p);
    }
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i] as Planet;
      for (const moon of p.moons) {
        moonPositionKm(moon, p, simDays, this.tmp2)
          .add(this.planetPos[i] as Vector3)
          .sub(this.cameraS);
        if (this.tmp2.distanceTo(f) <= 0.25 * moon.radiusKm + tol) return extentKm(moon);
      }
    }
    return 0;
  }

  update(frame: VisualFrame, o: OrbitLinesOptions): void {
    const visible = o.opacity > 0.002;
    this.object.visible = visible;
    if (!visible) return;
    this.object.position.set(0, 0, 0);
    this.object.quaternion.copy(o.eclipticToWorld);

    const pr = frame.pixelRatio;
    const shared = this.shared;
    shared.res.value.set(frame.width * pr, frame.height * pr);

    // Camera in frame S (float64), its forward axis, and the projection's focal length in px.
    this.qInv.copy(o.eclipticToWorld).invert();
    const cameraS = this.cameraS.copy(o.starPositionKm).negate().applyQuaternion(this.qInv);
    frame.camera.getWorldQuaternion(this.camQ);
    const fwd = this.fwd.set(0, 0, -1).applyQuaternion(this.camQ).applyQuaternion(this.qInv);
    const view = this.view;
    view.fx = fwd.x;
    view.fy = fwd.y;
    view.fz = fwd.z;
    view.focalPx = frame.camera.projectionMatrix.elements[5] * 0.5 * frame.height * pr;
    const distStar = o.starPositionKm.length();

    // Bodies: eccentric anomaly of each planet and its position in S.
    const planets = this.planets;
    for (let i = 0; i < planets.length; i++) {
      const orbit = (planets[i] as Planet).orbit;
      this.planetE[i] = eccentricAnomalyAt(orbit, o.simDays);
      orbitalPositionKm(orbit, o.simDays, this.planetPos[i] as Vector3);
    }

    // The highlighted body decides whose family (planet + moons) is drawn in detail.
    const hid = o.highlightId;
    let family = -1;
    if (hid !== null) {
      for (let i = 0; i < planets.length; i++) {
        if (hid === (planets[i] as Planet).id || hid.startsWith(this.prefixes[i] as string)) {
          family = i;
          break;
        }
      }
    }

    // Gap around the focused body, growing as it fills more of the screen.
    let zoneNear = 0;
    let zoneFar = 0;
    if (o.focusPositionKm) {
      this.focusS.copy(o.focusPositionKm).applyQuaternion(this.qInv);
      shared.focus.value.copy(this.focusS);
      const extent = this.focusExtent(o.simDays);
      if (extent > 0) {
        const projected = (extent * view.focalPx) / Math.max(this.focusS.length(), extent);
        const gate = smoothstep(1.5, 8, projected);
        zoneNear = 1.3 * extent * gate;
        zoneFar = 3.4 * extent * gate;
      }
    }
    shared.zone.value.set(zoneNear, zoneFar);

    // Planet orbits.
    for (let i = 0; i < planets.length; i++) {
      const planet = planets[i] as Planet;
      const size = planet.orbit.semiMajorAxisKm;
      const px = (view.focalPx * size) / Math.max(distStar, size * 0.05);
      const fade = smoothstep(2, 9, px);
      const style = i === family ? HIGHLIGHT_STYLE : PLANET_STYLE;
      (this.planetRibbons[i] as Ribbon).draw(
        planet.orbit,
        null,
        null,
        cameraS,
        this.planetE[i] as number,
        style,
        o.opacity * fade,
        pr,
        distStar,
        view,
        this.opts,
      );
    }

    // Moon orbits of the highlighted family.
    for (let pi = 0; pi < planets.length; pi++) {
      const planet = planets[pi] as Planet;
      const row = this.moonRibbons[pi] as (Ribbon | null)[];
      if (pi !== family) {
        for (const r of row) if (r) r.mesh.visible = false;
        continue;
      }
      equatorialFrame(planet, this.qEq);
      const parentPos = this.planetPos[pi] as Vector3;
      const dist = this.tmp.copy(parentPos).sub(cameraS).length();
      for (let mi = 0; mi < planet.moons.length; mi++) {
        const moon = planet.moons[mi] as Moon;
        const size = moon.orbit.semiMajorAxisKm;
        const px = (view.focalPx * size) / Math.max(dist, size * 0.05);
        const fade = smoothstep(3, 16, px);
        this.moonRibbon(pi, mi, moon).draw(
          moon.orbit,
          this.qEq,
          parentPos,
          cameraS,
          eccentricAnomalyAt(moon.orbit, o.simDays),
          hid === moon.id ? HIGHLIGHT_STYLE : MOON_STYLE,
          o.opacity * fade,
          pr,
          dist,
          view,
          this.opts,
        );
      }
    }
  }

  dispose(): void {
    this.clear();
  }
}
