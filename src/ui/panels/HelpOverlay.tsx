/** Controls and shortcuts, plus the origin story. */
import { useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { modKeyLabel } from '../hooks';
import { closePanels } from '../lib/panels';
import './dialogs.css';

interface Row {
  keys: string[];
  what: string;
}

const Keys = ({ keys }: { keys: string[] }) => (
  <span className="sd-help__keys">
    {keys.map((k) => (
      <span key={k} className="sd-kbd">
        {k}
      </span>
    ))}
  </span>
);

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="sd-dialog__section">
      <h3 className="sd-heading">{title}</h3>
      <dl className="sd-help__table">
        {rows.map((r) => (
          <div key={r.what}>
            <dt>
              <Keys keys={r.keys} />
            </dt>
            <dd>{r.what}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HelpOverlay() {
  const open = useStore((s) => s.ui.open.help);
  if (!open) return null;
  const mod = modKeyLabel();
  const pointer: Row[] = [
    { keys: ['Drag'], what: 'Orbit the thing you are looking at' },
    { keys: ['Scroll', 'Pinch'], what: 'Zoom, from galaxy to cloud tops' },
    { keys: ['Right-drag', '2 fingers'], what: 'Pan across the galaxy' },
    { keys: ['Click'], what: 'Inspect a star or planet' },
    { keys: ['Double-click'], what: 'Travel there' },
    { keys: ['Esc'], what: 'Up one level (moon, planet, star, galaxy)' },
  ];
  const keyboard: Row[] = [
    { keys: [mod, 'K'], what: 'Search (also “/”)' },
    { keys: ['←', '↑', '↓', '→'], what: 'Orbit (W A S D too)' },
    { keys: ['+', '−'], what: 'Zoom' },
    { keys: ['F'], what: 'Fly to the selection' },
    { keys: ['Space'], what: 'Pause or resume time' },
    { keys: ['[', ']'], what: 'Slower, faster' },
    { keys: ['L'], what: 'Logbook' },
    { keys: ['M'], what: 'Mute or unmute' },
    { keys: ['H'], what: 'Photo mode (H or Esc leaves it)' },
    { keys: ['?'], what: 'This page' },
  ];
  return (
    <Modal onClose={() => closePanels()} labelledBy="sd-help-title" className="sd-help">
      <header className="sd-dialog__head">
        <div>
          <p className="sd-eyebrow">Field guide</p>
          <h2 id="sd-help-title" className="sd-dialog__title">
            Controls &amp; shortcuts
          </h2>
        </div>
        <button
          type="button"
          className="sd-iconbtn"
          aria-label="Close help"
          onClick={() => closePanels()}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="sd-dialog__body sd-help__cols">
        <Table title="Mouse & touch" rows={pointer} />
        <Table title="Keyboard" rows={keyboard} />
      </div>
      <footer className="sd-help__foot">
        <p>
          Every star is generated from a seed and stays where it is; the same star has the same
          planets, the same name and the same rating page every time you come back. No images, no
          audio files: every pixel and every note is computed.
        </p>
        <p className="sd-help__wink">
          This used to be a star-rating component. It now rates actual stars.
        </p>
      </footer>
    </Modal>
  );
}
