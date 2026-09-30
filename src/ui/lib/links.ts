/**
 * Deep links and the clipboard.
 *
 * A link is `<page>#<token>` where the token is `[<galaxySeed>~]<id>` (docs/ARCHITECTURE.md §7): the
 * seed is spelled out only when it is not the default galaxy, and only `[A-Za-z0-9._~-]` appear so the
 * token survives the hosting sandbox. `src/universe/ids.ts` will own a `formatToken`; until it lands
 * this is the same grammar, pinned by links.test.ts.
 */
import { DEFAULT_GALAXY_SEED } from '../../universe';

export function formatToken(seed: number, id: string): string {
  return seed >>> 0 === DEFAULT_GALAXY_SEED ? id : `${seed >>> 0}~${id}`;
}

/** Full shareable URL for a token; falls back to the bare `#token` when `location` is unusable. */
export function deepLinkUrl(token: string): string {
  try {
    const url = new URL(window.location.href);
    url.hash = token;
    return url.toString();
  } catch {
    return `#${token}`;
  }
}

export type CopyResult = 'copied' | 'failed';

/**
 * Copy text with the async Clipboard API, then the legacy `execCommand` route. Both can be blocked
 * (sandboxed iframes, insecure origins): the caller then reveals the text pre-selected instead of
 * reaching for `alert()`.
 */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0' });
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}
