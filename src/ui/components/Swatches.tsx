/**
 * Tiny body pictures for lists and headers. Colours come straight from the generator's
 * AppearanceHints (`swatch`, `surfaceColors`) — the UI never invents a colour per planet type — with
 * generic lighting on top: a soft highlight, a terminator, and (for ringed worlds) a back arc behind
 * the disc and a front arc across it.
 */
import { useId } from 'react';
import { rgbToCss, saturateRGB } from '../../core/color';
import type { BodyBase, StarRecord } from '../../core/types';

const BANDED: ReadonlySet<string> = new Set(['gas-giant', 'ice-giant']);

interface PlanetSwatchProps {
  body: Pick<BodyBase, 'type' | 'appearance' | 'rings' | 'oceanCoverage' | 'seed'>;
  size?: number;
  className?: string;
}

/** Tiny deterministic stream (seeded by the body) so a world's blobs never move between renders. */
function blobStream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function PlanetSwatch({ body, size = 28, className }: PlanetSwatchProps) {
  const uid = useId();
  const { swatch, surfaceColors, oceanColor, cloudColor, cloudCoverage } = body.appearance;
  const ringed = body.rings !== null;
  const r = ringed ? 9.4 : 14.5;
  const banded = BANDED.has(body.type) && surfaceColors.length > 1;
  const watery = !banded && oceanColor !== null && body.oceanCoverage >= 0.25;
  const base = rgbToCss(watery && oceanColor ? oceanColor : swatch);
  // Continents (or, on dry worlds, a hint of surface variation) and wisps of cloud, all from the
  // generator's own colours — placement only is decorative.
  const next = blobStream(body.seed);
  const patches =
    banded || size < 20
      ? []
      : Array.from({ length: watery ? 4 : 2 }, (_, i) => ({
          cx: 20 + (next() - 0.5) * r * 1.5,
          cy: 20 + (next() - 0.5) * r * 1.5,
          rx: (watery ? 3.5 + (1 - body.oceanCoverage) * 9 : 4 + next() * 4) * (0.7 + next() * 0.6),
          ry: (watery ? 2.5 + (1 - body.oceanCoverage) * 6 : 2.5 + next() * 3) * (0.7 + next() * 0.6),
          rot: next() * 180,
          color: rgbToCss(surfaceColors[i % Math.max(1, Math.min(2, surfaceColors.length))] ?? swatch),
        }));
  const wisps =
    banded || size < 20 || cloudCoverage < 0.15
      ? []
      : Array.from({ length: 2 }, () => ({
          x: 20 - r * 0.9 + next() * r * 0.5,
          y: 20 - r * 0.6 + next() * r * 1.2,
          len: r * (0.9 + next() * 0.6),
        }));
  const ringOpacity = body.rings ? Math.min(0.95, 0.35 + body.rings.opticalDepth * 0.6) : 0;
  const ringWidth = body.rings && body.rings.opticalDepth > 0.3 ? 2.2 : 1.2;
  const ringColor = rgbToCss([
    Math.min(1, swatch[0] * 1.15 + 0.12),
    Math.min(1, swatch[1] * 1.15 + 0.1),
    Math.min(1, swatch[2] * 1.15 + 0.06),
  ]);
  // Ring geometry: an ellipse tilted about the centre; its lower half passes in front of the disc.
  const rx = 18;
  const ry = 5.6;
  const ringTransform = 'rotate(-20 20 20)';

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${uid}-lit`} cx="34%" cy="30%" r="82%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.32" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.68" stopColor="#000" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000" stopOpacity="0.78" />
        </radialGradient>
        <clipPath id={`${uid}-disc`}>
          <circle cx="20" cy="20" r={r} />
        </clipPath>
      </defs>
      {ringed && (
        <ellipse
          cx="20"
          cy="20"
          rx={rx}
          ry={ry}
          transform={ringTransform}
          fill="none"
          stroke={ringColor}
          strokeWidth={ringWidth}
          opacity={ringOpacity * 0.6}
        />
      )}
      <g clipPath={`url(#${uid}-disc)`}>
        <rect x="0" y="0" width="40" height="40" fill={base} />
        {patches.map((p, i) => (
          <ellipse
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed, ordered decoration
            key={i}
            cx={p.cx}
            cy={p.cy}
            rx={p.rx}
            ry={p.ry}
            transform={`rotate(${p.rot.toFixed(0)} ${p.cx} ${p.cy})`}
            fill={p.color}
            opacity={watery ? 0.92 : 0.5}
          />
        ))}
        {wisps.map((w, i) => (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed, ordered decoration
            key={i}
            d={`M${w.x} ${w.y}q${w.len / 2} -3 ${w.len} 0`}
            fill="none"
            stroke={rgbToCss(cloudColor)}
            strokeWidth="1.7"
            strokeLinecap="round"
            opacity={Math.min(0.75, cloudCoverage * 0.9)}
          />
        ))}
        {banded &&
          surfaceColors.slice(0, 4).map((c, i, all) => {
            const h = (2 * r) / all.length;
            return (
              <rect
                key={rgbToCss(c) + String(i)}
                x="0"
                y={20 - r + i * h + (i % 2 ? 0.6 : 0)}
                width="40"
                height={h * 0.78}
                fill={rgbToCss(c)}
                opacity="0.85"
              />
            );
          })}
        <rect x="0" y="0" width="40" height="40" fill={`url(#${uid}-lit)`} />
      </g>
      {ringed && (
        <path
          d={`M${20 - rx} 20A${rx} ${ry} 0 0 0 ${20 + rx} 20`}
          transform={ringTransform}
          fill="none"
          stroke={ringColor}
          strokeWidth={ringWidth}
          opacity={ringOpacity}
        />
      )}
    </svg>
  );
}

/** Blackbody-coloured star dot; black holes get an accretion ring, neutron stars a hard bright core. */
export function StarGlyph({
  star,
  size = 14,
  className,
}: {
  star: Pick<StarRecord, 'kind' | 'colorRGB'>;
  size?: number;
  className?: string;
}) {
  const color = rgbToCss(saturateRGB(star.colorRGB, 1.25));
  if (star.kind === 'black-hole') {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <ellipse
          cx="10"
          cy="10"
          rx="9"
          ry="3.2"
          transform="rotate(-20 10 10)"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
        />
        <circle cx="10" cy="10" r="3.6" fill="var(--sd-ink)" stroke={color} strokeWidth="0.8" />
      </svg>
    );
  }
  const glow = star.kind === 'neutron-star' ? size * 1.4 : size * 0.9;
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-block',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 38% 34%, #fff 0, ${color} 46%, ${color} 100%)`,
        boxShadow: `0 0 ${glow}px ${color}, 0 0 ${glow / 3}px ${color}`,
      }}
    />
  );
}
