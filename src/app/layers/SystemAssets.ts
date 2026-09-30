/**
 * SystemAssets — everything visual about one planetary system, shared by the system and planet
 * layers: the StarVisual, a 'lite' PlanetVisual for every planet and moon, orbit lines and belts,
 * plus per-frame body state (positions in S, orientations, lighting) computed ONCE per sim time.
 *
 * A body's lite visual is drawn by whichever layer owns it this frame: the planet layer claims the
 * focus's local group (planet + moons), the system layer everything else. Handing a visual from one
 * layer's scene to the other is invisible — same object, same pixels — so there is no pop when the
 * view level changes.
 *
 * SystemAssetCache keeps the last few systems (flight endpoints) and disposes the rest.
 */
import { Color, Quaternion, Vector3 } from 'three';
import { rgbToCss, saturateRGB } from '../../core/color';
import type { BodyBase, Moon, Planet, StarSystem } from '../../core/types';
import { KM_PER_AU } from '../../core/units';
import { eclipticToGalactic } from '../../engine/camera/frames';
import type {
  IAsteroidBeltVisual,
  IOrbitLines,
  IPlanetVisual,
  IStarVisual,
  Quality,
} from '../../render/contracts';
import { PlanetVisual } from '../../render/planet/PlanetVisual';
import { StarVisual } from '../../render/star/StarVisual';
import { AsteroidBeltVisual } from '../../render/system/AsteroidBeltVisual';
import { OrbitLines } from '../../render/system/OrbitLines';
import { orbitalPositionKm } from '../../sim/kepler';
import { bodyOrientation, moonOrientation, moonPositionKm } from '../../sim/orientation';

/** Blackbody chroma boost used for star light everywhere (ARCHITECTURE §9). */
const SUN_SATURATION = 1.25;

export type BodyOwner = 'system' | 'planet' | null;

export class BodyState {
  readonly body: BodyBase;
  readonly planet: Planet;
  readonly moon: Moon | null;
  readonly lite: IPlanetVisual;
  /** Position in frame S (km, relative to the star) at the assets' sim time. */
  readonly posS = new Vector3();
  /** Body-fixed → galactic axes. */
  readonly orientation = new Quaternion();
  /** Unit vector towards the star, galactic axes. */
  readonly sunDirection = new Vector3();
  sunIntensity = 1;
  sunAngularRadiusRad = 0;
  /** Largest visual extent from the centre (rings, atmosphere), km. */
  readonly extentKm: number;
  /** CSS colour of the body's swatch (label markers). */
  readonly swatchCss: string;
  // ── written by the owning layer each frame
  readonly rel = new Vector3();
  screenX = 0;
  screenY = 0;
  radiusPx = 0;
  onScreen = false;
  owner: BodyOwner = null;

  constructor(body: BodyBase, planet: Planet, moon: Moon | null, lite: IPlanetVisual) {
    this.body = body;
    this.planet = planet;
    this.moon = moon;
    this.lite = lite;
    const ring = body.rings?.outerRadiusKm ?? 0;
    this.extentKm = Math.max(body.radiusKm * 1.1, ring);
    this.swatchCss = rgbToCss(body.appearance.swatch);
  }

  get id(): string {
    return this.body.id;
  }
}

const _q = new Quaternion();
const _moon = new Vector3();

export class SystemAssets {
  readonly system: StarSystem;
  /** Rotation S → G. */
  readonly frame = new Quaternion();
  readonly star: IStarVisual;
  readonly orbitLines: IOrbitLines;
  readonly belts: IAsteroidBeltVisual[];
  /** Planets in orbital order, each followed by its moons. */
  readonly bodies: BodyState[] = [];
  /** Linear star colour for lighting. */
  readonly sunColor = new Color();
  private readonly index = new Map<string, number>();
  private simDays = Number.NaN;

  constructor(system: StarSystem, quality: Quality) {
    this.system = system;
    eclipticToGalactic(system.eclipticToGalactic, this.frame);
    const c = saturateRGB(system.star.colorRGB, SUN_SATURATION);
    const k = 1 / Math.max(c[0], c[1], c[2], 1e-6);
    this.sunColor.setRGB(c[0] * k, c[1] * k, c[2] * k);
    this.star = new StarVisual(system.star, quality);
    this.orbitLines = new OrbitLines(system, quality);
    this.belts = system.belts.map((b) => new AsteroidBeltVisual(b, quality));
    for (const planet of system.planets) {
      this.add(planet, planet, null, quality);
      for (const moon of planet.moons) this.add(moon, planet, moon, quality);
    }
  }

