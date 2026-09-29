# src/state — app state

`store.ts` implements `AppState` (`contracts.ts`) with zustand 5.

```ts
import { useStore, store } from '../state/store';

const level = useStore((s) => s.level);       // React: always select narrowly
store.getState().requestFocus({ kind: 'star', id }); // anywhere else
store.subscribe((s, prev) => { … });
```

- **Data flow**: UI actions → `navRequest` / `timeRequest` (monotonic `seq`) → engine consumes via
  `consumeNavRequest(seq)` / `consumeTimeRequest(seq)`; the engine writes back with
  `setFromEngine(patch)` at ≤ 10 Hz (no-op patches do not notify subscribers).
- **goUp** climbs moon → planet → star → galaxy centred on the star → galactic centre, from
  `navRequest?.target ?? flightTarget ?? focus` (so repeated Esc climbs), and selects the new target.
- **Persistence**: localStorage key `sidereal:v1` (schema), zustand-persist `version` = `GEN_VERSION`.
  Persisted: settings, `ui.onboardingSeen`, ratings/bookmarks/visited of the current seed, and
  `userDataBySeed` (other seeds, max 16). Switching `settings.galaxySeed` stashes/restores user
  data, clears selection/hover and requests a jump to the galactic centre. A different
  `GEN_VERSION` keeps settings but drops user data (ids changed meaning).
- Storage may throw or hold garbage: every access is wrapped and every value is validated
  (`sanitizePersisted`); the store never writes when no persisted field changed.
- Rating/bookmarking/visiting calls `universe.remember(id)` so those objects become searchable.
- `bridge.ts` (lead-owned) holds imperative engine commands (`zoomBy`, `resetView`, `capture`).

Tests: `store.test.ts` (happy-dom) covers every action, persistence, migration and hydration.
