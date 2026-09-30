/** Camera buttons: zoom, reset view, up a level, photo mode. Zoom is animated by the engine. */
import { engineCommands } from '../../state/bridge';
import { useStore } from '../../state/store';
import { Icon, type IconName } from '../components/Icon';
import './hud.css';

const Btn = ({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) => (
  <button type="button" className="sd-iconbtn" aria-label={label} title={label} onClick={onClick}>
    <Icon name={icon} size={18} />
  </button>
);

export function ViewControls() {
  const goUp = useStore((s) => s.goUp);
  const setPhotoMode = useStore((s) => s.setPhotoMode);
  return (
    <div
      className="sd-viewctl sd-panel"
      role="toolbar"
      aria-label="Camera"
      aria-orientation="vertical"
    >
      <Btn icon="plus" label="Zoom in" onClick={() => engineCommands().zoomBy(0.5)} />
      <Btn icon="minus" label="Zoom out" onClick={() => engineCommands().zoomBy(2)} />
      <span className="sd-viewctl__sep" />
      <Btn icon="reset" label="Reset view" onClick={() => engineCommands().resetView()} />
      <Btn icon="up" label="Up a level" onClick={goUp} />
      <span className="sd-viewctl__sep" />
      <Btn icon="camera" label="Photo mode" onClick={() => setPhotoMode(true)} />
    </div>
  );
}
