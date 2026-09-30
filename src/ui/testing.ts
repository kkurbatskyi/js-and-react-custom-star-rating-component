/** Helpers for the UI tests only (nothing in the app imports this file). */
import { DEFAULT_TIME_SCALE, store } from '../state/store';
import { DEFAULT_GALAXY_SEED, getUniverse } from '../universe';

export const universe = getUniverse(DEFAULT_GALAXY_SEED);
export const homeId = universe.homeStarId();
const home = universe.getSystem(homeId);
if (!home) throw new Error('mock home system missing');
export const homeSystem = home;
export const halcyon = home.planets.find((p) => p.properName === 'Halcyon') ?? home.planets[0]!;
export const lanthorn = halcyon.moons[0]!;

/** Put the store into a known, quiet state before each test. */
export function resetStore(): void {
  store.setState({
    ready: true,
    focus: { kind: 'galaxy', centerLy: [0, 0, 0] },
    selection: null,
    hover: null,
    navRequest: null,
    timeRequest: null,
    flightProgress: null,
    flightTarget: null,
    paused: false,
    timeScale: DEFAULT_TIME_SCALE,
    ratings: {},
    bookmarks: [],
    visited: [],
    toasts: [],
    ui: {
      open: { search: false, help: false, settings: false, logbook: false },
      photoMode: false,
      onboardingSeen: true,
      panelCollapsed: false,
    },
  });
}
