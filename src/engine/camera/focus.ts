/**
 * Focus targets resolved against the universe: identity, data, per-focus distance limits and the
 * per-frame position (a `GalacticPoint`: star in G + body offset in S — see ./frames.ts).
 *
 * Distance limits (km, camera to focus centre):
 *   galaxy point  0.5 ly … 250 kly
 *   star          1.3 R★ … the system's radius (beyond it the focus hands over to the galaxy)
 *   planet/moon   just above the atmosphere / cloud tops … a few "planet zones"
 * The planet zone is where the view level is `planet` (the body and its local group fill the view).
 */
import { Quaternion, Vector3 } from 'three';
import type {
  BodyBase,
  FocusTarget,
  Moon,
  Planet,
  StarId,
  StarRecord,
  StarSystem,
  Vec3Tuple,
} from '../../core/types';
import { KM_PER_LY } from '../../core/units';
import { orbitalPositionKm } from '../../sim/kepler';
import { moonPositionKm } from '../../sim/orientation';
import type { Universe } from '../../universe/contracts';
import { eclipticToGalactic, type GalacticPoint } from './frames';

export const GALAXY_MIN_DISTANCE_KM = 0.5 * KM_PER_LY;
export const GALAXY_MAX_DISTANCE_KM = 250_000 * KM_PER_LY;
/** Closest approach to a star, in stellar radii. */
export const STAR_MIN_RADII = 1.3;

const _moonOffset = new Vector3();

export class FocusHandle implements GalacticPoint {
  readonly kind: FocusTarget['kind'];
  readonly starId: StarId | null;
  readonly star: StarRecord | null;
  readonly system: StarSystem | null;
  readonly planet: Planet | null;
  readonly moon: Moon | null;
  /** The focused planet or moon (null for stars and galaxy points). */
  readonly body: BodyBase | null;
  /** Physical radius of the focused object, km (0 for galaxy points). */
  readonly radiusKm: number;
  readonly minDistanceKm: number;
  readonly maxDistanceKm: number;
  /** Radius of the planet-level zone (0 unless a planet or moon). */
  readonly planetZoneKm: number;
  /** Visible radius of the galaxy disk, km (framing of galaxy points; 0 when unknown). */
  readonly galaxyRadiusKm: number;
  readonly starLy = new Vector3();
  readonly frame = new Quaternion();
  readonly posS = new Vector3();
  /** The owning star itself as a point (offset zero) — for "distance to the system" queries. */
  readonly starPoint: GalacticPoint;
  private cachedTarget: FocusTarget;
  private targetDirty = false;

  constructor(
    target: FocusTarget,
    parts: {
      star: StarRecord | null;
      system: StarSystem | null;
      planet: Planet | null;
      moon: Moon | null;
      galaxyRadiusLy?: number;
    },
  ) {
    this.cachedTarget = target;
    this.starPoint = {
      starId: parts.star?.id ?? null,
      starLy: this.starLy,
      frame: this.frame,
      posS: new Vector3(),
    };
    this.kind = target.kind;
    this.galaxyRadiusKm = (parts.galaxyRadiusLy ?? 0) * KM_PER_LY;
    this.star = parts.star;
    this.system = parts.system;
    this.planet = parts.planet;
    this.moon = parts.moon;
    this.body = parts.moon ?? parts.planet;
    this.starId = parts.star?.id ?? null;
    if (target.kind === 'galaxy') {
      this.starLy.set(target.centerLy[0], target.centerLy[1], target.centerLy[2]);
    } else if (parts.star) {
      const p = parts.star.posLy;
      this.starLy.set(p[0], p[1], p[2]);
    }
    if (parts.system) eclipticToGalactic(parts.system.eclipticToGalactic, this.frame);

    const system = parts.system;
    if (this.body && system) {
      const body = this.body;
      const r = body.radiusKm;
      this.radiusKm = r;
      // Just above the cloud tops / upper atmosphere.
      const atmosphere = body.atmosphere
        ? Math.min(0.05 * r, 3 * body.atmosphere.scaleHeightKm)
        : 0;
      this.minDistanceKm = r * 1.02 + atmosphere;
      const ringKm = body.rings?.outerRadiusKm ?? 0;
      if (parts.moon) {
        const a = parts.moon.orbit.semiMajorAxisKm;
        this.planetZoneKm = Math.max(30 * r, 0.6 * a, 1.5 * ringKm);
        this.maxDistanceKm = Math.max(2 * this.planetZoneKm, 1.2 * a);
      } else {
        const planet = parts.planet as Planet;
        let outerMoon = 0;
        for (const m of planet.moons) outerMoon = Math.max(outerMoon, m.orbit.semiMajorAxisKm);
        this.planetZoneKm = Math.max(30 * r, 1.3 * outerMoon, 2 * ringKm);
        this.maxDistanceKm = Math.min(
          system.radiusKm,
          Math.max(4 * this.planetZoneKm, 0.25 * planet.orbit.semiMajorAxisKm),
        );
      }
    } else if (system && parts.star) {
      this.radiusKm = system.star.radiusKm;
      this.planetZoneKm = 0;
      this.minDistanceKm = STAR_MIN_RADII * this.radiusKm;
      this.maxDistanceKm = system.radiusKm;
    } else {
      this.radiusKm = 0;
      this.planetZoneKm = 0;
      this.minDistanceKm = GALAXY_MIN_DISTANCE_KM;
      this.maxDistanceKm = GALAXY_MAX_DISTANCE_KM;
    }
  }

