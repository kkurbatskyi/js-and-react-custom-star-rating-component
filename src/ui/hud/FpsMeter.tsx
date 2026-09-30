/** Frame-rate readout (settings.showFps). Samples requestAnimationFrame; updates twice a second. */
import { useEffect, useState } from 'react';
import './hud.css';

export function FpsMeter() {
  const [stats, setStats] = useState<{ fps: number; ms: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let worst = 0;
    let last = performance.now();
    let windowStart = last;
    const tick = (now: number) => {
      frames += 1;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - windowStart >= 500) {
        setStats({ fps: (frames * 1000) / (now - windowStart), ms: worst });
        frames = 0;
        worst = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="sd-fps sd-mono" role="status" aria-label="Frame rate">
      <span>{stats ? Math.round(stats.fps) : '--'}</span> fps
      <span className="sd-fps__ms">{stats ? `${stats.ms.toFixed(1)} ms worst` : ''}</span>
    </div>
  );
}
