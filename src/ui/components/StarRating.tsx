/**
 * StarRating — the soul of the joke: this repository used to be a star-rating component, and now it
 * rates actual stars.
 *
 * Interactive (pass `onChange`): an ARIA radio group of buttons with a roving tabindex.
 *   ← ↓ / → ↑ move to (and choose) the neighbouring star, Home / End jump to 1 / max, digits choose
 *   directly, Backspace / Delete clear, Space / Enter (click) choose the focused star — and choosing the
 *   current value again clears it. Hovering previews (mouse only), the pointed-at star twinkles, and a
 *   five-star rating sets off a small supernova.
 * Read-only: an `img` with a spoken value; halves render as a half-filled star (the Surveyor's rating).
 *
 * Stars are SVG with a soft glow, drawn as an engraver would: a thin outline plus facet lines.
 */
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import './StarRating.css';

export interface StarRatingProps {
  /** 0 = unrated; integer for interactive use, halves allowed when read-only. */
  value: number;
  /** Makes the control interactive. Called with 1..max, or 0 to clear. */
  onChange?: (value: number) => void;
  /** Name of the thing being rated: "Rate Kiranth 4 of 5 stars". */
  label: string;
  readOnly?: boolean;
  max?: number;
  /** Star size in CSS px. */
  size?: number;
  /** `muted` is the quieter tone used for the surveyor's rating. */
  tone?: 'gold' | 'muted';
  /** Show the numeric value beside read-only stars. */
  showValue?: boolean;
  /** Read-only spoken prefix, e.g. "Surveyor's rating". */
  caption?: string;
  /** Interactive group name; defaults to "Your rating for {label}". */
  groupLabel?: string;
  /** Reports the hovered/focused value while previewing, and 0 when the preview ends. */
  onPreview?: (value: number) => void;
  className?: string;
}

// ───────────────────────────────────────────────────────────── geometry

const VIEW = 24;
const OUTER = 10.4;
const INNER = 4.55;
const CX = 12;
// Vertically centre the star's bounding box (tip at −R, lower tips at +R·cos 36°).
const CY = (VIEW - OUTER * (1 + Math.cos(Math.PI / 5))) / 2 + OUTER;

function polar(radius: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}
const fmt = (n: number) => n.toFixed(2);

/** Five outer tips and five inner notches, alternating. */
const STAR_PATH = (() => {
  const pts: string[] = [];
  for (let k = 0; k < 5; k++) {
    const [ox, oy] = polar(OUTER, -90 + 72 * k);
    const [ix, iy] = polar(INNER, -54 + 72 * k);
    pts.push(`${fmt(ox)} ${fmt(oy)}`, `${fmt(ix)} ${fmt(iy)}`);
  }
  return `M${pts.join('L')}Z`;
})();

/** Facet lines from the centre to each notch — the "cut gem" detail. */
const FACET_PATH = (() => {
  const segs: string[] = [];
  for (let k = 0; k < 5; k++) {
    const [ix, iy] = polar(INNER, -54 + 72 * k);
    segs.push(`M${fmt(CX)} ${fmt(CY)}L${fmt(ix)} ${fmt(iy)}`);
    const [ox, oy] = polar(OUTER, -90 + 72 * k);
    segs.push(`M${fmt(CX)} ${fmt(CY)}L${fmt((CX + ox) / 2)} ${fmt((CY + oy) / 2)}`);
  }
  return segs.join('');
})();

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const NOVA_MS = 900;
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

function Glyph({ fill }: { fill: number }) {
  return (
    <>
      <svg className="sd-star__base" viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true">
        <path d={STAR_PATH} />
      </svg>
      {fill > 0 && (
        <svg
          className="sd-star__fill"
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          aria-hidden="true"
          style={fill < 1 ? { clipPath: `inset(0 ${((1 - fill) * 100).toFixed(1)}% 0 0)` } : undefined}
        >
          <path d={STAR_PATH} />
          <path className="sd-star__facets" d={FACET_PATH} />
        </svg>
      )}
    </>
  );
}

function Nova() {
  return (
    <span className="sd-nova" aria-hidden="true">
      <span className="sd-nova__ring" />
      {RAYS.map((a) => (
        <span key={a} className="sd-nova__ray" style={{ '--a': `${a}deg` } as CSSProperties} />
      ))}
    </span>
  );
}

