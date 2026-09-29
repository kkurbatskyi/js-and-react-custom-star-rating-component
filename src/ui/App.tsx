/**
 * App — PLACEHOLDER overlay (integration phase). The UI specialist replaces it with the real
 * interface (panels, search, logbook, ratings); it only shows the wordmark and what the store says
 * the camera is looking at, so everyone can see the store ↔ engine wiring working.
 */
import type { CSSProperties } from 'react';
import type { FocusTarget, ViewLevel } from '../core/types';
import { useStore } from '../state/store';
import { getUniverse } from '../universe';
import type { Universe } from '../universe/contracts';

const LEVEL_LABEL: Readonly<Record<ViewLevel, string>> = {
  galaxy: 'Galaxy',
  system: 'System',
  planet: 'Planet',
};

function describeFocus(focus: FocusTarget, universe: Universe): string {
  switch (focus.kind) {
    case 'galaxy': {
      const [x, y, z] = focus.centerLy;
      if (x === 0 && y === 0 && z === 0) return `${universe.galaxy.params.name} · galactic centre`;
      return `${universe.galaxy.params.name} · ${[x, y, z].map((v) => Math.round(v).toLocaleString('en-US')).join(', ')} ly`;
    }
    case 'star': {
      const star = universe.getRecord(focus.id);
      return star ? `${star.name} · ${star.spectralType}` : focus.id;
    }
    case 'planet':
    case 'moon': {
      const body = universe.getBody(focus.id);
      if (!body) return focus.id;
      return body.moon
        ? `${body.moon.name} · moon of ${body.planet.name}`
        : `${body.planet.name} · ${body.system.star.name}`;
    }
  }
}

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    color: 'var(--sd-text, #e9e4d8)',
    fontFamily: "var(--sd-font-ui, 'IBM Plex Sans', system-ui, sans-serif)",
  },
  header: {
    position: 'absolute',
    top: 'max(20px, env(safe-area-inset-top))',
    left: 'max(24px, env(safe-area-inset-left))',
    textShadow: '0 1px 12px rgba(0, 0, 0, 0.6)',
  },
  wordmark: {
    margin: 0,
    fontFamily: "var(--sd-font-display, 'Cormorant Garamond', 'Iowan Old Style', Georgia, serif)",
    fontWeight: 500,
    fontSize: 'clamp(26px, 3.2vw, 38px)',
    fontVariant: 'small-caps',
    letterSpacing: '0.22em',
    lineHeight: 1,
  },
  rule: {
    width: 56,
    height: 1,
    margin: '10px 0 9px',
    background: 'var(--sd-accent, #d9b36c)',
    opacity: 0.8,
  },
  status: {
    margin: 0,
    fontFamily: "var(--sd-font-mono, 'IBM Plex Mono', ui-monospace, monospace)",
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--sd-text-dim, rgba(233, 228, 216, 0.66))',
  },
} satisfies Record<string, CSSProperties>;

export function App() {
  const ready = useStore((s) => s.ready);
  const bootMessage = useStore((s) => s.boot.message);
  const level = useStore((s) => s.level);
  const focus = useStore((s) => s.focus);
  const seed = useStore((s) => s.settings.galaxySeed);
  const universe = getUniverse(seed);

  return (
    <div style={styles.overlay}>
      <header style={styles.header}>
        <h1 style={styles.wordmark}>Sidereal</h1>
        <div style={styles.rule} />
        <p style={styles.status} aria-live="polite">
          {ready ? `${LEVEL_LABEL[level]} — ${describeFocus(focus, universe)}` : bootMessage}
        </p>
      </header>
    </div>
  );
}
