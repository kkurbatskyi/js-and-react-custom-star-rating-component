/**
 * GiantSurface — the opaque cloud deck of a gas or ice giant: an oblate ellipsoid running the analytic
 * band/jet/vortex shader (`glsl/giant.glsl.ts`). No bake. The same program serves 'lite' (single flow
 * layer, three octaves, coarse mesh) and 'full'.
 *
 * Flow time is `simDays - epoch` (epoch = the visual's first frame, so float32 keeps sub-second precision)
 * plus a slow wall-clock drift, so the bands visibly slide even at real-time speed.
 */
import {
  Color,
  GLSL3,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { BodyBase } from '../../../core/types';
import { type PlanetUniforms, type Quality, RENDER_ORDER, type VisualFrame } from '../../contracts';
import { common } from '../../shaders/common.glsl';
import { noise } from '../../shaders/noise.glsl';
import { type GiantLook, SURFACE_SEGMENTS } from '../appearance';
import { BodyFrame } from './bodyFrame';
import { createGiantProfileTexture } from './giantProfile';
import { giantFragment, giantVertex } from './glsl/giant.glsl';
import { lightingGlsl } from './glsl/lighting.glsl';

const fragmentShader = `${common}\n${noise}\n${lightingGlsl}\n${giantFragment}`;
const MAX_COLORS = 5;
/** Days of flow per cycle before a layer resets (cross-faded, see the shader). */
const CYCLE_DAYS = 2.5;
/** Wall-clock drift: simulated days of flow per real second, so bands move even at real-time. */
const DRIFT_DAYS_PER_SEC = 0.05;

export class GiantSurface {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly frame = new BodyFrame();
  private readonly body: BodyBase;
  private readonly uniforms: Record<string, Uniform>;
  private readonly profile;
  private readonly sunRadiance = new Vector3();
  private epoch: number | null = null;

  constructor(body: BodyBase, look: GiantLook, quality: Quality, lite: boolean) {
    this.body = body;
    this.profile = createGiantProfileTexture(look, body.seed);
    const colors = Array.from({ length: MAX_COLORS }, (_, i) => {
      const c = look.colors[Math.min(i, look.colors.length - 1)] ?? [0.5, 0.5, 0.5];
      return new Color(c[0], c[1], c[2]);
    });
    const spots = Array.from({ length: 4 }, () => new Vector4());
    const spotCols = Array.from({ length: 4 }, () => new Vector4());
    look.spots.slice(0, 4).forEach((s, i) => {
      spots[i]?.set(s.lat, s.lon, s.size, s.swirl);
      spotCols[i]?.set(s.color[0], s.color[1], s.color[2], s.tint);
    });
    const ring = body.rings;
    this.uniforms = {
      uProfile: new Uniform(this.profile),
      uColors: new Uniform(colors),
      uColorCount: new Uniform(Math.min(MAX_COLORS, Math.max(2, look.colors.length))),
      uSunDirB: new Uniform(this.frame.sunDir),
      uCamB: new Uniform(this.frame.camPos),
      uSunRadiance: new Uniform(this.sunRadiance),
      uIntensity: new Uniform(1),
      uRadii: new Uniform(
        new Vector3(body.radiusKm, body.radiusKm * (1 - body.oblateness), body.radiusKm),
      ),
      uSunAng: new Uniform(0.0047),
      uOcc: new Uniform(this.frame.occluders),
      uOccCount: new Uniform(0),
      uRing: new Uniform(
        ring
          ? new Vector4(
              ring.innerRadiusKm,
              ring.outerRadiusKm,
              ring.opticalDepth,
              (ring.seed % 997) / 97,
            )
          : new Vector4(0, 0, 0, 0),
      ),
      uSeed: new Uniform(new Vector3(look.seed[0], look.seed[1], look.seed[2])),
      uBandFreq: new Uniform(look.bandFreq),
      uContrast: new Uniform(look.contrast),
      uTurbulence: new Uniform(look.turbulence),
      uJetSpeed: new Uniform(look.jetSpeed),
      uFlow: new Uniform(0),
      uCycleDays: new Uniform(CYCLE_DAYS),
      uLite: new Uniform(lite ? 1 : 0),
      uSpots: new Uniform(spots),
      uSpotCol: new Uniform(spotCols),
      uSpotCount: new Uniform(Math.min(4, look.spots.length)),
      uHexagon: new Uniform(look.hexagon ? 1 : 0),
      uPolarTint: new Uniform(new Color(look.polarTint[0], look.polarTint[1], look.polarTint[2])),
      uStreaks: new Uniform(look.streaks),
      uGlowColor: new Uniform(
        new Color(look.glow.color[0], look.glow.color[1], look.glow.color[2]),
      ),
      uGlow: new Uniform(new Vector2(look.glow.strength, look.glow.dayGlow)),
      uLimb: new Uniform(look.limb),
      uWrap: new Uniform(look.wrap),
    };
    const seg = lite ? 40 : SURFACE_SEGMENTS[quality];
    this.mesh = new Mesh(
      new SphereGeometry(1, seg, seg / 2),
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: giantVertex,
        fragmentShader,
        uniforms: this.uniforms,
        toneMapped: false,
      }),
    );
    this.mesh.scale.set(body.radiusKm, body.radiusKm * (1 - body.oblateness), body.radiusKm);
    this.mesh.renderOrder = RENDER_ORDER.surface;
    this.mesh.name = 'surface';
    this.mesh.frustumCulled = false;
  }

  update(frame: VisualFrame, u: PlanetUniforms): void {
    this.frame.update(this.body, u);
    this.sunRadiance.set(
      u.sunColor.r * u.sunIntensity,
      u.sunColor.g * u.sunIntensity,
      u.sunColor.b * u.sunIntensity,
    );
    if (this.epoch === null) this.epoch = frame.simDays;
    const un = this.uniforms;
    if (un.uIntensity) un.uIntensity.value = u.intensity;
    if (un.uSunAng) un.uSunAng.value = Math.max(u.sunAngularRadiusRad, 1e-4);
    if (un.uOccCount) un.uOccCount.value = this.frame.occluderCount;
    if (un.uFlow) un.uFlow.value = frame.simDays - this.epoch + frame.timeSec * DRIFT_DAYS_PER_SEC;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.profile.dispose();
  }
}
