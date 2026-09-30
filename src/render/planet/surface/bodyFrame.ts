/**
 * BodyFrame — the per-frame lighting state of one body, expressed in its own body-fixed frame.
 *
 * The engine hands a visual camera-relative positions in layer world axes. Surface shaders work in the
 * body frame instead (Y = spin axis, +X = prime meridian): the sun direction, the camera position and the
 * eclipse casters are rotated into it on the CPU in float64, so the fragment shader needs no model matrix
 * and keeps full precision at any camera distance. Scratch objects only: no per-frame allocation.
 */
import { Quaternion, Vector3, Vector4 } from 'three';
import type { BodyBase } from '../../../core/types';
import type { PlanetUniforms } from '../../contracts';

export const MAX_OCCLUDERS = 4;

export class BodyFrame {
  /** World -> body rotation. */
  readonly worldToBody = new Quaternion();
  /** Unit vector towards the star, body frame. */
  readonly sunDir = new Vector3(1, 0, 0);
  /** Camera position relative to the body centre, body frame (km). */
  readonly camPos = new Vector3();
  /** Eclipse casters: xyz = centre relative to this body (body frame, km), w = radius (km). */
  readonly occluders: Vector4[] = Array.from({ length: MAX_OCCLUDERS }, () => new Vector4());
  occluderCount = 0;

  private readonly rel = new Vector3();
  private readonly sunWorld = new Vector3();

  update(body: Pick<BodyBase, 'radiusKm'>, u: PlanetUniforms): void {
    this.worldToBody.copy(u.orientation).invert();
    this.sunDir.copy(u.sunDirection).applyQuaternion(this.worldToBody);
    this.camPos.copy(u.positionKm).negate().applyQuaternion(this.worldToBody);

    // Keep only casters whose shadow can reach the body: sun-side, and their (penumbral) shadow
    // cylinder passes within R + r of the centre.
    this.occluderCount = 0;
    const list = u.occluders;
    if (!list) return;
    const sigma = u.sunAngularRadiusRad;
    for (const occ of list) {
      if (this.occluderCount >= MAX_OCCLUDERS) break;
      this.rel.copy(occ.positionKm).sub(u.positionKm); // float64 difference, then rotated
      const along = this.rel.dot(u.sunDirection);
      if (along <= 0) continue;
      this.sunWorld.copy(u.sunDirection).multiplyScalar(along);
      const perp = this.rel.distanceTo(this.sunWorld);
      if (perp > body.radiusKm + occ.radiusKm + 2.5 * along * sigma + 1) continue;
      this.rel.applyQuaternion(this.worldToBody);
      this.occluders[this.occluderCount++]?.set(this.rel.x, this.rel.y, this.rel.z, occ.radiusKm);
    }
  }
}
