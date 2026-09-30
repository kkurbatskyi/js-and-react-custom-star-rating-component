/**
 * `cloudShadow`: the shadow of the cloud layer on the ground, for the planet's surface shader.
 *
 * The surface shader includes this chunk (after the `common` and `noise` chunks), merges
 * `CloudLayer.shadowUniforms()` into its material's uniforms (the layer updates them in place every frame,
 * so the shadows drift with the clouds) and multiplies its direct sunlight by
 * `cloudShadow(surfacePointBodyKm, sunDirBody)`.
 *
 * The ray from the surface point towards the sun is intersected with the cloud sphere and the coarse cloud
 * field (no fine texture, footprint 0.02 rad) is sampled there: soft shadows that match the clouds above.
 * Include once per shader; the field's uniforms are declared by `cloudFieldGlsl`.
 */
import { cloudFieldGlsl } from './cloudField.glsl';

export const cloudShadowGlsl = /* glsl */ `
${cloudFieldGlsl}
uniform vec4 uCloudShadow;   // cloud sphere radius (km), strength 0..1, max opacity, unused

/** Sunlight transmitted through the clouds to a surface point P (body frame, km); 1 = unshadowed. */
float cloudShadow(vec3 P, vec3 sunDir) {
  float rc = uCloudShadow.x;
  float b = dot(P, sunDir);
  float c = dot(P, P) - rc * rc;
  if (c >= 0.0) return 1.0;                       // above the deck
  vec3 hit = P + sunDir * (-b + sqrt(max(b * b - c, 0.0)));
  vec3 g;
  float m = cloudMask(hit / rc, 0.02, 0.0, g);
  return 1.0 - uCloudShadow.y * uCloudShadow.z * smoothstep(-0.12, 0.12, m);
}
`;
