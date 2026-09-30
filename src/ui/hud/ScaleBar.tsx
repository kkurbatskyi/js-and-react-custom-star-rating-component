/**
 * A logarithmic, map-style scale ruler. It reads the camera distance to the focus and the viewport
 * height, and picks a 1–2–5 length (metres → km → AU → ly) that stays around 120 px wide.
 */
import { useStore } from '../../state/store';
import { useLayout } from '../hooks';
import { DEFAULT_FOV_DEG, kmPerPixel, scaleBarFor } from '../lib/scale';
import './hud.css';

const TARGET_PX = 120;
const SEGMENTS = 4;

export function ScaleBar() {
  const distanceKm = useStore((s) => s.cameraDistanceKm);
  const { height } = useLayout();
  const spec = scaleBarFor(kmPerPixel(distanceKm, height, DEFAULT_FOV_DEG), TARGET_PX);
  if (!spec) return null;
  const w = Math.max(24, Math.min(spec.px, 260));
  const seg = w / SEGMENTS;
  return (
    <div className="sd-scale" role="img" aria-label={`Scale: ${spec.label}`}>
      <span className="sd-scale__label sd-mono">{spec.label}</span>
      <svg width={w + 2} height="11" viewBox={`0 0 ${w + 2} 11`} aria-hidden="true">
        <g transform="translate(1 0)" stroke="currentColor" strokeWidth="1" fill="currentColor">
          {Array.from({ length: SEGMENTS }, (_, i) =>
            i % 2 === 0 ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed segments
              <rect key={i} x={i * seg} y="6" width={seg} height="2.5" stroke="none" />
            ) : null,
          )}
          <path d={`M0 6.5H${w}`} fill="none" opacity="0.7" />
          {Array.from({ length: SEGMENTS + 1 }, (_, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed ticks
              key={i}
              d={`M${i * seg} ${i === 0 || i === SEGMENTS ? 1 : 3.5}V9.5`}
              fill="none"
              opacity={i === 0 || i === SEGMENTS ? 1 : 0.6}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
