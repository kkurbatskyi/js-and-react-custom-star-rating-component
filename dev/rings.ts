/**
 * Rings dev page — the ringed giant's ring system on a plain lit sphere, under the real PostFX pipeline.
 *
 *   ?view=oblique|front|back|edge|shadow|close|dawn   ?body=giant|ice   ?sun=<az>,<el>   ?real=1
 * Ring plane = world XZ (identity orientation). front: camera and sun on the same side of the plane;
 * back: the sun is behind the ring plane from the camera (the unlit face, forward scattering).
 */
import { ringShadowGlsl } from '../src/render/planet/rings';
import { createSkyRig, type ViewPreset } from './skyKit';

const VIEWS: Readonly<Record<string, ViewPreset>> = {
  oblique: { cam: [4.2, 18, 17], sun: [52, 26] },
  front: { cam: [4.6, 0, 24], sun: [-28, 32] },
  back: { cam: [4.6, 0, 14], sun: [172, -12] },
  edge: { cam: [5.2, 0, 0.6], sun: [40, 14] },
  // Low sun: the planet's long shadow falls across the rings.
  shadow: { cam: [5.2, 25, 38], sun: [128, 7] },
  close: { cam: [2.6, 10, 8], target: [0.6, 0, 0.4], sun: [40, 30] },
  dawn: { cam: [3.2, 0, 62], sun: [80, 4] },
};

const rig = await createSkyRig({
  title: 'Rings',
  defaultBody: 'giant',
  defaultView: 'oblique',
  views: VIEWS,
  ringShadowGlsl,
});
rig.h.start();
