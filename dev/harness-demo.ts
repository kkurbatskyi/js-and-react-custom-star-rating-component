/**
 * Harness demo — proves the shared pipeline end to end:
 *  - an HDR emissive star (peak ≈ 10, limb-darkened, granulated) blooms under the ACES chain;
 *  - a 0.18-albedo moon lit by a normalised sun reads as photographic mid-grey (≈ sRGB 118–128)
 *    at its sub-solar point;
 *  - a ring of blackbody point sprites (HDR 0.4–16) shows which intensities cross the bloom
 *    threshold (≈ 1.0);
 *  - everything sits 1 AU (1.496e8 units) from the origin and is placed camera-relative, so nothing
 *    jitters while orbiting.
 *
 * The GUI's "Calibration" folder reports probed display values (also `window.__CALIBRATION__`).
 */
import * as THREE from 'three';
import { color } from '../src/render/shaders/color.glsl';
import { common } from '../src/render/shaders/common.glsl';
import { simplex } from '../src/render/shaders/noise.glsl';
import { createHarness } from './harness';

declare global {
  interface Window {
    __CALIBRATION__?: Record<string, number | string>;
  }
}

const AU = 1.496e8;
const ORIGIN = new THREE.Vector3(AU, 0, 0);
const STAR_POS = new THREE.Vector3(-2.3, 0.75, 1.6).add(ORIGIN);
const MOON_POS = new THREE.Vector3(1.35, -0.3, -0.6).add(ORIGIN);
const STAR_RADIUS = 0.5;
const MOON_RADIUS = 1.05;
/** Unit vector from the moon towards the star: the moon's "normalised sun" direction. */
const SUN_DIR = STAR_POS.clone().sub(MOON_POS).normalize();

const h = createHarness({
  title: 'Harness demo',
  fov: 45,
  near: 0.05,
  far: 1000,
  cameraPosition: [AU + 0.3, 2.0, 10.5],
  target: [AU, 0, 0],
  minDistance: 3,
  maxDistance: 60,
});

// ── HDR emissive star ─────────────────────────────────────────────────────────
const starMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  toneMapped: false,
  uniforms: {
    uTime: { value: 0 },
    uIntensity: { value: 10 },
    uTemperature: { value: 5800 },
  },
  vertexShader: /* glsl */ `
    out vec3 vNormal;
    out vec3 vObjectDir;
    out vec3 vViewPos;
    void main() {
      vObjectDir = normalize(position);
      vNormal = normalize(mat3(modelMatrix) * normal);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vViewPos = world.xyz; // the camera sits at the origin: world position is the view ray
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    ${common}
    ${color}
    ${simplex}
    uniform float uTime;
    uniform float uIntensity;
    uniform float uTemperature;
    in vec3 vNormal;
    in vec3 vObjectDir;
    in vec3 vViewPos;
    out vec4 fragColor;
    void main() {
      float mu = saturate(dot(normalize(vNormal), normalize(-vViewPos)));
      // Linear limb darkening I(mu) = 1 - u (1 - mu), u = 0.6 (solar, visible band).
      float limb = 1.0 - 0.6 * (1.0 - mu);
      // Granulation: two octaves of evolving 4D simplex noise.
      vec3 p = vObjectDir * 14.0;
      float gran = 0.65 * snoise(vec4(p, uTime * 0.15)) + 0.35 * snoise(vec4(p * 2.3, uTime * 0.3));
      // Near the limb we see higher, cooler layers of the photosphere: redder.
      vec3 tint = adjustSaturation(blackbody(mix(uTemperature - 1300.0, uTemperature, mu)), 1.25);
      fragColor = vec4(tint * uIntensity * limb * (1.0 + 0.07 * gran), 1.0);
    }
  `,
});
const star = new THREE.Mesh(new THREE.SphereGeometry(STAR_RADIUS, 96, 48), starMaterial);
h.scene.add(star);

// ── Lit grey moon: albedo 0.18 under a normalised sun (irradiance 1) ─────────
const moonMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  toneMapped: false,
  uniforms: {
    uAlbedo: { value: 0.18 },
    uSunDir: { value: SUN_DIR },
    uSunIntensity: { value: 1 },
  },
  vertexShader: /* glsl */ `
    out vec3 vNormal;
    void main() {
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uAlbedo;
    uniform vec3 uSunDir;
    uniform float uSunIntensity;
    in vec3 vNormal;
    out vec4 fragColor;
    void main() {
      // Lambert with unit irradiance: the sub-solar point's radiance is exactly the albedo.
      float nDotL = max(dot(normalize(vNormal), uSunDir), 0.0);
      fragColor = vec4(vec3(uAlbedo * uSunIntensity * nDotL), 1.0);
    }
  `,
});
const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 96, 48), moonMaterial);
h.scene.add(moon);

