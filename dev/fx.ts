/**
 * FX — the travel effect and the lens flare on a synthetic HDR starfield, under the real PostFX
 * pipeline (travel before bloom, flare after it — exactly how the engine installs them).
 *
 *   ?travel=0..1          streak intensity (default 0)      ?anim=1  ramp 0 → 1 → 0 over 8 s
 *   ?dir=x,y              focus of expansion, ndc (default 0,0; −1..1 spans the screen)
 *   ?sun=x,y              the bright star's screen position, ndc (default 0.42,0.24)
 *   ?flare=0|1  ?fi=n     lens flare on/off (default on), its intensity (default 1)
 */
import * as THREE from 'three';
import { blackbodyRGB } from '../src/core/color';
import { createRng } from '../src/core/rng';
import { createLensFlareEffect } from '../src/render/fx/LensFlareEffect';
import { createTravelEffect } from '../src/render/fx/TravelEffect';
import { createHarness } from './harness';

const params = new URLSearchParams(location.search);
const pair = (name: string, fallback: [number, number]): [number, number] => {
  const v = params.get(name)?.split(',').map(Number);
  return v && v.length === 2 && v.every(Number.isFinite)
    ? [v[0] as number, v[1] as number]
    : fallback;
};

const FOV = 50;
const h = createHarness({
  title: 'FX — travel & lens flare',
  fov: FOV,
  near: 0.1,
  far: 1000,
  cameraPosition: [0, 0, 0.001],
  target: [0, 0, 0],
  simRate: 0,
});
h.controls.enabled = false;

// ── synthetic starfield: power-law brightness, blackbody colours, a denser band
const rng = createRng(20260930);
const COUNT = 9000;
const positions = new Float32Array(COUNT * 3);
const colors = new Float32Array(COUNT * 3);
const sizes = new Float32Array(COUNT);
const bandNormal = new THREE.Vector3(0.3, 1, 0.2).normalize();
const tmp = new THREE.Vector3();
for (let i = 0; i < COUNT; i++) {
  const inBand = rng.chance(0.45);
  for (;;) {
    tmp.set(rng.normal(), rng.normal(), rng.normal()).normalize();
    if (!inBand) break;
    if (Math.abs(tmp.dot(bandNormal)) < Math.abs(rng.normal(0, 0.16))) continue;
    break;
  }
  positions.set([tmp.x * 100, tmp.y * 100, tmp.z * 100], i * 3);
  const u = rng.next();
  const brightness = Math.min(16, 0.22 * (1 - u) ** -0.85 * (inBand ? 0.6 : 1));
  const temp = 2800 + 11000 * rng.next() ** 2;
  const [r, g, b] = blackbodyRGB(temp);
  const k = brightness / Math.max(r, g, b, 1e-6);
  colors.set([r * k, g * k, b * k], i * 3);
  sizes[i] = 1.4 + 1.5 * Math.log2(1 + brightness);
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
const stars = new THREE.Points(
  geometry,
  new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      in vec3 aColor; in float aSize; out vec3 vColor;
      void main() {
        vColor = aColor;
        gl_PointSize = aSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      in vec3 vColor; out vec4 fragColor;
      void main() {
        vec2 d = gl_PointCoord * 2.0 - 1.0;
        float a = exp(-dot(d, d) * 3.2);
        fragColor = vec4(vColor * a, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  }),
);
stars.frustumCulled = false;
h.scene.add(stars);

// ── the bright star that gets the flare
const [sunX, sunY] = pair('sun', [0.42, 0.24]);
const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
const aspect = () => window.innerWidth / Math.max(1, window.innerHeight);
const sunColor = new THREE.Color(1.0, 0.86, 0.66);
const sun = new THREE.Points(
  new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(3), 3),
  ),
  new THREE.PointsMaterial({
    size: 16,
    sizeAttenuation: false,
    color: new THREE.Color(1.0, 0.86, 0.66).multiplyScalar(40),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    map: null,
  }),
);
sun.frustumCulled = false;
h.scene.add(sun);

// ── effects, installed as the engine does
const travel = createTravelEffect();
const flare = createLensFlareEffect();
h.post.setHdrEffects([travel], 'pre-bloom');
h.post.setHdrEffects([flare], 'post-bloom');

const state = {
  travel: Number(params.get('travel') ?? 0),
  dirX: pair('dir', [0, 0])[0],
  dirY: pair('dir', [0, 0])[1],
  flare: params.get('flare') !== '0',
  flareIntensity: Number(params.get('fi') ?? 1),
  anim: params.get('anim') === '1',
};
h.gui.add(state, 'travel', 0, 1, 0.01);
h.gui.add(state, 'dirX', -2, 2, 0.01).name('focus x');
h.gui.add(state, 'dirY', -2, 2, 0.01).name('focus y');
h.gui.add(state, 'flare');
h.gui.add(state, 'flareIntensity', 0, 3, 0.01).name('flare intensity');
h.gui.add(state, 'anim');

const dir = new THREE.Vector3();
const sources = [{ uv: { x: 0.5, y: 0.5 }, color: sunColor, intensity: 1 }];

h.onFrame((f) => {
  const a = aspect();
  if (state.anim) {
    const ph = (f.timeSec % 8) / 8;
    state.travel = ph < 0.5 ? ph * 2 : 2 - ph * 2;
  }
  travel.setIntensity(state.travel);
  // View-space direction whose projection lands on the requested focus (ndc).
  dir.set(state.dirX * tanHalf * a, state.dirY * tanHalf, -1).normalize();
  travel.setDirection(dir);

  // Place the star at the requested ndc, 100 units in front of the camera.
  const sp = sun.geometry.attributes.position as THREE.BufferAttribute;
  sp.setXYZ(0, sunX * tanHalf * a * 100, sunY * tanHalf * 100, -100);
  sp.needsUpdate = true;

  const s = sources[0];
  if (s) {
    s.uv.x = 0.5 + 0.5 * sunX;
    s.uv.y = 0.5 + 0.5 * sunY;
    s.intensity = state.flare ? state.flareIntensity : 0;
  }
  flare.setSources(sources);
});

h.start();
