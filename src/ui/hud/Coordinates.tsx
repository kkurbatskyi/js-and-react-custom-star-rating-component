/** Galactic coordinates of the camera (light-years) and its range to the focus. */
import { formatDistanceKm, formatNumber, MINUS } from '../../core/format';
import { useStore } from '../../state/store';
import './hud.css';

function signedLy(v: number): string {
  const a = Math.abs(v);
  if (a < 0.005) return '0';
  const text = formatNumber(a, { decimals: a >= 1000 ? 0 : a >= 10 ? 1 : 2 });
  return `${v < 0 ? MINUS : '+'}${text}`;
}

export function Coordinates() {
  const [x, y, z] = useStore((s) => s.cameraLy);
  const distanceKm = useStore((s) => s.cameraDistanceKm);
  return (
    <dl
      className="sd-coords sd-mono"
      aria-label="Camera position in galactic coordinates, light-years"
    >
      <p className="sd-coords__head sd-eyebrow" aria-hidden="true">
        Position · ly
      </p>
      <div>
        <dt>X</dt>
        <dd>{signedLy(x)}</dd>
      </div>
      <div>
        <dt>Y</dt>
        <dd>{signedLy(y)}</dd>
      </div>
      <div>
        <dt>Z</dt>
        <dd>{signedLy(z)}</dd>
      </div>
      {distanceKm > 0 && (
        <div className="sd-coords__range">
          <dt>Range</dt>
          <dd>{formatDistanceKm(distanceKm)}</dd>
        </div>
      )}
    </dl>
  );
}
