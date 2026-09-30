/** Shared React hooks and the layout context. */
import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { SelectionRef } from '../core/types';
import { engineCommands } from '../state/bridge';
import { useStore } from '../state/store';
import { getUniverse } from '../universe';
import type { Universe } from '../universe/contracts';
import { type ObjectModel, resolveObject } from './lib/model';
import { insetsFromBoxes, readCoverBoxes } from './lib/viewInsets';

/** The universe for the current galaxy seed (memoised by the facade). */
export function useUniverse(): Universe {
  const seed = useStore((s) => s.settings.galaxySeed);
  return useMemo(() => getUniverse(seed), [seed]);
}

/** Resolve a selection to its card model. Stable per (seed, kind, id). */
export function useObject(ref: SelectionRef | null): ObjectModel | null {
  const universe = useUniverse();
  const kind = ref?.kind;
  const id = ref?.id;
  return useMemo(
    () => (kind && id ? resolveObject(universe, { kind, id } as SelectionRef) : null),
    [universe, kind, id],
  );
}

export interface LayoutInfo {
  width: number;
  height: number;
  /** Phone layout (bottom sheet, compact top bar). Matches the `@container sd (max-width: 720px)` rules. */
  compact: boolean;
}

export const COMPACT_MAX_WIDTH = 720;

export const LayoutContext = createContext<LayoutInfo>({
  width: 1280,
  height: 800,
  compact: false,
});
export const useLayout = (): LayoutInfo => useContext(LayoutContext);

/** True on Apple platforms, where the search shortcut is ⌘K rather than Ctrl+K. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export const modKeyLabel = (): string => (isApplePlatform() ? '⌘' : 'Ctrl');

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus handling: move focus in on open, keep Tab inside, give focus back on close.
 * (Escape is handled once, globally, in App — the engine also listens for it.)
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Land on the dialog itself (no focus ring until Tab) unless a control asks for focus.
    (node.querySelector<HTMLElement>('[data-autofocus]') ?? node).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === head || document.activeElement === node)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active]);
  return ref;
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduce(onChange: () => void): () => void {
  try {
    const mq = window.matchMedia(REDUCE_QUERY);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  } catch {
    return () => undefined;
  }
}

const osReducesMotion = (): boolean => {
  try {
    return window.matchMedia(REDUCE_QUERY).matches;
  } catch {
    return false;
  }
};

/** Reduced motion, from the OS setting or the in-app switch (either one wins). */
export function useReducedMotion(): boolean {
  const os = useSyncExternalStore(subscribeReduce, osReducesMotion, () => false);
  const setting = useStore((s) => s.settings.reducedMotion);
  return os || setting;
}

/**
 * Keep the engine informed of the part of the view the UI covers (top bar, desktop plate, phone
 * sheet), so focused objects are framed in the visible remainder. Re-measures after every layout
 * change of those elements (ResizeObserver, coalesced to one call per frame) and whenever `deps`
 * change — they should name whatever can mount, unmount or move the chrome. `ready` is part of the
 * key on purpose: the engine registers its commands just before it reports ready, so the first
 * measurement made at mount time would otherwise be lost.
 */
export function useViewInsets(
  root: RefObject<HTMLElement | null>,
  compact: boolean,
  deps: readonly unknown[],
): void {
  useEffect(() => {
    const layout = root.current?.querySelector<HTMLElement>('.sd-layout');
    if (!layout) return;
    let frame = 0;
    const observed = new Set<Element>();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());

    const measure = () => {
      frame = 0;
      const boxes = readCoverBoxes(layout);
      // Observe whatever is on screen now (elements come and go with selection / photo mode).
      for (const el of [layout, ...layout.querySelectorAll('.sd-topbar, aside.sd-info')]) {
        if (!observed.has(el)) {
          observed.add(el);
          observer?.observe(el);
        }
      }
      engineCommands().setViewInsets(insetsFromBoxes(boxes, compact));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [root, compact, ...deps]);
}
