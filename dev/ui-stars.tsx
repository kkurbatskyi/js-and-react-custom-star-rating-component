/** StarRating gallery: every state on one page, for close inspection (?dpr=2 with scripts/shot.mjs). */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StarRating } from '../src/ui/components/StarRating';
import '../src/ui/fonts';
import '../src/ui/theme.css';

declare global {
  interface Window {
    __READY__?: boolean;
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '210px 1fr',
        alignItems: 'center',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid var(--sd-line)',
      }}
    >
      <span className="sd-eyebrow">{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  );
}

function Live({ size }: { size: number }) {
  const [v, setV] = useState(0);
  return <StarRating label="Kiranth" value={v} size={size} onChange={setV} />;
}

function Gallery() {
  const hover = useRef<HTMLDivElement>(null);
  const focus = useRef<HTMLDivElement>(null);
  const nova = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Pointer over the 4th star (React's onPointerEnter listens for pointerover), focus the 2nd,
    // and choose the 5th to light the supernova.
    hover.current
      ?.querySelectorAll('button')[3]
      ?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    focus.current?.querySelectorAll('button')[1]?.focus({ preventScroll: true });
    nova.current?.querySelectorAll('button')[4]?.click();
    const t = setTimeout(() => {
      window.__READY__ = true;
    }, 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      className="sd-root"
      style={{
        position: 'relative',
        inset: 'auto',
        padding: 28,
        width: 820,
        pointerEvents: 'auto',
        containerType: 'normal',
        overflow: 'visible',
      }}
    >
      <h1 style={{ margin: '0 0 8px', font: '500 34px/1 var(--sd-font-display)' }}>StarRating</h1>
      <p
        style={{
          margin: '0 0 18px',
          font: 'italic 500 18px/1.3 var(--sd-font-display)',
          color: 'var(--sd-text-dim)',
        }}
      >
        This used to be the whole repository.
      </p>
      <Row label="interactive · empty">
        {[16, 24, 34, 48].map((s) => (
          <StarRating key={s} label="Kiranth" value={0} size={s} onChange={() => undefined} />
        ))}
      </Row>
      <Row label="interactive · 1 … 5">
        <div style={{ display: 'grid', gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <StarRating key={n} label="Kiranth" value={n} size={26} onChange={() => undefined} />
          ))}
        </div>
      </Row>
      <Row label="hover preview (4) over a rating of 2">
        <div ref={hover}>
          <StarRating label="Kiranth" value={2} size={34} onChange={() => undefined} />
        </div>
      </Row>
      <Row label="keyboard focus on star 2">
        <div ref={focus}>
          <StarRating label="Kiranth" value={3} size={34} onChange={() => undefined} />
        </div>
      </Row>
      <Row label="five stars: the supernova">
        <div ref={nova}>
          <StarRating label="Kiranth" value={4} size={34} onChange={() => undefined} />
        </div>
      </Row>
      <Row label="try it (click, arrows, digits)">
        <Live size={40} />
      </Row>
      <Row label="read-only · halves">
        <div style={{ display: 'grid', gap: 6 }}>
          {[0.5, 1, 2.5, 3.5, 4.5, 5].map((n) => (
            <StarRating
              key={n}
              label="Halcyon"
              value={n}
              readOnly
              size={22}
              showValue
              caption="Rating"
            />
          ))}
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {[2, 3.5, 5].map((n) => (
            <StarRating
              key={n}
              label="Halcyon"
              value={n}
              readOnly
              size={14}
              showValue
              tone="muted"
              caption="Surveyor’s rating"
            />
          ))}
        </div>
      </Row>
      <Row label="tiny (tooltips, lists)">
        <StarRating label="Halcyon" value={4} readOnly size={11} />
        <StarRating label="Halcyon" value={2.5} readOnly size={12} />
      </Row>
    </div>
  );
}

const host = document.createElement('div');
document.body.append(host);
createRoot(host).render(<Gallery />);
