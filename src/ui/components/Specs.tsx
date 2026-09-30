/** Spec sheet parts: dotted-leader rows, the habitability meter, atmosphere composition bars. */
import type { ReactNode } from 'react';
import { formatPercent } from '../../core/format';
import './parts.css';

export interface SpecRow {
  label: string;
  value: ReactNode;
  /** Native tooltip with the fuller explanation. */
  hint?: string;
}

export function SpecList({ rows }: { rows: readonly (SpecRow | null | false)[] }) {
  return (
    <dl className="sd-specs">
      {rows.map((row) =>
        row ? (
          <div className="sd-spec" key={row.label} title={row.hint}>
            <dt>{row.label}</dt>
            <dd className="sd-mono">{row.value}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

const TICKS = 24;
const METER_TICKS = Array.from({ length: TICKS }, (_, n) => ({
  id: `tick-${n}`,
  major: n % 6 === 0,
}));

/** 0..1 gauge drawn as fine tick marks — an instrument, not a progress bar. */
export function Meter({ value, label, text }: { value: number; label: string; text: string }) {
  const v = Math.max(0, Math.min(1, value));
  const lit = Math.round(v * TICKS);
  return (
    <div className="sd-meter">
      {/* The native element carries the semantics; the ticks are decoration. */}
      <meter
        className="sd-visually-hidden"
        min={0}
        max={1}
        value={Number(v.toFixed(2))}
        aria-label={label}
        aria-valuetext={text}
      >
        {text}
      </meter>
      <div className="sd-meter__ticks" aria-hidden="true">
        {METER_TICKS.map((t, n) => (
          <i
            key={t.id}
            className={n < lit ? 'is-lit' : undefined}
            data-major={t.major ? '' : undefined}
          />
        ))}
      </div>
      <span className="sd-meter__text" aria-hidden="true">
        {text}
      </span>
    </div>
  );
}

const trace = (f: number): string =>
  f > 0 && f < 0.001 ? '<0.1%' : formatPercent(f, { decimals: f < 0.1 ? 1 : 0 });

export function CompositionBars({
  composition,
}: {
  composition: readonly { gas: string; fraction: number }[];
}) {
  const rows = composition.slice(0, 5);
  return (
    <ul className="sd-comp">
      {rows.map((g, i) => (
        <li key={g.gas} className="sd-comp__row">
          <span className="sd-comp__gas">{g.gas}</span>
          <span className="sd-comp__track" aria-hidden="true">
            <span
              className="sd-comp__fill"
              style={{
                width: `${Math.max(1.5, g.fraction * 100)}%`,
                background: `var(--sd-gas-${Math.min(i + 1, 6)})`,
              }}
            />
          </span>
          <span className="sd-comp__pct sd-mono">{trace(g.fraction)}</span>
        </li>
      ))}
    </ul>
  );
}