const roundHalf = (n: number) => Math.round(n * 2) / 2;
const spoken = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function StarRating({
  value,
  onChange,
  label,
  readOnly = false,
  max = 5,
  size = 24,
  tone = 'gold',
  showValue = false,
  caption,
  groupLabel,
  onPreview,
  className,
}: StarRatingProps) {
  const interactive = !!onChange && !readOnly;
  const [hover, setHover] = useState<number | null>(null);
  const [nova, setNova] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(pulseTimer.current), []);

  const current = interactive ? Math.round(clamp(value, 0, max)) : roundHalf(clamp(value, 0, max));
  const shown = interactive && hover !== null ? hover : current;

  const preview = useCallback(
    (next: number | null) => {
      setHover(next);
      onPreview?.(next ?? 0);
    },
    [onPreview],
  );

  const commit = (n: number, toggle: boolean) => {
    if (!onChange) return;
    if (n === current) {
      if (toggle) onChange(0);
      return;
    }
    onChange(n);
    if (n === max) {
      setNova((k) => k + 1);
      setPulsing(true);
      clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => {
        setPulsing(false);
        setNova(0);
      }, NOVA_MS);
    }
  };

  const focusStar = (n: number) => buttons.current[n - 1]?.focus();

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        target = clamp(index + 1, 1, max);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        target = clamp(index - 1, 1, max);
        break;
      case 'Home':
        target = 1;
        break;
      case 'End':
        target = max;
        break;
      case 'Backspace':
      case 'Delete':
      case '0':
        e.preventDefault();
        if (current !== 0) onChange?.(0);
        return;
      default:
        if (/^[1-9]$/.test(e.key) && Number(e.key) <= max) target = Number(e.key);
    }
    if (target === null) return;
    e.preventDefault();
    focusStar(target);
    commit(target, false);
  };

  const style = { '--sd-star-size': `${size}px` } as CSSProperties;
  const cls = [
    'sd-stars',
    interactive ? 'sd-stars--interactive' : 'sd-stars--readonly',
    tone === 'muted' && 'sd-stars--muted',
    pulsing && 'is-nova',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const cells = Array.from({ length: max }, (_, k) => k + 1);

  if (!interactive) {
    return (
      <span className={cls} style={style}>
        <span
          className="sd-stars__row"
          role="img"
          aria-label={`${caption ?? 'Rating'} for ${label}: ${current === 0 ? 'none' : spoken(current)} of ${max} stars`}
        >
          {cells.map((n) => {
            const fill = clamp(current - (n - 1), 0, 1);
            return (
              <span key={n} className="sd-star" data-fill={fill}>
                <Glyph fill={fill} />
              </span>
            );
          })}
        </span>
        {showValue && current > 0 && <span className="sd-stars__value">{spoken(current)}</span>}
      </span>
    );
  }

  const tabbable = current > 0 ? current : 1;
  return (
    <span className={cls} style={style} data-preview={hover ?? undefined} data-value={current}>
      <span
        className="sd-stars__row"
        role="radiogroup"
        aria-label={groupLabel ?? `Your rating for ${label}`}
        onPointerLeave={() => preview(null)}
      >
        {cells.map((n) => {
          const fill = shown >= n ? 1 : 0;
          const hot = hover === n;
          return (
            <span key={n} className="sd-stars__cell" style={{ '--i': n - 1 } as CSSProperties}>
              <button
                ref={(el) => {
                  buttons.current[n - 1] = el;
                }}
                type="button"
                role="radio"
                aria-checked={current === n}
                aria-label={`Rate ${label} ${n} of ${max} stars`}
                tabIndex={n === tabbable ? 0 : -1}
                className={`sd-star${hot ? ' is-hot' : ''}${hover !== null && fill ? ' is-preview' : ''}`}
                data-fill={fill}
                onClick={() => commit(n, true)}
                onKeyDown={(e) => onKeyDown(e, n)}
                onPointerEnter={(e: PointerEvent) => e.pointerType !== 'touch' && preview(n)}
                onFocus={() => onPreview?.(n)}
                onBlur={() => onPreview?.(0)}
              >
                <Glyph fill={fill} />
              </button>
              {n === max && nova > 0 && <Nova key={nova} />}
            </span>
          );
        })}
      </span>
    </span>
  );
}
