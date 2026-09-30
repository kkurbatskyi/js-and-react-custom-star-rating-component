/**
 * Shared rig for the sky dev pages (dev/sky.ts, dev/rings.ts): a body from the mock universe, a plain lit
 * sphere of our own as the surface (fast, deterministic, no bakes), the sky module's atmosphere / clouds /
 * rings on top, camera + sun presets in world space. `?real=1` swaps the sphere for the planet sculptor's
 * PlanetVisual (whatever it currently composes) to check the integrated result.
 *
 *   ?body=terran|desert|hothouse|ocean|titan|giant|ice|<id>|home.d   the world (default terran = Halcyon)
 *   ?view=<preset>   camera + sun preset (page specific)
 *   ?sun=<az>,<el>   sun direction override, degrees (az from +Z towards +X, el above the XZ plane)
 *   ?orbit=<dist>,<az>,<el>  camera override, planet radii and degrees   ?fov=<deg>
 *   ?star=1          draw the star's disc (default: only when the sun is near the view)
 *   ?tilt=1          use the body's real orientation (default: identity: ring plane = world XZ)
 *   ?parts=atm,cloud,ring   restrict to some sky parts
 */
import * as THREE from 'three';
import { blackbodyRGB } from '../src/core/color';
import type { BodyBase, StarSystem } from '../src/core/types';
import type {
  IAtmosphereShell,
  ICloudLayer,
  IRingVisual,
  PlanetUniforms,
} from '../src/render/contracts';
import { createAtmosphere } from '../src/render/planet/atmosphere';
import { createClouds } from '../src/render/planet/clouds';
import { PlanetVisual } from '../src/render/planet/PlanetVisual';
import { createRings, ringUniformVector } from '../src/render/planet/rings';
import { noise } from '../src/render/shaders/noise.glsl';
import { bodyOrientation } from '../src/sim/orientation';
import { createHarness, type Harness } from './harness';
import { isPlanetType, pickBody } from './planetBodies';

const ALIASES: Readonly<Record<string, string>> = {
  terran: 'home.d',
  desert: 'home.e',
  giant: 'home.f',
  titan: 'home.f.3',
  ice: 'home.g',
  icegiant: 'home.g',
  lava: 'home.b',
};

export interface ViewPreset {
  /** Camera: distance in planet radii, azimuth (from +Z towards +X) and elevation, degrees. */
  cam: readonly [number, number, number];
  /** Orbit target in planet radii (absolute; the planet is at the origin). */
  target?: readonly [number, number, number];
  /** Sun direction: azimuth, elevation (degrees, world space). */
  sun: readonly [number, number];
  fov?: number;
  star?: boolean;
}

export function polar(
  dist: number,
  azDeg: number,
  elDeg: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  return out
    .set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    .multiplyScalar(dist);
}