// ── Ring of blackbody point sprites (colour computed on the GPU from temperature) ──
const RING_COUNT = 150;
const RING_RADIUS = 4.4;
const ringPositions = new Float32Array(RING_COUNT * 3);
const ringTemps = new Float32Array(RING_COUNT);
const ringIntensity = new Float32Array(RING_COUNT);
const KELVIN = [2600, 3400, 4500, 5800, 7500, 10000, 15000, 30000];
for (let i = 0; i < RING_COUNT; i++) {
  const a = (i / RING_COUNT) * Math.PI * 2;
  const j = (i * 0.618034) % 1; // golden-ratio jitter: a loose, deterministic necklace
  const r = RING_RADIUS + (j - 0.5) * 0.45;
  ringPositions.set([Math.cos(a) * r, (j - 0.5) * 0.16, Math.sin(a) * r], i * 3);
  ringTemps[i] = KELVIN[i % KELVIN.length] ?? 5800;
  ringIntensity[i] = 0.4 * 2 ** (((i * 7) % 27) / 5); // 0.4 … 16, five steps per stop
}
const ringGeometry = new THREE.BufferGeometry();
ringGeometry.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));
ringGeometry.setAttribute('aTemp', new THREE.BufferAttribute(ringTemps, 1));
ringGeometry.setAttribute('aIntensity', new THREE.BufferAttribute(ringIntensity, 1));
const ringMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  toneMapped: false,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uPixelRatio: { value: 1 } },
  vertexShader: /* glsl */ `
    ${color}
    in float aTemp;
    in float aIntensity;
    uniform float uPixelRatio;
    out vec3 vColor;
    void main() {
      vColor = adjustSaturation(blackbody(aTemp), 1.25) * aIntensity;
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      gl_PointSize = (4.5 + 1.8 * log2(1.0 + aIntensity)) * uPixelRatio;
    }
  `,
  fragmentShader: /* glsl */ `
    in vec3 vColor;
    out vec4 fragColor;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      // Gaussian core: the centre pixel carries the full HDR value, the rim fades to zero.
      fragColor = vec4(vColor * exp(-dot(p, p) * 5.0), 1.0);
    }
  `,
});
const ring = new THREE.Points(ringGeometry, ringMaterial);
ring.frustumCulled = false;
h.scene.add(ring);

// ── Per frame: camera-relative placement ──────────────────────────────────────
h.onFrame((f) => {
  h.place(star, STAR_POS);
  h.place(moon, MOON_POS);
  h.place(ring, ORIGIN);
  star.rotation.y = f.timeSec * 0.05;
  ring.rotation.set(0.38, f.timeSec * 0.03, 0.16);
  starMaterial.uniforms.uTime.value = f.timeSec;
  ringMaterial.uniforms.uPixelRatio.value = f.pixelRatio;
});

// ── Calibration probes ────────────────────────────────────────────────────────
const calibration: Record<string, number | string> = {};
window.__CALIBRATION__ = calibration;

const scratch = new THREE.Vector3();
function toScreen(absPos: THREE.Vector3): { x: number; y: number } {
  h.relative(absPos, scratch).project(h.camera);
  return {
    x: ((scratch.x + 1) / 2) * window.innerWidth,
    y: ((1 - scratch.y) / 2) * window.innerHeight,
  };
}

async function calibrate(): Promise<void> {
  await h.frames(8);
  const subSolar = toScreen(SUN_DIR.clone().multiplyScalar(MOON_RADIUS).add(MOON_POS));
  const grey = await h.probe(subSolar.x, subSolar.y);
  calibration['grey 0.18 → (ideal ≈ 118–128)'] = grey.slice(0, 3).join(',');

  const centre = toScreen(STAR_POS);
  const top = toScreen(scratch.set(0, STAR_RADIUS, 0).add(STAR_POS));
  const radiusPx = Math.hypot(centre.x - top.x, centre.y - top.y);
  calibration['star radius (px)'] = Math.round(radiusPx);
  calibration['star centre'] = (await h.probe(centre.x, centre.y)).slice(0, 3).join(',');
  // Sample the glow up and to the left, away from the moon and most of the ring.
  for (const k of [1.25, 1.5, 2, 3]) {
    const d = (radiusPx * k) / Math.SQRT2;
    const rgba = await h.probe(centre.x - d, centre.y - d);
    calibration[`glow at ${k} R`] = rgba.slice(0, 3).join(',');
  }

  const folder = h.gui.addFolder('Calibration (display sRGB)');
  for (const key of Object.keys(calibration)) folder.add(calibration, key).disable();
  console.info('[harness-demo] calibration', calibration);
}

h.start();
void h.waitFor(calibrate());
