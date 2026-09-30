/**
 * Settings: display quality, bloom, labels, orbits, sound + volume, reduced motion, FPS, auto-rotate,
 * and the galaxy seed (a whole new galaxy; ratings and bookmarks are kept per galaxy).
 */
import { type CSSProperties, type ReactNode, useId, useState } from 'react';
import { useStore } from '../../state/store';
import type { QualitySetting } from '../../state/contracts';
import { DEFAULT_GALAXY_SEED, getUniverse } from '../../universe';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useUniverse } from '../hooks';
import { closePanels, openPanel } from '../lib/panels';
import './dialogs.css';

const QUALITIES: readonly { value: QualitySetting; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Adapts to your frame rate' },
  { value: 'low', label: 'Low', hint: 'Phones and old laptops' },
  { value: 'medium', label: 'Medium', hint: 'Integrated graphics' },
  { value: 'high', label: 'High', hint: 'A discrete GPU' },
  { value: 'ultra', label: 'Ultra', hint: 'Because you can' },
];

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="sd-field" htmlFor={id}>
      <span className="sd-field__text">
        <span className="sd-field__label">{label}</span>
        {hint && <span className="sd-field__hint">{hint}</span>}
      </span>
      <input id={id} className="sd-switch" type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="sd-field sd-field--range">
      <label className="sd-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="sd-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--v': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className="sd-mono sd-field__value" htmlFor={id}>
        {format(value)}
      </output>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sd-dialog__section">
      <h3 className="sd-heading">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPanel() {
  const open = useStore((s) => s.ui.open.settings);
  return open ? <SettingsBody /> : null;
}

function SettingsBody() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const pushToast = useStore((s) => s.pushToast);
  const universe = useUniverse();
  const [seedText, setSeedText] = useState(String(settings.galaxySeed));
  const seedValid = /^\d{1,10}$/.test(seedText.trim()) && Number(seedText) <= 0xffffffff;

  const chart = (seed: number) => {
    update({ galaxySeed: seed >>> 0 });
    setSeedText(String(seed >>> 0));
    const name = getUniverse(seed >>> 0).galaxy.params.name;
    pushToast({
      text: `Charted ${name}`,
      sub: 'Your ratings and bookmarks for other galaxies are kept.',
      tone: 'info',
    });
  };

  return (
    <Modal onClose={() => closePanels()} labelledBy="sd-settings-title" className="sd-settings">
      <header className="sd-dialog__head">
        <div>
          <p className="sd-eyebrow">Instrument settings</p>
          <h2 id="sd-settings-title" className="sd-dialog__title">
            Settings
          </h2>
        </div>
        <button type="button" className="sd-iconbtn" aria-label="Close settings" onClick={() => closePanels()}>
          <Icon name="close" size={18} />
        </button>
      </header>

      <div className="sd-dialog__body">
        <Section title="Display">
          <div className="sd-field sd-field--stack">
            <span className="sd-field__label" id="sd-quality-label">
              Quality
            </span>
            <div className="sd-seg" role="radiogroup" aria-labelledby="sd-quality-label">
              {QUALITIES.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.quality === q.value}
                  title={q.hint}
                  className="sd-seg__item"
                  onClick={() => update({ quality: q.value })}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <Range
            label="Bloom"
            value={settings.bloom}
            min={0}
            max={2}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(bloom) => update({ bloom })}
          />
          <Switch label="Labels" hint="Names beside stars and worlds" checked={settings.labels} onChange={(labels) => update({ labels })} />
          <Switch label="Orbits" hint="Draw orbit lines in systems" checked={settings.orbits} onChange={(orbits) => update({ orbits })} />
          <Switch label="Frame rate" hint="Show an FPS readout" checked={settings.showFps} onChange={(showFps) => update({ showFps })} />
        </Section>

        <Section title="Motion">
          <Switch
            label="Reduce motion"
            hint="Calmer transitions in the interface"
            checked={settings.reducedMotion}
            onChange={(reducedMotion) => update({ reducedMotion })}
          />
          <Switch
            label="Auto-rotate"
            hint="Slowly turn the galaxy while idle"
            checked={settings.autoRotate}
            onChange={(autoRotate) => update({ autoRotate })}
          />
        </Section>

        <Section title="Sound">
          <Switch label="Ambient sound" hint="Generated live, no audio files" checked={settings.audio} onChange={(audio) => update({ audio })} />
          <Range
            label="Volume"
            value={settings.volume}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(volume) => update({ volume })}
          />
        </Section>

        <Section title="Help">
          <div className="sd-dialog__row">
            <button type="button" className="sd-btn" onClick={() => openPanel('help')}>
              <Icon name="help" size={15} />
              Controls &amp; shortcuts
            </button>
          </div>
        </Section>

        <Section title="Galaxy">
          <p className="sd-dialog__note">
            You are in <strong>{universe.galaxy.params.name}</strong>, seed{' '}
            <span className="sd-mono">{settings.galaxySeed}</span>. Every seed is a different galaxy; ratings and
            bookmarks belong to the galaxy they were made in.
          </p>
          <form
            className="sd-seedform"
            onSubmit={(e) => {
              e.preventDefault();
              if (seedValid) chart(Number(seedText));
            }}
          >
            <label className="sd-visually-hidden" htmlFor="sd-seed">
              Galaxy seed
            </label>
            <input
              id="sd-seed"
              className="sd-input sd-mono"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={seedText}
              aria-invalid={!seedValid}
              onChange={(e) => setSeedText(e.target.value)}
            />
            <button type="submit" className="sd-btn" disabled={!seedValid || Number(seedText) === settings.galaxySeed}>
              Chart it
            </button>
          </form>
          <div className="sd-dialog__row">
            <button type="button" className="sd-btn sd-btn--primary" onClick={() => chart(Math.floor(Math.random() * 2 ** 32))}>
              <Icon name="sparkle" size={15} />
              New galaxy
            </button>
            <button
              type="button"
              className="sd-btn"
              disabled={settings.galaxySeed === DEFAULT_GALAXY_SEED}
              onClick={() => chart(DEFAULT_GALAXY_SEED)}
            >
              Back to the original
            </button>
          </div>
        </Section>
      </div>
    </Modal>
  );
}
