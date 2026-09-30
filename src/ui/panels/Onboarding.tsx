/** First visit only: three tips and the origin story. Dismissal persists (store → localStorage). */
import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { Icon, type IconName } from '../components/Icon';
import './overlays.css';

const isTouch = (): boolean => {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};

export function Onboarding() {
  const ready = useStore((s) => s.ready);
  const seen = useStore((s) => s.ui.onboardingSeen);
  const dismiss = useStore((s) => s.dismissOnboarding);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!ready || seen) return;
    const t = window.setTimeout(() => setArmed(true), 1100);
    return () => window.clearTimeout(t);
  }, [ready, seen]);

  if (!ready || seen || !armed) return null;
  const touch = isTouch();
  const tips: { icon: IconName; title: string; body: string }[] = [
    {
      icon: 'orbit',
      title: 'Drag to orbit',
      body: touch ? 'Two fingers pan across the galaxy.' : 'Right-drag pans across the galaxy.',
    },
    {
      icon: 'pinch',
      title: touch ? 'Pinch to zoom' : 'Scroll to zoom',
      body: 'From the whole spiral to a planet’s cloud tops.',
    },
    {
      icon: 'pointer',
      title: touch ? 'Tap to inspect' : 'Click to inspect',
      body: touch ? 'Double-tap to travel there.' : 'Double-click to travel there.',
    },
  ];
  return (
    <aside
      className="sd-note sd-panel sd-ticked"
      role="dialog"
      aria-labelledby="sd-note-title"
      aria-modal="false"
    >
      <header className="sd-note__head">
        <div>
          <p className="sd-eyebrow">Field notes</p>
          <h2 id="sd-note-title" className="sd-note__title">
            Three things to know
          </h2>
        </div>
        <button
          type="button"
          className="sd-iconbtn"
          aria-label="Dismiss field notes"
          onClick={dismiss}
        >
          <Icon name="close" size={17} />
        </button>
      </header>
      <ul className="sd-note__tips">
        {tips.map((t) => (
          <li key={t.title}>
            <span className="sd-note__icon">
              <Icon name={t.icon} size={22} />
            </span>
            <span>
              <strong>{t.title}</strong>
              <span>{t.body}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="sd-note__wink">
        This used to be a star-rating component. It now rates actual stars: open any star or planet
        and give it some.
      </p>
      <button
        type="button"
        className="sd-btn sd-btn--primary sd-note__go"
        onClick={dismiss}
        data-autofocus
      >
        Begin exploring
      </button>
    </aside>
  );
}