function numbers(s: string | null): number[] {
  return (s ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

const surfaceVertex = /* glsl */ `
uniform vec3 uRadii;
out vec3 vLocal;
void main() {
  vLocal = position * uRadii;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const surfaceFragment = /* glsl */ `
${noise}
uniform vec3 uRadii;
uniform vec3 uSunDir;      // body frame
uniform vec3 uSunRad;
uniform vec3 uCols[3];
uniform vec3 uOcean;
uniform float uOceanCov;
uniform float uGiant;
uniform vec4 uRing;        // inner, outer, tau, seed (0 = none)
uniform float uSeed;
in vec3 vLocal;
out vec4 fragColor;

void main() {
  vec3 p = vLocal;
  vec3 dir = normalize(p / uRadii);
  vec3 n = normalize(vec3(p.x / (uRadii.x * uRadii.x), p.y / (uRadii.y * uRadii.y), p.z / (uRadii.z * uRadii.z)));
  vec3 albedo;
  if (uGiant > 0.5) {
    float lat = asin(dir.y);
    float w = fbm(vec3(dir.x * 3.0, dir.y * 9.0, dir.z * 3.0) + uSeed, 4);
    float bands = 0.5 + 0.5 * sin(lat * 14.0 + w * 2.6);
    albedo = mix(uCols[0], uCols[1], bands);
    albedo = mix(albedo, uCols[2], smoothstep(0.55, 0.9, fbm(dir * 6.0 + uSeed, 3) * 0.5 + 0.5) * 0.5);
  } else {
    float h = fbm(dir * 2.3 + uSeed, 6) + 0.25 * fbm(dir * 9.0 + uSeed, 3);
    float sea = mix(-0.9, 0.5, uOceanCov);
    float land = smoothstep(sea - 0.02, sea + 0.02, h);
    vec3 landCol = mix(uCols[0], uCols[1], smoothstep(0.0, 0.5, fbm(dir * 5.0 + 3.0, 4) * 0.5 + 0.5));
    albedo = mix(uOcean, landCol, uOceanCov > 0.0 ? land : 1.0);
  }
  float mu = dot(n, uSunDir);
  float lit = smoothstep(-0.03, 0.1, mu) * max(mu, 0.0);
  // Ring shadow on the planet (same optical-depth profile the rings use) when RING_SHADOW is available.
  fragColor = vec4(albedo * uSunRad * (lit * RING_SHADOW + 0.004), 1.0);
}
`;

/** Plain lit sphere with continents/oceans or gas bands: the stand-in for the planet sculptor's surface. */
class TestSurface {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly sunLocal = new THREE.Vector3(1, 0, 0);
  private readonly sunRad = new THREE.Vector3(1, 1, 1);
  private readonly qInv = new THREE.Quaternion();

  constructor(body: BodyBase, ringShadowGlsl: string) {
    const giant = body.type === 'gas-giant' || body.type === 'ice-giant';
    const cols = body.appearance.surfaceColors;
    const c = (i: number): THREE.Color => {
      const v = cols[Math.min(i, cols.length - 1)] ?? [0.3, 0.3, 0.3];
      return new THREE.Color(v[0], v[1], v[2]);
    };
    const ocean = body.appearance.oceanColor ?? [0, 0, 0];
    const ring = body.rings;
    this.uniforms = {
      uRadii: {
        value: new THREE.Vector3(
          body.radiusKm,
          body.radiusKm * (1 - body.oblateness),
          body.radiusKm,
        ),
      },
      uSunDir: { value: this.sunLocal },
      uSunRad: { value: this.sunRad },
      uCols: { value: [c(0), c(1), c(2)] },
      uOcean: { value: new THREE.Color(ocean[0], ocean[1], ocean[2]) },
      uOceanCov: { value: giant ? 0 : body.oceanCoverage },
      uGiant: { value: giant ? 1 : 0 },
      uRing: {
        value: ring ? new THREE.Vector4(...ringUniformVector(ring)) : new THREE.Vector4(0, 0, 0, 0),
      },
      uSeed: { value: (body.seed % 1000) / 37 },
    };
    const fragment = surfaceFragment.replaceAll(
      'RING_SHADOW',
      ring ? 'ringShadowTest(vLocal, uSunDir)' : '1.0',
    );
    const helper = ring
      ? `${ringShadowGlsl}
float ringShadowTest(vec3 P, vec3 L) { return ringShadow(P, L, uRing); }`
      : '';
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 48),
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: surfaceVertex,
        fragmentShader: fragment.replace('void main() {', `${helper}\nvoid main() {`),
        uniforms: this.uniforms,
        toneMapped: false,
      }),
    );
    this.mesh.scale.set(body.radiusKm, body.radiusKm * (1 - body.oblateness), body.radiusKm);
    this.mesh.name = 'surface';
  }

  update(u: PlanetUniforms): void {
    this.qInv.copy(u.orientation).invert();
    this.sunLocal.copy(u.sunDirection).applyQuaternion(this.qInv).normalize();
    this.sunRad.set(
      u.sunColor.r * u.sunIntensity,
      u.sunColor.g * u.sunIntensity,
      u.sunColor.b * u.sunIntensity,
    );
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export interface SkyRig {
  h: Harness;
  body: BodyBase;
  system: StarSystem;
  radiusKm: number;
  atmosphere: IAtmosphereShell | null;
  clouds: ICloudLayer | null;
  rings: IRingVisual | null;
  ctl: { sunAz: number; sunEl: number; sunIntensity: number; intensity: number };
  /** Called after each frame's update (pages add their own uniforms/readouts). */
  onUpdate: (cb: (f: import('../src/render/contracts').VisualFrame) => void) => void;
}

export function resolveBody(
  params: URLSearchParams,
  fallback: string,
): ReturnType<typeof pickBody> {
  const raw = params.get('body') ?? fallback;
  const q = new URLSearchParams();
  const alias = ALIASES[raw];
  if (alias) q.set('body', alias);
  else if (isPlanetType(raw)) {
    q.set('type', raw);
    q.set('n', params.get('n') ?? '0');
  } else q.set('body', raw);
  return pickBody(q);
}

/** Loads a ring-shadow GLSL chunk lazily so the kit works before the rings module exists. */
export async function createSkyRig(config: {
  title: string;
  defaultBody: string;
  defaultView: string;
  views: Readonly<Record<string, ViewPreset>>;
  ringShadowGlsl: string;
}): Promise<SkyRig> {
  const params = new URLSearchParams(location.search);
  const picked = resolveBody(params, config.defaultBody);
  const { body, system } = picked;
  const R = body.radiusKm;
  const viewName = params.get('view') ?? config.defaultView;
  const preset = config.views[viewName] ?? config.views[config.defaultView];
  if (!preset) throw new Error('no view preset');
  const camOverride = numbers(params.get('orbit'));
  const cam =
    camOverride.length === 3 ? (camOverride as unknown as [number, number, number]) : preset.cam;
  const sunOverride = numbers(params.get('sun'));
  const sun = sunOverride.length === 2 ? (sunOverride as unknown as [number, number]) : preset.sun;
  const fov = Number(params.get('fov') ?? preset.fov ?? 34);

  const camPos = polar(cam[0] * R, cam[1], cam[2]);
  const target = preset.target
    ? new THREE.Vector3(...preset.target).multiplyScalar(R)
    : new THREE.Vector3();
  const h = createHarness({
    title: `${body.name} - ${body.type} - ${viewName}`,
    fov,
    // Tight near plane for far views: a 24-bit depth buffer needs a sane near/far ratio (the engine slices depth).
    near: Math.max(R * 1e-4, (cam[0] - 1.1) * R * 0.3),
    far: R * 500,
    cameraPosition: camPos,
    target,
    minDistance: R * 1.0005,
    maxDistance: R * 100,
    simRate: 0,
  });

  const parts = new Set((params.get('parts') ?? 'atm,cloud,ring').split(','));
  const real = params.get('real') === '1';
  const root = new THREE.Group();
  h.scene.add(root);

  let surface: TestSurface | null = null;
  let planet: PlanetVisual | null = null;
  let atmosphere: IAtmosphereShell | null = null;
  let clouds: ICloudLayer | null = null;
  let rings: IRingVisual | null = null;
  if (real) {
    planet = new PlanetVisual(body, { system }, h.quality, 'full');
    h.scene.add(planet.object);
    void h.prepare(planet, 250);
  } else {
    surface = new TestSurface(body, config.ringShadowGlsl);
    root.add(surface.mesh);
    if (parts.has('atm')) atmosphere = createAtmosphere(body, system, h.quality);
    if (parts.has('cloud')) clouds = createClouds(body, system, h.quality);
    if (parts.has('ring')) rings = createRings(body, system, h.quality);
    for (const p of [clouds, atmosphere, rings]) if (p) root.add(p.object);
  }

  const ctl = { sunAz: sun[0], sunEl: sun[1], sunIntensity: 1, intensity: 1 };
  h.gui.add(ctl, 'sunAz', -180, 180, 1).name('sun azimuth');
  h.gui.add(ctl, 'sunEl', -80, 80, 1).name('sun elevation');
  h.gui.add(ctl, 'sunIntensity', 0.4, 2, 0.01).name('sun intensity');
  h.gui.add(ctl, 'intensity', 0, 1, 0.01).name('sky intensity');
  for (const [name, part] of [
    ['atmosphere', atmosphere],
    ['clouds', clouds],
    ['rings', rings],
  ] as const) {
    if (part) h.gui.add(part.object, 'visible').name(name);
  }

  // Star disc: drawn where the sun is (an emissive sphere far away) so limb reddening is visible.
  const star = system.star;
  const sunColor = new THREE.Color().setRGB(...blackbodyRGB(star.temperatureK));
  const starDistKm = Math.max(body.orbit.semiMajorAxisKm, 1);
  const sunAng = Math.max(Math.atan((star.radiusSolar * 695_700) / starDistKm), 0.002);
  const drawStar =
    params.get('star') === '1' || (params.get('star') !== '0' && preset.star === true);
  const starMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshBasicMaterial({ color: sunColor.clone().multiplyScalar(40), toneMapped: false }),
  );
  starMesh.visible = drawStar;
  h.scene.add(starMesh);

  const q = new THREE.Quaternion();
  const rel = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const useTilt = params.get('tilt') === '1';
  const callbacks: Array<(f: import('../src/render/contracts').VisualFrame) => void> = [];
  const u: PlanetUniforms = {
    positionKm: rel,
    orientation: q,
    sunDirection: sunDir,
    sunColor,
    sunAngularRadiusRad: sunAng,
    sunIntensity: 1,
    intensity: 1,
  };
  const starDist = R * 300;
  starMesh.scale.setScalar(starDist * Math.tan(sunAng));

  h.onFrame((f) => {
    h.relative(new THREE.Vector3(0, 0, 0), rel);
    if (useTilt) bodyOrientation(body, f.simDays, q);
    else q.identity();
    polar(1, ctl.sunAz, ctl.sunEl, sunDir).normalize();
    u.sunIntensity = ctl.sunIntensity;
    u.intensity = ctl.intensity;
    root.position.copy(rel);
    root.quaternion.copy(q);
    if (planet) planet.update(f, u);
    else {
      surface?.update(u);
      atmosphere?.update(f, u);
      clouds?.update(f, u);
      rings?.update(f, u);
    }
    // Star disc placed at sunDir * starDist (absolute: planet at origin), camera-relative.
    h.relative(new THREE.Vector3().copy(sunDir).multiplyScalar(starDist), starMesh.position);
    for (const cb of callbacks) cb(f);
  });

  return {
    h,
    body,
    system,
    radiusKm: R,
    atmosphere,
    clouds,
    rings,
    ctl,
    onUpdate: (cb) => {
      callbacks.push(cb);
    },
  };
}
