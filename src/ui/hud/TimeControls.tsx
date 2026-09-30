/**
 * Simulation clock: play/pause, a stepper over the TIME_SCALES presets, the live date, "now".
 * "Slower" past real time pauses (the store keeps the last scale), "faster" while paused resumes.
 */
import { formatSimDate, formatTimeScale } from '../../core/format';
import { nearestTimeScaleIndex, simDaysNow, stepTimeScale, TIME_SCALES } from '../../sim/time';
import { useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import './hud.css';

export function TimeControls() {
  const simDays = useStore((s) => s.simDays);
  const timeScale = useStore((s) => s.timeScale);
  const paused = useStore((s) => s.paused);
  const togglePause = useStore((s) => s.togglePause);
  const setTimeScale = useStore((s) => s.setTimeScale);
  const requestTime = useStore((s) => s.requestTime);

  const stopped = paused || timeScale === 0;
  const index = nearestTimeScaleIndex(timeScale);
  const [date, ...rest] = formatSimDate(simDays).split(' ');
  const clock = rest.join(' ');

  const play = () => {
    if (timeScale === 0) setTimeScale(TIME_SCALES[1]?.secondsPerSecond ?? 1);
    if (stopped) {
      if (paused) togglePause();
    } else togglePause();
  };
  const slower = () => {
    if (stopped) return;
    const next = stepTimeScale(timeScale, -1);
    if (next <= 0) togglePause();
    else setTimeScale(next);
  };
  const faster = () => {
    if (paused) {
      togglePause();
      return;
    }
    setTimeScale(stepTimeScale(timeScale === 0 ? 1 : timeScale, 1));
  };

  return (
    <section className="sd-time sd-panel" aria-label="Simulation clock">
      <button
        type="button"
        className="sd-iconbtn sd-time__play"
        aria-label={stopped ? 'Play time' : 'Pause time'}
        onClick={play}
      >
        <Icon name={stopped ? 'play' : 'pause'} size={17} filled={stopped} />
      </button>

      <div className="sd-time__step" role="group" aria-label="Time speed">
        <button
          type="button"
          className="sd-iconbtn"
          aria-label="Slower"
          onClick={slower}
          disabled={stopped}
        >
          <Icon name="slower" size={16} />
        </button>
        <div className="sd-time__speed">
          <span className="sd-mono sd-time__scale" aria-live="polite">
            {stopped ? formatTimeScale(0) : formatTimeScale(timeScale)}
          </span>
          <span className="sd-time__notches" aria-hidden="true">
            {TIME_SCALES.map((p, i) => (
              <i key={p.secondsPerSecond} className={!stopped && i === index ? 'is-on' : undefined} />
            ))}
          </span>
        </div>
        <button
          type="button"
          className="sd-iconbtn"
          aria-label="Faster"
          onClick={faster}
          disabled={!stopped && index === TIME_SCALES.length - 1 && timeScale >= (TIME_SCALES[index]?.secondsPerSecond ?? 0)}
        >
          <Icon name="faster" size={16} />
        </button>
      </div>

      <time className="sd-time__date sd-mono" dateTime={date}>
        <span>{date}</span>
        <span className="sd-time__clock">{clock}</span>
      </time>

      <button
        type="button"
        className="sd-iconbtn sd-time__now"
        aria-label="Set the clock to now"
        title="Back to now"
        onClick={() => requestTime(simDaysNow())}
      >
        <Icon name="now" size={18} />
        <span className="sd-time__now-text">Now</span>
      </button>
    </section>
  );
}
