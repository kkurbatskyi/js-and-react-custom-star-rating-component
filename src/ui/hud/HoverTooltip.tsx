/**
 * Hover tooltip for whatever the engine reports under the pointer (`store.hover`). It follows the
 * pointer by writing `transform` directly — no React work per pointer move.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { StarRating } from '../components/StarRating';
import { useObject } from '../hooks';
import { bodyOf, objectName, planetTypeLabel, starClassLabel } from '../lib/model';
import './hud.css';

const OFFSET = 16;

export function HoverTooltip() {
  const hover = useStore((s) => s.hover);
  const model = useObject(hover);
  const rating = useStore((s) => (hover ? (s.ratings[hover.id] ?? 0) : 0));
  const el = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: -999, y: -999 });

  /** Position relative to the overlay (which may not sit at the viewport origin, e.g. the dev frame). */
  const place = () => {
    const node = el.current;
    if (!node) return;
    const host = node.offsetParent?.getBoundingClientRect();
    const ox = host?.left ?? 0;
    const oy = host?.top ?? 0;
    const hw = host?.width ?? window.innerWidth;
    const hh = host?.height ?? window.innerHeight;
    if (pos.current.x < 0) return; // no pointer position yet: stay hidden
    node.style.visibility = 'visible';
    const x = pos.current.x - ox;
    const y = pos.current.y - oy;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const px = x + OFFSET > hw - w - 8 ? x - OFFSET - w : x + OFFSET;
    const py = y + OFFSET > hh - h - 8 ? y - OFFSET - h : y + OFFSET;
    node.style.transform = `translate3d(${Math.max(8, px)}px, ${Math.max(8, py)}px, 0)`;
  };

  useEffect(() => {
    if (!hover) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pos.current = { x: e.clientX, y: e.clientY };
      place();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [hover]);

  useLayoutEffect(() => {
    if (model) place();
  });

  if (!hover || !model) return null;
  const body = bodyOf(model);
  const sub =
    model.kind === 'star'
      ? `${model.star.spectralType} · ${starClassLabel(model.star)}`
      : `${planetTypeLabel(body?.type ?? 'barren', model.kind === 'moon')} · ${model.kind === 'moon' ? model.planet.name : model.star.name}`;
  return (
    <div ref={el} className="sd-tip" role="tooltip" style={{ transform: 'translate3d(-999px, -999px, 0)', visibility: 'hidden' }}>
      <span className="sd-tip__name">{objectName(model)}</span>
      <span className="sd-tip__sub">{sub}</span>
      {rating > 0 && (
        <StarRating label={objectName(model)} value={rating} readOnly size={11} caption="Your rating" />
      )}
    </div>
  );
}
