/**
 * Boot screen: ink, a slowly turning armillary ring, the wordmark, and the engine's own progress and
 * message (`store.boot`). Fades out when `store.ready`, then unmounts so it can never eat a click.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { LogoMark } from '../components/Icon';
import { useReducedMotion } from '../hooks';
import './overlays.css';

const FADE_MS = 900;
const SLOW_MS = 14_000;

/** Deterministic stars for the backdrop as one box-shadow list (no randomness, no images). */
const STARFIELD = (() => {
  let s = 20260929;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const stars: string[] = [];
  for (let i = 0; i < 70; i++) {
    const a = 0.25 + next() * 0.6;
    const warm = next() > 0.6;
    stars.push(
      `${(next() * 100).toFixed(1)}cqw ${(next() * 100).toFixed(1)}cqh 0 ${next() > 0.85 ? 0.6 : 0}px rgb(${warm ? '255 226 190' : '200 220 255'} / ${a.toFixed(2)})`,
    );
  }
  return stars.join(',');
})();

const TICKS = Array.from({ length: 72 }, (_, i) => i);

export function LoadingScreen() {
  const ready = useStore((s) => s.ready);
  const progress = useStore((s) => s.boot.progress);
  const message = useStore((s) => s.boot.message);
  const [mounted, setMounted] = useState(!ready);
  const [slow, setSlow] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!ready) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(t);
  }, [ready]);

  if (!mounted) return null;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div
      className={`sd-loading${ready ? ' is-done' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!ready}
      data-sd-interactive
    >
      <div className="sd-loading__stars" style={{ boxShadow: STARFIELD }} aria-hidden="true" />
      <div className="sd-loading__core">
        <div className="sd-loading__orrery">
          <svg className="sd-astro" viewBox="0 0 160 160" aria-hidden="true">
            <g className="sd-astro__ring">
              <circle
                cx="80"
                cy="80"
                r="74"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.8"
                opacity="0.7"
              />
              {TICKS.map((i) => {
                const a = (i * 5 * Math.PI) / 180;
                const long = i % 6 === 0;
                const r1 = long ? 66 : 69;
                return (
                  <line
                    key={i}
                    x1={80 + Math.sin(a) * r1}
                    y1={80 - Math.cos(a) * r1}
                    x2={80 + Math.sin(a) * 74}
                    y2={80 - Math.cos(a) * 74}
                    stroke="currentColor"
                    strokeWidth={long ? 1 : 0.6}
                    opacity={long ? 0.85 : 0.5}
                  />
                );
              })}
            </g>
            <ellipse
              cx="80"
              cy="80"
              rx="56"
              ry="21"
              transform="rotate(-24 80 80)"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.8"
              opacity="0.55"
              strokeDasharray="1.5 3"
            />
            <g transform="rotate(-24 80 80)">
              <circle
                r="2.6"
                cx={reduce ? 136 : 0}
                cy={reduce ? 80 : 0}
                fill="var(--sd-accent-2)"
                className="sd-astro__moon"
              >
                {/* SMIL ignores CSS, so reduced motion has to skip it here. */}
                {!reduce && (
                  <animateMotion
                    dur="7s"
                    repeatCount="indefinite"
                    path="M136 80a56 21 0 1 0 -112 0a56 21 0 1 0 112 0"
                  />
                )}
              </circle>
            </g>
          </svg>
          <div className="sd-loading__mark">
            <LogoMark size={44} />
          </div>
        </div>
        <h1 className="sd-loading__word">Sidereal</h1>
        <div className="sd-loading__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <p className="sd-loading__message">
          <span>{message}</span>
          <span className="sd-mono sd-loading__pct">{pct}%</span>
        </p>
        {slow && !ready && (
          <p className="sd-loading__slow">
            This is taking longer than it should. Slow graphics hardware can need a moment; a page
            reload is harmless.
          </p>
        )}
      </div>
      <p className="sd-loading__wink">Formerly a star-rating component.</p>
    </div>
  );
}
