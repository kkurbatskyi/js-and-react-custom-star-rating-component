/**
 * The object panel. Desktop: an ink-glass plate on the right that collapses to a tab. Phone: a bottom
 * sheet with three snap heights (peek → half → full) you can drag, tap or arrow through.
 *
 * What it shows: the selection, else where the camera is (or is heading) — so a deep link or a search
 * result opens its card, and while flying the card already describes the destination.
 */
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { useLayout, useObject } from '../hooks';
import { flyHome } from '../lib/actions';
import { objectName, selectionForTarget, surveyRatingOf } from '../lib/model';
import { type SheetState, sheetStateOf, useSheetStore } from '../lib/sheetStore';
import { GalaxyCard } from './GalaxyCard';
import { ActionRow, BodyBody, ObjectHeader, PeekRow, RatingPlate, StarBody } from './ObjectCards';
import './info.css';

const PEEK_PX = 176;
const FULL_MARGIN_PX = 76;
const HALF_RATIO = 0.56;

function Uncharted({ id }: { id: string }) {
  return (
    <div className="sd-info__scroll">
      <p className="sd-eyebrow">Uncharted</p>
      <p className="sd-blurb">
        The catalogue has no record of <span className="sd-mono">{id}</span>. It is a large catalogue, and
        occasionally wrong.
      </p>
      <button type="button" className="sd-btn sd-btn--primary" onClick={flyHome}>
        <Icon name="home" size={15} />
        Fly home
      </button>
    </div>
  );
}

export function InfoPanel() {
  const selection = useStore((s) => s.selection);
  const focus = useStore((s) => s.focus);
  const flightTarget = useStore((s) => s.flightTarget);
  const collapsed = useStore((s) => s.ui.panelCollapsed);
  const setCollapsed = useStore((s) => s.setPanelCollapsed);
  const full = useSheetStore((s) => s.full);
  const setFull = useSheetStore((s) => s.setFull);
  const { compact, height } = useLayout();

  const shown = selection ?? selectionForTarget(flightTarget ?? focus);
  const model = useObject(shown);
  const shownId = shown?.id ?? null;

  // Phone: the first selection arrives as a peek, never as a wall over the view.
  const previousId = useRef<string | null>(null);
  useEffect(() => {
    if (compact && shownId && previousId.current === null) {
      setCollapsed(true);
      setFull(false);
    }
    previousId.current = shownId;
  }, [compact, shownId, setCollapsed, setFull]);

  const sheet: SheetState = sheetStateOf(collapsed, full);
  const [dragH, setDragH] = useState<number | null>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ y0: number; h0: number; y: number; t: number; v: number; moved: boolean } | null>(null);

  const snaps = () => ({
    peek: PEEK_PX,
    half: Math.round(height * HALF_RATIO),
    full: Math.max(PEEK_PX + 40, height - FULL_MARGIN_PX),
  });
  const applySheet = (next: SheetState) => {
    setCollapsed(next === 'peek');
    setFull(next === 'full');
  };

  const onGripDown = (e: PointerEvent<HTMLButtonElement>) => {
    const h0 = panel.current?.offsetHeight ?? PEEK_PX;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y0: e.clientY, h0, y: e.clientY, t: e.timeStamp, v: 0, moved: false };
  };
  const onGripMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.y0) > 4) d.moved = true;
    if (!d.moved) return;
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = (d.y - e.clientY) / dt; // px/ms, positive = dragging up
    d.y = e.clientY;
    d.t = e.timeStamp;
    const s = snaps();
    setDragH(Math.min(s.full, Math.max(s.peek - 24, d.h0 + (d.y0 - e.clientY))));
  };
  const onGripUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      applySheet(sheet === 'peek' ? 'half' : 'peek'); // a tap toggles
      return;
    }
    const s = snaps();
    const projected = (dragH ?? d.h0) + d.v * 160;
    const next = (Object.entries(s) as [SheetState, number][]).reduce((best, cur) =>
      Math.abs(cur[1] - projected) < Math.abs(best[1] - projected) ? cur : best,
    )[0];
    setDragH(null);
    applySheet(next);
  };
  const onGripKey = (e: KeyboardEvent) => {
    const order: SheetState[] = ['peek', 'half', 'full'];
    const i = order.indexOf(sheet);
    if (e.key === 'ArrowUp') applySheet(order[Math.min(2, i + 1)] as SheetState);
    else if (e.key === 'ArrowDown') applySheet(order[Math.max(0, i - 1)] as SheetState);
    else return;
    e.preventDefault();
  };

  if (!shown && compact) return null;

  // Desktop, collapsed: a slim tab on the right edge.
  if (collapsed && !compact) {
    return (
      <button
        type="button"
        className="sd-info-tab sd-panel"
        aria-label="Show details"
        aria-expanded={false}
        onClick={() => setCollapsed(false)}
      >
        <Icon name="chevronLeft" size={16} />
        <span>Details</span>
      </button>
    );
  }

  let content: ReactNode;
  if (!shown) {
    content = <GalaxyCard />;
  } else if (!model) {
    content = <Uncharted id={shown.id} />;
  } else {
    content = (
      <div className="sd-info__content" key={model.id}>
        <ObjectHeader model={model} />
        <PeekRow model={model} />
        <div className="sd-info__fixed">
          <RatingPlate id={model.id} name={objectName(model)} survey={surveyRatingOf(model)} />
          <ActionRow model={model} />
        </div>
        <div className="sd-info__scroll">
          {model.kind === 'star' ? <StarBody model={model} /> : <BodyBody model={model} />}
        </div>
      </div>
    );
  }

  return (
    <aside
      ref={panel}
      className={`sd-info sd-panel sd-ticked${dragH !== null ? ' is-dragging' : ''}`}
      aria-labelledby="sd-info-title"
      data-sheet={compact ? sheet : undefined}
      style={dragH !== null ? { height: dragH } : undefined}
    >
      {compact && (
        <button
          type="button"
          className="sd-grip"
          aria-label={sheet === 'peek' ? 'Expand details' : 'Resize details'}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onKeyDown={onGripKey}
        >
          <span />
        </button>
      )}
      <button
        type="button"
        className="sd-iconbtn sd-info__collapse"
        aria-label={compact ? (sheet === 'peek' ? 'Expand details' : 'Collapse details') : 'Hide details'}
        onClick={() => (compact ? applySheet(sheet === 'peek' ? 'half' : 'peek') : setCollapsed(true))}
      >
        <Icon name={compact ? (sheet === 'peek' ? 'chevronUp' : 'chevronDown') : 'chevronRight'} size={17} />
      </button>
      {content}
    </aside>
  );
}
