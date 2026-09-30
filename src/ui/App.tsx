/**
 * Sidereal's interface: an ink-glass instrument overlay framing the 3D view.
 *
 * All data comes through `useStore` and the Universe facade; camera actions go through the engine
 * bridge. The overlay is `pointer-events: none` (main.tsx) and each interactive surface opts back in,
 * so the canvas keeps every gesture it does not need to give up.
 */
import './fonts';
import './theme.css';
import './layout.css';
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { starIdOf } from '../universe';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  COMPACT_MAX_WIDTH,
  LayoutContext,
  type LayoutInfo,
  useReducedMotion,
  useViewInsets,
} from './hooks';
import { Coordinates } from './hud/Coordinates';
import { FpsMeter } from './hud/FpsMeter';
import { HoverTooltip } from './hud/HoverTooltip';
import { Minimap } from './hud/Minimap';
import { ScaleBar } from './hud/ScaleBar';
import { TimeControls } from './hud/TimeControls';
import { Toasts } from './hud/Toasts';
import { ViewControls } from './hud/ViewControls';
import { selectionForTarget } from './lib/model';
import { sheetStateOf, useSheetStore } from './lib/sheetStore';
import { installShortcuts } from './lib/shortcuts';
import { HelpOverlay } from './panels/HelpOverlay';
import { InfoPanel } from './panels/InfoPanel';
import { LoadingScreen } from './panels/LoadingScreen';
import { Logbook } from './panels/Logbook';
import { Onboarding } from './panels/Onboarding';
import { PhotoMode } from './panels/PhotoMode';
import { SearchPalette } from './panels/SearchPalette';
import { SettingsPanel } from './panels/SettingsPanel';
import { TopBar } from './panels/TopBar';

/** Track the overlay's own box: responsive rules follow it, not the window (see theme.css). */
function useLayoutInfo(ref: RefObject<HTMLElement | null>): LayoutInfo {
  const [size, setSize] = useState({ width: 1280, height: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return; // not laid out (hidden, or no layout engine): keep the last size
      setSize((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height },
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return useMemo(() => ({ ...size, compact: size.width <= COMPACT_MAX_WIDTH }), [size]);
}

/** Mark the focus star as visited once the camera has actually arrived (idempotent with the engine). */
function useVisitTracking(): void {
  const focus = useStore((s) => s.focus);
  const flying = useStore((s) => s.flightProgress !== null);
  const markVisited = useStore((s) => s.markVisited);
  useEffect(() => {
    if (flying || focus.kind === 'galaxy') return;
    const starId = starIdOf(focus.id);
    if (starId && useStore.getState().visited[0]?.id !== starId) markVisited(starId);
  }, [focus, flying, markVisited]);
}

export function App() {
  const root = useRef<HTMLDivElement>(null);
  const layout = useLayoutInfo(root);
  const photoMode = useStore((s) => s.ui.photoMode);
  const reducedMotion = useReducedMotion();
  const ready = useStore((s) => s.ready);
  const lowFx = useStore((s) => s.settings.quality === 'low');
  const showFps = useStore((s) => s.settings.showFps);
  const modalOpen = useStore(
    (s) => s.ui.open.search || s.ui.open.logbook || s.ui.open.settings || s.ui.open.help,
  );
  const collapsed = useStore((s) => s.ui.panelCollapsed);
  const selection = useStore((s) => s.selection);
  const focus = useStore((s) => s.focus);
  const flightTarget = useStore((s) => s.flightTarget);
  const full = useSheetStore((s) => s.full);

  useEffect(() => installShortcuts(), []);
  useVisitTracking();

  // Hide the engine's DOM labels (and anything else keyed on it) while photographing.
  useEffect(() => {
    const html = document.documentElement;
    if (photoMode) html.dataset.sdPhoto = 'on';
    else delete html.dataset.sdPhoto;
    return () => {
      delete html.dataset.sdPhoto;
    };
  }, [photoMode]);

  const hasSubject = !!(selection ?? selectionForTarget(flightTarget ?? focus));
  const sheet = layout.compact && hasSubject ? sheetStateOf(collapsed, full) : 'none';
  const panel = !layout.compact && !collapsed ? 'open' : 'closed';
  // What can mount, unmount or move the chrome that covers the view.
  useViewInsets(root, layout.compact, [ready, photoMode, collapsed, hasSubject, sheet]);

  return (
    <LayoutContext.Provider value={layout}>
      <div
        ref={root}
        className="sd-root"
        data-motion={reducedMotion ? 'reduce' : undefined}
        data-fx={lowFx ? 'low' : undefined}
      >
        <div className="sd-layout" data-panel={panel} data-sheet={sheet}>
          {photoMode ? (
            <ErrorBoundary name="photo mode">
              <PhotoMode />
            </ErrorBoundary>
          ) : (
            <div className="sd-main" inert={modalOpen || !ready}>
              <TopBar />
              <div className="sd-slot sd-slot--coords">
                <Coordinates />
              </div>
              <div className="sd-slot sd-slot--view">
                <ViewControls />
              </div>
              <div className="sd-slot sd-slot--map">
                <Minimap />
              </div>
              <div className="sd-slot sd-slot--scale">
                <ScaleBar />
              </div>
              <div className="sd-slot sd-slot--time">
                <TimeControls />
              </div>
              {showFps && (
                <div className="sd-slot sd-slot--fps">
                  <FpsMeter />
                </div>
              )}
              <ErrorBoundary name="details panel">
                <InfoPanel />
              </ErrorBoundary>
              <Onboarding />
            </div>
          )}
          {!photoMode && <HoverTooltip />}
          <Toasts />
          <ErrorBoundary name="dialog">
            <SearchPalette />
            <Logbook />
            <SettingsPanel />
            <HelpOverlay />
          </ErrorBoundary>
          <LoadingScreen />
        </div>
      </div>
    </LayoutContext.Provider>
  );
}
