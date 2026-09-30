/** Toasts from `store.toasts`: auto-dismiss (paused on hover/focus), polite live region. */
import { useEffect } from 'react';
import { useStore } from '../../state/store';
import type { Toast } from '../../state/contracts';
import { Icon } from '../components/Icon';
import './hud.css';

const LIFETIME_MS = 4800;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const t = window.setTimeout(() => dismiss(toast.id), toast.tone === 'warning' ? LIFETIME_MS * 1.5 : LIFETIME_MS);
    return () => window.clearTimeout(t);
  }, [dismiss, toast.id, toast.tone]);
  return (
    <li className={`sd-toast sd-panel sd-toast--${toast.tone}`}>
      <span className="sd-toast__mark" aria-hidden="true">
        <Icon name={toast.tone === 'success' ? 'check' : toast.tone === 'warning' ? 'help' : 'sparkle'} size={14} />
      </span>
      <span className="sd-toast__body">
        <span className="sd-toast__text">{toast.text}</span>
        {toast.sub && <span className="sd-toast__sub">{toast.sub}</span>}
      </span>
      <button type="button" className="sd-iconbtn sd-toast__close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
        <Icon name="close" size={14} />
      </button>
    </li>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <ul className="sd-toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </ul>
  );
}