  /** The identity as a store-friendly FocusTarget (a new object only after a galaxy pan). */
  get target(): FocusTarget {
    if (this.targetDirty) {
      this.targetDirty = false;
      this.cachedTarget = {
        kind: 'galaxy',
        centerLy: [this.starLy.x, this.starLy.y, this.starLy.z],
      };
    }
    return this.cachedTarget;
  }

  /** Recompute the body position in S for `simDays` (stars and galaxy points do not move). */
  update(simDays: number): void {
    const planet = this.planet;
    if (!planet) return;
    orbitalPositionKm(planet.orbit, simDays, this.posS);
    if (this.moon) this.posS.add(moonPositionKm(this.moon, planet, simDays, _moonOffset));
  }

  /** Move a free galaxy point (panning / zoom-to-cursor). No-op for other kinds. */
  setGalaxyCenter(x: number, y: number, z: number): void {
    if (this.kind !== 'galaxy') return;
    this.starLy.set(x, y, z);
    this.targetDirty = true;
  }

  is(target: FocusTarget): boolean {
    if (target.kind !== this.kind) return false;
    if (target.kind === 'galaxy') {
      const c = target.centerLy;
      return c[0] === this.starLy.x && c[1] === this.starLy.y && c[2] === this.starLy.z;
    }
    const own = this.cachedTarget;
    return own.kind !== 'galaxy' && own.id === target.id;
  }
}

/** Resolve a focus target, or null when the id does not exist in this universe. */
export function resolveFocus(universe: Universe, target: FocusTarget): FocusHandle | null {
  switch (target.kind) {
    case 'galaxy': {
      const c = target.centerLy;
      if (!c.every(Number.isFinite)) return null;
      return new FocusHandle(target, {
        star: null,
        system: null,
        planet: null,
        moon: null,
        galaxyRadiusLy: universe.galaxy.params.radiusLy,
      });
    }
    case 'star': {
      const star = universe.getRecord(target.id);
      const system = star ? universe.getSystem(target.id) : null;
      if (!star || !system) return null;
      return new FocusHandle(target, { star, system, planet: null, moon: null });
    }
    case 'planet':
    case 'moon': {
      const found = universe.getBody(target.id);
      if (!found) return null;
      if ((target.kind === 'moon') !== (found.moon !== null)) return null;
      const star = universe.getRecord(found.system.id);
      if (!star) return null;
      return new FocusHandle(target, {
        star,
        system: found.system,
        planet: found.planet,
        moon: found.moon,
      });
    }
  }
}

/** One level up: moon → planet → star → a galaxy point at the star (null above that). */
export function parentTarget(h: FocusHandle): FocusTarget | null {
  if (h.moon && h.planet) return { kind: 'planet', id: h.planet.id };
  if (h.planet && h.starId) return { kind: 'star', id: h.starId };
  if (h.kind === 'star') {
    const c: Vec3Tuple = [h.starLy.x, h.starLy.y, h.starLy.z];
    return { kind: 'galaxy', centerLy: c };
  }
  return null;
}

/** True for the galactic centre focus (the "overview"). */
export function isGalacticCentre(h: FocusHandle): boolean {
  return h.kind === 'galaxy' && h.starLy.lengthSq() === 0;
}
