/**
 * Top bar: wordmark, breadcrumbs (Galaxy › Star › Planet › Moon — each a way back up; while flying
 * they name the destination), and the instrument buttons: search, logbook, settings, sound, help.
 */
import { useMemo } from 'react';
import { useStore } from '../../state/store';
import { Icon, LogoMark } from '../components/Icon';
import { modKeyLabel, useUniverse } from '../hooks';
import { goToTarget } from '../lib/actions';
import { buildCrumbs } from '../lib/model';
import { togglePanel } from '../lib/panels';
import './topbar.css';

function PanelButton({
  panel,
  icon,
  label,
  className,
}: {
  panel: 'logbook' | 'settings' | 'help';
  icon: 'book' | 'sliders' | 'help';
  label: string;
  className?: string;
}) {
  const open = useStore((s) => s.ui.open[panel]);
  return (
    <button
      type="button"
      className={`sd-iconbtn${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      title={label}
      onClick={() => togglePanel(panel)}
    >
      <Icon name={icon} size={19} />
    </button>
  );
}

export function TopBar() {
  const universe = useUniverse();
  const focus = useStore((s) => s.focus);
  const flightTarget = useStore((s) => s.flightTarget);
  const progress = useStore((s) => s.flightProgress);
  const audio = useStore((s) => s.settings.audio);
  const update = useStore((s) => s.updateSettings);
  const searchOpen = useStore((s) => s.ui.open.search);

  const flying = flightTarget !== null && progress !== null;
  const destination = flightTarget ?? focus;
  const crumbs = useMemo(() => buildCrumbs(destination, universe), [destination, universe]);

  return (
    <header className="sd-topbar">
      <div className="sd-topbar__brand">
        <LogoMark size={26} />
        <h1 className="sd-wordmark">Sidereal</h1>
      </div>

      <nav className="sd-crumbs" aria-label="Location">
        <ol>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={c.key} className={last ? 'is-current' : undefined}>
                {i > 0 && <Icon name="crumb" size={12} className="sd-crumbs__sep" />}
                {last ? (
                  <span className="sd-crumbs__here" aria-current="location">
                    {flying && <span className="sd-crumbs__en-route">En route to</span>}
                    {c.label}
                  </span>
                ) : (
                  <button type="button" className="sd-crumbs__link" onClick={() => goToTarget(c.target)}>
                    {c.label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="sd-topbar__actions">
        <button
          type="button"
          className="sd-searchbtn"
          aria-label="Search stars and worlds"
          aria-expanded={searchOpen}
          aria-haspopup="dialog"
          onClick={() => togglePanel('search')}
        >
          <Icon name="search" size={17} />
          <span className="sd-searchbtn__text">Search stars &amp; worlds</span>
          <kbd className="sd-kbd">{modKeyLabel()} K</kbd>
        </button>
        <PanelButton panel="logbook" icon="book" label="Logbook" />
        <PanelButton panel="settings" icon="sliders" label="Settings" />
        <button
          type="button"
          className="sd-iconbtn"
          aria-pressed={audio}
          aria-label={audio ? 'Turn sound off' : 'Turn sound on'}
          title={audio ? 'Sound on' : 'Sound off'}
          onClick={() => update({ audio: !audio })}
        >
          <Icon name={audio ? 'sound' : 'mute'} size={19} />
        </button>
        <PanelButton panel="help" icon="help" label="Help and shortcuts" className="sd-topbar__help" />
      </div>

      {flying && progress !== null && (
        <div className="sd-topbar__flight" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
      )}
    </header>
  );
}
