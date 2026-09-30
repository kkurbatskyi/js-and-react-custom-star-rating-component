/**
 * "Copy link": writes the deep link to the clipboard; when the host blocks the clipboard it shows the
 * link pre-selected instead (never `alert()`).
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { copyText, deepLinkUrl, formatToken } from '../lib/links';
import { Icon } from './Icon';
import './parts.css';

interface Props {
  id: string;
  name: string;
  className?: string;
}

export function CopyLinkButton({ id, name, className }: Props) {
  const seed = useStore((s) => s.settings.galaxySeed);
  const pushToast = useStore((s) => s.pushToast);
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const input = useRef<HTMLInputElement>(null);
  const url = deepLinkUrl(formatToken(seed, id));

  useEffect(() => setState('idle'), [id]);
  useEffect(() => {
    if (state === 'manual') input.current?.select();
    if (state !== 'copied') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    const result = await copyText(url);
    if (result === 'copied') {
      setState('copied');
      pushToast({ text: 'Link copied', sub: `Anyone who opens it lands at ${name}.`, tone: 'success' });
    } else {
      setState('manual');
    }
  };

  if (state === 'manual') {
    return (
      <div className="sd-copy-manual">
        <input
          ref={input}
          readOnly
          value={url}
          aria-label={`Link to ${name} — select and copy`}
          onFocus={(e) => e.currentTarget.select()}
          className="sd-mono"
        />
        <button type="button" className="sd-iconbtn" aria-label="Done" onClick={() => setState('idle')}>
          <Icon name="check" />
        </button>
      </div>
    );
  }
  return (
    <button type="button" className={`sd-btn ${className ?? ''}`} onClick={copy}>
      <Icon name={state === 'copied' ? 'check' : 'link'} size={15} />
      {state === 'copied' ? 'Copied' : 'Copy link'}
    </button>
  );
}
