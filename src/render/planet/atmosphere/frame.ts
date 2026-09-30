/**
 * SkyFrame — camera and sun of one body expressed in its body-fixed frame (Y = spin axis).
 *
 * The atmosphere, cloud and ring shaders work in body space: the CPU rotates the camera position and
 * the sun direction into it in float64, so the fragment shaders need no model matrix and keep full
 * precision at any camera distance. Scratch objects only: no per-frame allocation.
 */
import { Quaternion, Vector3 } from 'three';
import type { PlanetUniforms } from '../../contracts';

export class SkyFrame {
  /** World -> body rotation. */
  readonly worldToBody = new Quaternion();
  /** Camera position relative to the body centre, body frame (km). */
  readonly camPos = new Vector3();
  /** Unit vector towards the star, body frame. */
  readonly sunDir = new Vector3(1, 0, 0);

  update(u: PlanetUniforms): void {
    this.worldToBody.copy(u.orientation).invert();
    this.camPos.copy(u.positionKm).negate().applyQuaternion(this.worldToBody);
    this.sunDir.copy(u.sunDirection).applyQuaternion(this.worldToBody).normalize();
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
