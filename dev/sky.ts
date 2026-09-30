/**
 * Sky dev page — the atmosphere and cloud shells on a plain lit sphere, under the real PostFX pipeline.
 *
 *   ?body=terran|desert|hothouse|ocean|titan|giant|ice   (default terran = Halcyon)
 *   ?view=far|mid|limb|low|dusk|terminator|crescent|sunrise
 *   ?sun=<az>,<el>  ?cam=<dist>,<az>,<el>  ?real=1  ?parts=atm,cloud,ring  (see dev/skyKit.ts)
 */
import { type ViewPreset, createSkyRig } from './skyKit';

const NO_RING_SHADOW = 'float ringShadow(vec3 P, vec3 sunDir, vec4 ring) { return 1.0; }';

/** Camera on the polar axis looking along +X: local up = world +Y, the limb curves across the frame. */
const LIMB_TARGET = [0.96, 0.795, 0.02] as const;

const VIEWS: Readonly<Record<string, ViewPreset>> = {
  far: { cam: [7, 0, 15], sun: [40, 20] },
  mid: { cam: [3.2, 0, 12], sun: [38, 16] },
  terminator: { cam: [3.2, 0, 10], sun: [100, 5] },
  crescent: { cam: [3.6, 0, 14], sun: [150, 8] },
  // ISS-like: ~7% above the surface, looking at the limb, sun behind the camera.
  limb: { cam: [1.075, 0, 89], target: LIMB_TARGET, sun: [-70, 32] },
  // Sunset on the limb: the sun just below the horizon ahead.
  sunrise: { cam: [1.075, 0, 89], target: LIMB_TARGET, sun: [88, -2], star: true },
  // Inside the atmosphere, 0.6% of the radius up, looking at the horizon.
  low: { cam: [1.006, 0, 89], target: [1, 0.99, 0.02], sun: [-60, 40] },
  dusk: { cam: [1.006, 0, 89], target: [1, 0.99, 0.02], sun: [80, 1.5], star: true },
};

const rig = await createSkyRig({
  title: 'Sky',
  defaultBody: 'terran',
  defaultView: 'far',
  views: VIEWS,
  ringShadowGlsl: NO_RING_SHADOW,
});
rig.h.start();
