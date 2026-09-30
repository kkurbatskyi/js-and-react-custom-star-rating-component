/**
 * Photo mode: every other piece of interface is unmounted (App), leaving a shutter and a way out.
 * Capture asks the engine for a PNG and shows it in an in-page preview with a download link — hosts
 * may block downloads, so the preview itself (right-click / long-press to save) has to be enough.
 * H or Esc leaves (handled globally so the engine's Esc never double-fires).
 */
import { useEffect, useRef, useState } from 'react';
import { engineCommands } from '../../state/bridge';
import { useStore } from '../../state/store';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useObject, useUniverse } from '../hooks';
import { objectName, selectionForTarget } from '../lib/model';
import { usePhotoStore } from '../lib/photoStore';
import './overlays.css';

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase() || 'view';

const stamp = (t: number) =>
  new Date(t)
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, '')
    .replace(/^(\d{8})/, '$1-');

const canCopyImage = (): boolean =>
  typeof ClipboardItem !== 'undefined' && !!navigator.clipboard && 'write' in navigator.clipboard;

export function PhotoMode() {
  const setPhotoMode = useStore((s) => s.setPhotoMode);
  const pushToast = useStore((s) => s.pushToast);
  const focus = useStore((s) => s.focus);
  const universe = useUniverse();
  const model = useObject(selectionForTarget(focus));
  const shot = usePhotoStore((s) => s.shot);
  const setShot = usePhotoStore((s) => s.setShot);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(0);
  const [hintVisible, setHintVisible] = useState(true);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const subject = model ? objectName(model) : universe.galaxy.params.name;

  // The exit hint fades after a few idle seconds and wakes on pointer movement.
  useEffect(() => {
    const wake = () => {
      setHintVisible(true);
      clearTimeout(idle.current);
      idle.current = setTimeout(() => setHintVisible(false), 3200);
    };
    wake();
    window.addEventListener('pointermove', wake, { passive: true });
    return () => {
      window.removeEventListener('pointermove', wake);
      clearTimeout(idle.current);
    };
  }, []);

  useEffect(() => () => usePhotoStore.getState().setShot(null), []);

  const capture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await engineCommands().capture();
      setFlash((n) => n + 1);
      if (!blob) {
        pushToast({
          text: 'Could not capture this view',
          sub: 'This browser would not hand over the frame. A screenshot will do.',
          tone: 'warning',
        });
        return;
      }
      setShot({ url: URL.createObjectURL(blob), name: subject, takenAt: Date.now() });
    } catch {
      pushToast({ text: 'Could not capture this view', tone: 'warning' });
    } finally {
      setBusy(false);
    }
  };

  const copyImage = async () => {
    if (!shot) return;
    try {
      const blob = await (await fetch(shot.url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
      pushToast({ text: 'Image copied', tone: 'success' });
    } catch {
      pushToast({
        text: 'The clipboard would not take the image',
        sub: 'Right-click or long-press the picture to save it.',
        tone: 'warning',
      });
    }
  };

  return (
    <div className="sd-photo" data-sd-interactive>
      {flash > 0 && <div key={flash} className="sd-photo__flash" aria-hidden="true" />}
      <button
        type="button"
        className={`sd-photo__exit sd-btn${hintVisible ? ' is-visible' : ''}`}
        onClick={() => setPhotoMode(false)}
      >
        <Icon name="close" size={14} />
        Exit photo mode
        <span className="sd-kbd">H</span>
      </button>
      <button
        type="button"
        className="sd-photo__shutter"
        aria-label={busy ? 'Capturing…' : `Take a photo of ${subject}`}
        aria-busy={busy}
        onClick={capture}
        disabled={busy}
      >
        <span />
      </button>

      {shot && (
        <Modal onClose={() => setShot(null)} labelledBy="sd-shot-title" className="sd-shot">
          <header className="sd-dialog__head">
            <div>
              <p className="sd-eyebrow">
                Photo · {new Date(shot.takenAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
              </p>
              <h2 id="sd-shot-title" className="sd-dialog__title">
                {shot.name}
              </h2>
            </div>
            <button
              type="button"
              className="sd-iconbtn"
              aria-label="Close preview"
              onClick={() => setShot(null)}
            >
              <Icon name="close" size={18} />
            </button>
          </header>
          <figure className="sd-shot__figure">
            <img src={shot.url} alt={`Captured view of ${shot.name}`} />
          </figure>
          <div className="sd-shot__actions">
            <a
              className="sd-btn sd-btn--primary"
              href={shot.url}
              download={`sidereal-${slug(shot.name)}-${stamp(shot.takenAt)}.png`}
              data-autofocus
            >
              <Icon name="download" size={15} />
              Download PNG
            </a>
            {canCopyImage() && (
              <button type="button" className="sd-btn" onClick={copyImage}>
                <Icon name="copy" size={15} />
                Copy image
              </button>
            )}
            <button type="button" className="sd-btn sd-btn--quiet" onClick={() => setShot(null)}>
              Keep framing
            </button>
          </div>
          <p className="sd-shot__note">
            If the download is blocked here, right-click (or long-press) the picture and save it.
          </p>
        </Modal>
      )}
    </div>
  );
}
