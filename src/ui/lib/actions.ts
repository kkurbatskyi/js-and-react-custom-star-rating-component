/**
 * UI → app actions built on the store: every "go there" in the interface funnels through these so
 * selection, flight and toasts stay consistent.
 */
import type { FocusTarget, SelectionRef, Vec3Tuple } from '../../core/types';
import { store } from '../../state/store';
import { getUniverse } from '../../universe';
import type { RandomStarKind } from '../../universe/contracts';
import { planetTypeLabel, targetForSelection } from './model';

const currentUniverse = () => getUniverse(store.getState().settings.galaxySeed);

export const GALACTIC_CENTRE: Vec3Tuple = [0, 0, 0];

/** Select an object and fly the camera to it. */
export function flyTo(ref: SelectionRef, mode: 'fly' | 'jump' = 'fly'): void {
  const s = store.getState();
  s.select(ref);
  s.requestFocus(targetForSelection(ref), mode);
}

/** Fly to a free point of the galaxy (minimap clicks, overview) and clear the selection. */
export function flyToPoint(centerLy: Vec3Tuple): void {
  const s = store.getState();
  s.select(null);
  s.requestFocus({ kind: 'galaxy', centerLy });
}

export function flyHome(): void {
  flyTo({ kind: 'star', id: currentUniverse().homeStarId() });
}

export function flyToCore(): void {
  flyTo({ kind: 'star', id: currentUniverse().coreStarId() });
}

export function galaxyOverview(): void {
  flyToPoint(GALACTIC_CENTRE);
}

export function focusIs(focus: FocusTarget | null, ref: SelectionRef | null): boolean {
  return (
    !!focus && !!ref && focus.kind !== 'galaxy' && focus.kind === ref.kind && focus.id === ref.id
  );
}

export type SurpriseKind = Extract<RandomStarKind, 'habitable' | 'ringed' | 'exotic'>;

const SURPRISE_COPY: Readonly<Record<SurpriseKind, string>> = {
  habitable: 'A habitable world',
  ringed: 'A ringed giant',
  exotic: 'Something exotic',
};

/** "Surprise me": pick a deterministic-per-roll star of the requested flavour and go there. */
export function surpriseMe(
  kind: SurpriseKind,
  roll: number = Math.floor(Math.random() * 2 ** 31),
): SelectionRef {
  const universe = currentUniverse();
  const starId = universe.randomStarId(kind, roll);
  const system = universe.getSystem(starId);
  let ref: SelectionRef = { kind: 'star', id: starId };
  if (system && kind === 'habitable') {
    const best = [...system.planets].sort((a, b) => b.habitability - a.habitability)[0];
    if (best) ref = { kind: 'planet', id: best.id };
  } else if (system && kind === 'ringed') {
    const ringed = system.planets.find((p) => p.rings);
    if (ringed) ref = { kind: 'planet', id: ringed.id };
  }
  flyTo(ref);
  const body = ref.kind === 'planet' ? universe.getBody(ref.id) : null;
  const name = body ? body.planet.name : (universe.getRecord(starId)?.name ?? starId);
  const detail = body
    ? `${planetTypeLabel(body.planet.type)} · ${body.system.star.name}`
    : `${universe.getRecord(starId)?.spectralType ?? 'Star'}`;
  store.getState().pushToast({
    text: `Setting course for ${name}`,
    sub: `${SURPRISE_COPY[kind]} · ${detail}`,
    tone: 'info',
  });
  return ref;
}

/** Where a breadcrumb takes you. */
export function goToTarget(target: FocusTarget): void {
  if (target.kind === 'galaxy') flyToPoint(target.centerLy);
  else flyTo({ kind: target.kind, id: target.id });
}