  private add(body: BodyBase, planet: Planet, moon: Moon | null, quality: Quality): void {
    const lite = new PlanetVisual(body, { system: this.system }, quality, 'lite');
    this.index.set(body.id, this.bodies.length);
    this.bodies.push(new BodyState(body, planet, moon, lite));
  }

  /** Index into `bodies`, or −1. */
  indexOf(id: string): number {
    return this.index.get(id) ?? -1;
  }

  /** [start, end) of a planet's family (the planet and its moons) in `bodies`. */
  familyRange(
    planetId: string,
    out: { start: number; end: number },
  ): { start: number; end: number } {
    const start = this.indexOf(planetId);
    out.start = start;
    out.end = start;
    if (start < 0) return out;
    const n = 1 + this.bodies[start].planet.moons.length;
    out.end = start + n;
    return out;
  }

  /** Positions, orientations and lighting of every body at `simDays` (cached per value). */
  update(simDays: number): void {
    if (simDays === this.simDays) return;
    this.simDays = simDays;
    const lum = this.system.star.luminositySolar;
    const starRadius = this.system.star.radiusKm;
    let planetPos: Vector3 | null = null;
    for (const b of this.bodies) {
      if (b.moon) {
        moonPositionKm(b.moon, b.planet, simDays, _moon);
        b.posS.copy(planetPos as Vector3).add(_moon);
        moonOrientation(b.moon, b.planet, simDays, _q);
      } else {
        orbitalPositionKm(b.planet.orbit, simDays, b.posS);
        planetPos = b.posS;
        bodyOrientation(b.planet, simDays, _q);
      }
      b.orientation.copy(_q).premultiply(this.frame);
      const d = b.posS.length();
      b.sunDirection
        .copy(b.posS)
        .negate()
        .divideScalar(Math.max(d, 1e-9))
        .applyQuaternion(this.frame);
      const au = d / KM_PER_AU;
      // Artistic irradiance: (L/d²)^0.2, clamped so every world stays readable (1 ≈ Earth).
      b.sunIntensity = Math.min(2, Math.max(0.4, (lum / Math.max(au * au, 1e-6)) ** 0.2));
      b.sunAngularRadiusRad = Math.atan(starRadius / Math.max(d, starRadius));
    }
  }

  setQuality(q: Quality): void {
    this.star.setQuality?.(q);
    this.orbitLines.setQuality?.(q);
    for (const b of this.belts) b.setQuality?.(q);
    for (const b of this.bodies) b.lite.setQuality?.(q);
  }

  dispose(): void {
    const all = [this.star, this.orbitLines, ...this.belts, ...this.bodies.map((b) => b.lite)];
    for (const v of all) {
      v.object.removeFromParent();
      v.dispose();
    }
  }
}

/** The last few systems' assets (flight endpoints), least-recently-used disposed first. */
export class SystemAssetCache {
  private readonly entries = new Map<string, SystemAssets>();
  private last: SystemAssets | null = null;
  private quality: Quality;
  private readonly capacity: number;

  constructor(quality: Quality, capacity = 3) {
    this.quality = quality;
    this.capacity = capacity;
  }

  get(system: StarSystem): SystemAssets {
    if (this.last?.system.id === system.id) return this.last; // steady state: no LRU churn
    let assets = this.entries.get(system.id);
    if (assets) {
      this.last = assets;
      this.entries.delete(system.id); // re-insert: most recent last
      this.entries.set(system.id, assets);
      return assets;
    }
    assets = new SystemAssets(system, this.quality);
    this.entries.set(system.id, assets);
    this.last = assets;
    while (this.entries.size > this.capacity) {
      const [oldestId, oldest] = this.entries.entries().next().value as [string, SystemAssets];
      this.entries.delete(oldestId);
      if (this.last === oldest) this.last = null;
      oldest.dispose();
    }
    return assets;
  }

  peek(systemId: string): SystemAssets | null {
    return this.entries.get(systemId) ?? null;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    for (const a of this.entries.values()) a.setQuality(q);
  }

  clear(): void {
    for (const a of this.entries.values()) a.dispose();
    this.entries.clear();
    this.last = null;
  }
}
