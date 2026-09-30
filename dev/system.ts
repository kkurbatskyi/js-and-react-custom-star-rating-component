/**
 * System furniture — the mock home system (Aurelia) with the orrery's instruments: orbit lines,
 * asteroid belts, habitable zone, ecliptic grid; a star and a dot per body for orientation.
 *
 *   ?hl=home.f            highlight a body (gold orbit; a planet's moon orbits appear)
 *   ?follow=home.d        the camera follows that body (it becomes the focus: orbits make way for it)
 *   ?dist=<km>            with ?follow: initial camera distance from the body (default 40 radii)
 *   ?tilt=<deg>           tilt the ecliptic against the world (default 0)
 *   ?orbits=0 ?belts=0 ?hz=0 ?grid=0 ?dots=0 ?star=0   hide a layer
 *   ?days=<n> ?simRate=<d/s>   the harness clock (default: paused); the GUI adds a day offset
 */
import * as THREE from 'three';
import type { StarSystem } from '../src/core/types';
import { KM_PER_AU } from '../src/core/units';
import { StarVisual } from '../src/render/star/StarVisual';
import { AsteroidBeltVisual, OrbitLines } from '../src/render/system';
import { orbitalPositionKm } from '../src/sim/kepler';
import { moonPositionKm } from '../src/sim/orientation';
import { getUniverse } from '../src/universe';
import { createHarness } from './harness';
import { bodyById } from './planetBodies';

const params = new URLSearchParams(location.search);
const flag = (name: string): boolean => params.get(name) !== '0';

const universe = getUniverse();
const system = universe.getSystem(universe.homeStarId()) as StarSystem;
const R = system.radiusKm;

interface BodyRef {
  id: string;
  radiusKm: number;
  swatch: readonly [number, number, number];
  planetIndex: number;
  moonIndex: number;
}
const bodies: BodyRef[] = [];
system.planets.forEach((p, pi) => {
  bodies.push({
    id: p.id,
    radiusKm: p.radiusKm,
    swatch: p.appearance.swatch,
    planetIndex: pi,
    moonIndex: -1,
  });
  p.moons.forEach((m, mi) =>
    bodies.push({
      id: m.id,
      radiusKm: m.radiusKm,
      swatch: m.appearance.swatch,
      planetIndex: pi,
      moonIndex: mi,
    }),
  );
});

const resolve = (id: string | null): string | null => (id ? (bodyById(id)?.body.id ?? id) : null);
const highlightId = resolve(params.get('hl'));
const followId = resolve(params.get('follow'));

const h = createHarness({
  title: 'System furniture',
  fov: 45,
  near: 1,
  far: R * 60,
  cameraPosition: [0, R * 0.4, R * 0.95],
  target: [0, 0, 0],
  simRate: 0,
  minDistance: 1,
  maxDistance: R * 20,
});

const tilt = THREE.MathUtils.degToRad(Number(params.get('tilt') ?? 0));
const eclipticToWorld = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
const quality = h.quality;

const star = new StarVisual(system.star, quality);
const orbitLines = new OrbitLines(system, quality);
const belts = system.belts.map((b) => new AsteroidBeltVisual(b, quality));
if (flag('star')) h.scene.add(star.object);
if (flag('orbits')) h.scene.add(orbitLines.object);
if (flag('belts')) for (const b of belts) h.scene.add(b.object);

// One dot per body (real bodies are sub-pixel at system scale).
const dotPositions = new Float32Array(bodies.length * 3);
const dotColors = new Float32Array(bodies.length * 3);
bodies.forEach((b, i) => dotColors.set(b.swatch, i * 3));
const dotGeometry = new THREE.BufferGeometry();
dotGeometry.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3));
dotGeometry.setAttribute('color', new THREE.BufferAttribute(dotColors, 3));
const dots = new THREE.Points(
  dotGeometry,
  new THREE.PointsMaterial({
    size: 4,
    sizeAttenuation: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  }),
);
dots.frustumCulled = false;
if (flag('dots')) h.scene.add(dots);

