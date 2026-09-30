/**
 * Minimap: a top-down chart of the galaxy (rendered once per seed to a 2D canvas from the
 * GalaxyModel) with a live reticle for the camera, a ring for the focus, a dashed course line while
 * flying, and a home marker. Click — or move the keyboard cursor with the arrows and press Enter —
 * to fly to a galactic point.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber, MINUS } from '../../core/format';
import type { FocusTarget, Vec3Tuple } from '../../core/types';
import { useStore } from '../../state/store';
import { starIdOf } from '../../universe';
import type { Universe } from '../../universe/contracts';
import { useUniverse } from '../hooks';
import { flyToPoint } from '../lib/actions';
import { mapExtentLy, mapToWorld, renderGalaxyMap, worldToMap } from '../lib/minimapRender';
import './hud.css';

/** Logical map size in CSS px (the element scales with CSS). */
const SIZE = 168;
const RINGS_KLY = [10, 20, 30, 40, 50];

function pointOf(target: FocusTarget | null, universe: Universe): Vec3Tuple | null {
  if (!target) return null;
  if (target.kind === 'galaxy') return target.centerLy;
  const starId = starIdOf(target.id);
  return starId ? (universe.getRecord(starId)?.posLy ?? null) : null;
}

const signed = (v: number) => `${v < 0 ? MINUS : '+'}${formatNumber(Math.abs(v), { decimals: 0 })}`;

export function Minimap() {
  const universe = useUniverse();
  const canvas = useRef<HTMLCanvasElement>(null);
  const cameraLy = useStore((s) => s.cameraLy);
  const focus = useStore((s) => s.focus);
  const flightTarget = useStore((s) => s.flightTarget);
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const extent = mapExtentLy(universe.galaxy);

  // Draw the raster once per galaxy, after first paint so booting stays snappy.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const handle = window.setTimeout(() => renderGalaxyMap(el, universe.galaxy, Math.round(SIZE * dpr)), 30);
    return () => window.clearTimeout(handle);
  }, [universe]);

  const cam = worldToMap(cameraLy[0], cameraLy[2], SIZE, extent);
  const home = worldToMap(universe.galaxy.params.homeLy[0], universe.galaxy.params.homeLy[2], SIZE, extent);
  const focusPt = useMemo(() => pointOf(focus, universe), [focus, universe]);
  const destPt = useMemo(() => pointOf(flightTarget, universe), [flightTarget, universe]);
  const focusXY = focusPt ? worldToMap(focusPt[0], focusPt[2], SIZE, extent) : null;
  const destXY = destPt ? worldToMap(destPt[0], destPt[2], SIZE, extent) : null;
  const clampPt = (p: [number, number]): [number, number] => [
    Math.min(SIZE - 3, Math.max(3, p[0])),
    Math.min(SIZE - 3, Math.max(3, p[1])),
  ];
  const camXY = clampPt(cam);

  const worldAt = (e: PointerEvent<HTMLElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return mapToWorld(((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE, SIZE, extent);
  };
  const inDisk = (x: number, z: number) => Math.hypot(x, z) <= universe.galaxy.params.radiusLy * 1.08;

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const step = extent * 0.08;
    const base: [number, number] = cursor ?? [cameraLy[0], cameraLy[2]];
    const next: [number, number] | null =
      e.key === 'ArrowLeft'
        ? [base[0] - step, base[1]]
        : e.key === 'ArrowRight'
          ? [base[0] + step, base[1]]
          : e.key === 'ArrowUp'
            ? [base[0], base[1] - step]
            : e.key === 'ArrowDown'
              ? [base[0], base[1] + step]
              : null;
    if (next) {
      e.preventDefault();
      setCursor(next);
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor) {
      e.preventDefault();
      flyToPoint([cursor[0], 0, cursor[1]]);
      setCursor(null);
    } else if (e.key === 'Escape' && cursor) {
      setCursor(null);
    }
  };

  const shownWorld = pointer ?? cursor;
  const cursorXY = cursor ? worldToMap(cursor[0], cursor[1], SIZE, extent) : null;

  return (
    <div className="sd-minimap sd-panel sd-ticked">
      <div
        className="sd-minimap__map"
        role="application"
        aria-label="Galaxy map. Click to fly to a point, or use the arrow keys and Enter."
        tabIndex={0}
        onPointerMove={(e) => setPointer(worldAt(e))}
        onPointerLeave={() => setPointer(null)}
        onPointerDown={(e) => {
          const [x, z] = worldAt(e);
          if (inDisk(x, z)) flyToPoint([x, 0, z]);
        }}
        onKeyDown={onKey}
        onBlur={() => setCursor(null)}
      >
        <canvas ref={canvas} className="sd-minimap__canvas" width={SIZE} height={SIZE} />
        <svg className="sd-minimap__overlay" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {RINGS_KLY.map((k) => (
            <circle
              key={k}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={((k * 1000) / extent) * (SIZE / 2)}
              className="sd-minimap__ring"
            />
          ))}
          <path
            className="sd-minimap__axis"
            d={`M${SIZE / 2} 0V${SIZE}M0 ${SIZE / 2}H${SIZE}`}
          />
          {/* home: hollow diamond */}
          <path
            className="sd-minimap__home"
            d={`M${home[0]} ${home[1] - 3.6}L${home[0] + 3.6} ${home[1]}L${home[0]} ${home[1] + 3.6}L${home[0] - 3.6} ${home[1]}Z`}
          />
          {focusXY && <circle className="sd-minimap__focus" cx={focusXY[0]} cy={focusXY[1]} r="5" />}
          {destXY && (
            <>
              <path className="sd-minimap__course" d={`M${camXY[0]} ${camXY[1]}L${destXY[0]} ${destXY[1]}`} />
              <circle className="sd-minimap__dest" cx={destXY[0]} cy={destXY[1]} r="3" />
            </>
          )}
          {cursorXY && <circle className="sd-minimap__cursor" cx={cursorXY[0]} cy={cursorXY[1]} r="6" />}
          {/* you are here: a reticle with a soft halo */}
          <circle className="sd-minimap__halo" cx={camXY[0]} cy={camXY[1]} r="7" />
          <path
            className="sd-minimap__you"
            d={`M${camXY[0] - 6} ${camXY[1]}H${camXY[0] - 2.2}M${camXY[0] + 2.2} ${camXY[1]}H${camXY[0] + 6}M${camXY[0]} ${camXY[1] - 6}V${camXY[1] - 2.2}M${camXY[0]} ${camXY[1] + 2.2}V${camXY[1] + 6}`}
          />
          <circle className="sd-minimap__dot" cx={camXY[0]} cy={camXY[1]} r="1.3" />
        </svg>
      </div>
      <div className="sd-minimap__caption sd-mono">
        {shownWorld ? (
          <span>
            {signed(shownWorld[0])} · {signed(shownWorld[1])} ly
          </span>
        ) : (
          <>
            <span className="sd-minimap__key">
              <i className="sd-minimap__key-home" /> home
            </span>
            <span className="sd-minimap__key">
              <i className="sd-minimap__key-you" /> you
            </span>
          </>
        )}
      </div>
    </div>
  );
}
