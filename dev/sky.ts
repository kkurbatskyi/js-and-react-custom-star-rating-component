/**
 * Sky dev page — the atmosphere and cloud shells on a plain lit sphere, under the real PostFX pipeline.
 *
 *   ?body=terran|desert|hothouse|ocean|titan|giant|ice   (default terran = Halcyon)
 *   ?view=far|mid|limb|low|dusk|terminator|crescent|sunrise
 *   ?sun=<az>,<el>  ?cam=<dist>,<az>,<el>  ?real=1  ?parts=atm,cloud,ring  (see dev/skyKit.ts)
 */
import { ringShadowGlsl } from '../src/render/planet/rings';
import { createSkyRig, type ViewPreset } from './skyKit';

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
  sunrise: { cam: [1.075, 0, 89], target: LIMB_TARGET, sun: [90, -21.6], star: true },
  // Half-lit disc, close: the twilight arc along the terminator.
  twilight: { cam: [1.6, 0, 12], sun: [96, 2] },
  // Inside the atmosphere, 0.6% of the radius up, looking at the horizon.
  low: { cam: [1.006, 0, 89], target: [1, 0.99, 0.02], sun: [-60, 40] },
  // Camera 2 km above the ground: the sky and the horizon haze from inside the shell.
  ground: { cam: [1.0003, 0, 89], target: [0.99, 1.139, 0.0175], sun: [-50, 32] },
  sunset: { cam: [1.0003, 0, 89], target: [0.99, 1.139, 0.0175], sun: [90, 0.6], star: true },
  dusk: { cam: [1.006, 0, 89], target: [1, 0.99, 0.02], sun: [88, -6.4], star: true },
};

const rig = await createSkyRig({
  title: 'Sky',
  defaultBody: 'terran',
  defaultView: 'far',
  views: VIEWS,
  ringShadowGlsl,
});
rig.h.start();
