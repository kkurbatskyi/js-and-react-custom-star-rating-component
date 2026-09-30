/**
 * SkyFrame — camera and sun of one body expressed in its body-fixed frame (Y = spin axis).
 *
 * The atmosphere, cloud and ring shaders work in body space: the CPU rotates the camera position and
 * the sun direction into it in float64, so the fragment shaders need no model matrix and keep full
 * precision at any camera distance. Scratch objects only: no per-frame allocation.
 */
import { Quaternion, Vector3, Vector4 } from 'three';
import type { PlanetUniforms } from '../../contracts';

export const MAX_OCCLUDERS = 4;

export class SkyFrame {
  /** World -> body rotation. */
  readonly worldToBody = new Quaternion();
  /** Camera position relative to the body centre, body frame (km). */
  readonly camPos = new Vector3();
  /** Unit vector towards the star, body frame. */
  readonly sunDir = new Vector3(1, 0, 0);

  /** Eclipse casters that can shadow this body or its rings: xyz = centre relative to the body (body frame, km), w = radius. */
  readonly occluders: Vector4[] = Array.from({ length: MAX_OCCLUDERS }, () => new Vector4());
  occluderCount = 0;

  private readonly rel = new Vector3();
  private readonly onAxis = new Vector3();

  /** `reachKm`: how far from the body's centre a shadow can matter (planet radius, or the ring's outer radius). */
  update(u: PlanetUniforms, reachKm = 0): void {
    this.worldToBody.copy(u.orientation).invert();
    this.camPos.copy(u.positionKm).negate().applyQuaternion(this.worldToBody);
    this.sunDir.copy(u.sunDirection).applyQuaternion(this.worldToBody).normalize();

    // Keep casters on the sunward side whose (penumbral) shadow cylinder passes within reach + r of the centre.
    this.occluderCount = 0;
    const list = u.occluders;
    if (!list) return;
    const sigma = u.sunAngularRadiusRad;
    for (const occ of list) {
      if (this.occluderCount >= MAX_OCCLUDERS) break;
      this.rel.copy(occ.positionKm).sub(u.positionKm); // float64 difference, then rotated
      const along = this.rel.dot(u.sunDirection);
      if (along <= 0) continue;
      this.onAxis.copy(u.sunDirection).multiplyScalar(along);
      const perp = this.rel.distanceTo(this.onAxis);
      if (perp > reachKm + occ.radiusKm + 2.5 * along * sigma + 1) continue;
      this.rel.applyQuaternion(this.worldToBody);
      this.occluders[this.occluderCount++]?.set(this.rel.x, this.rel.y, this.rel.z, occ.radiusKm);
    }
  }
}

/**
 * Sphere space of an oblate body: the map (x, y, z) -> (x, y / (1 - f), z) turns the spheroid into a
 * sphere of the equatorial radius, keeps rays straight and keeps the terminator where the surface
 * shader puts it (n . L is invariant under the map). Writes into `out`.
 */
export function toSphereSpace(v: Vector3, oblate: number, out: Vector3): Vector3 {
  return out.set(v.x, v.y / oblate, v.z);
}