// Real-size spheres, for close-ups (camera-relative, so float32 is fine).
const sphereGeometry = new THREE.SphereGeometry(1, 48, 24);
const spheres = bodies.map((b) => {
  const mesh = new THREE.Mesh(
    sphereGeometry,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(b.swatch[0], b.swatch[1], b.swatch[2]),
    }),
  );
  mesh.scale.setScalar(b.radiusKm);
  mesh.frustumCulled = false;
  h.scene.add(mesh);
  return mesh;
});

const gui = { dayOffset: 0, orbitOpacity: 1, beltOpacity: 1 };
h.gui.add(gui, 'dayOffset', 0, 4000, 1).name('days');
h.gui.add(gui, 'orbitOpacity', 0, 1, 0.01).name('orbit opacity');
h.gui.add(gui, 'beltOpacity', 0, 1, 0.01).name('belt opacity');

const starRel = new THREE.Vector3();
const focusRel = new THREE.Vector3();
const posS = new THREE.Vector3();
const moonS = new THREE.Vector3();
const abs = new THREE.Vector3();
const rel = new THREE.Vector3();
const bodyAbs = new THREE.Vector3();
const prevTarget = new THREE.Vector3();
let followInit = false;

const orbitOptions = {
  starPositionKm: starRel,
  eclipticToWorld,
  opacity: 1,
  simDays: 0,
  highlightId,
  focusPositionKm: null as THREE.Vector3 | null,
};

function bodyPosition(b: BodyRef, days: number, out: THREE.Vector3): THREE.Vector3 {
  const planet = system.planets[b.planetIndex];
  if (!planet) return out.set(0, 0, 0);
  orbitalPositionKm(planet.orbit, days, out);
  if (b.moonIndex >= 0) {
    const moon = planet.moons[b.moonIndex];
    if (moon) out.add(moonPositionKm(moon, planet, days, moonS));
  }
  return out.applyQuaternion(eclipticToWorld);
}

h.onFrame((f) => {
  const days = f.simDays + gui.dayOffset;

  // Follow a body: keep the camera's offset from it while it moves.
  const follow = followId ? bodies.find((b) => b.id === followId) : undefined;
  if (follow) {
    bodyPosition(follow, days, bodyAbs);
    if (!followInit) {
      followInit = true;
      const dist = Number(params.get('dist') ?? follow.radiusKm * 40);
      h.proxy.position
        .copy(bodyAbs)
        .add(new THREE.Vector3(0.35, 0.25, 1).normalize().multiplyScalar(dist));
      h.controls.target.copy(bodyAbs);
      h.controls.minDistance = follow.radiusKm * 1.3;
    } else {
      h.proxy.position.add(bodyAbs).sub(prevTarget);
      h.controls.target.copy(bodyAbs);
    }
    prevTarget.copy(bodyAbs);
    h.cameraWorldPosition.copy(h.proxy.position);
  }

  // Depth range follows the camera, as the system layer's does.
  const camDist = h.cameraWorldPosition.length();
  const nearBody = follow ? h.proxy.position.distanceTo(bodyAbs) - follow.radiusKm : camDist;
  h.camera.near = Math.max(1, 1e-3 * Math.min(camDist, Math.max(nearBody, 1)));
  h.camera.far = camDist + R * 3;
  h.camera.updateProjectionMatrix();

  h.relative(abs.set(0, 0, 0), starRel);
  star.update(f, { positionKm: starRel, intensity: 1 });

  orbitOptions.opacity = gui.orbitOpacity;
  orbitOptions.simDays = days;
  orbitOptions.focusPositionKm = follow ? focusRel.copy(bodyAbs).sub(h.cameraWorldPosition) : null;
  orbitLines.update(f, orbitOptions);
  for (const b of belts) {
    b.update(f, {
      starPositionKm: starRel,
      eclipticToWorld,
      opacity: gui.beltOpacity,
      simDays: days,
    });
  }

  bodies.forEach((b, i) => {
    bodyPosition(b, days, posS);
    h.relative(posS, rel);
    dotPositions.set([rel.x, rel.y, rel.z], i * 3);
    const sphere = spheres[i];
    if (sphere) sphere.position.copy(rel);
  });
  dotGeometry.attributes.position.needsUpdate = true;
});

console.info(
  `system ${system.id}: ${(R / KM_PER_AU).toFixed(1)} AU radius, ${system.planets.length} planets`,
);
h.start();
