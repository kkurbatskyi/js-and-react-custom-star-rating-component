// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDeepLink } from '../../app/deepLink';
import { DEFAULT_GALAXY_SEED } from '../../universe';
import { copyText, deepLinkUrl, formatToken } from './links';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('formatToken', () => {
  it('is the bare id for the default galaxy', () => {
    expect(formatToken(DEFAULT_GALAXY_SEED, '1.399.0.-276.0.d')).toBe('1.399.0.-276.0.d');
  });
  it('prefixes any other seed', () => {
    expect(formatToken(42, '1.399.0.-276.0')).toBe('42~1.399.0.-276.0');
    expect(formatToken(-1, '8.0.0.0.0')).toBe('4294967295~8.0.0.0.0');
  });
  it('only uses characters that survive the hosting sandbox', () => {
    expect(formatToken(7, '0.-12.3.4.5.c.2')).toMatch(/^[A-Za-z0-9._~-]+$/);
  });
});

describe('formatToken vs the engine', () => {
  it('spells exactly what the app writes to location.hash', () => {
    for (const seed of [DEFAULT_GALAXY_SEED, 1, 4_000_000_000]) {
      for (const id of ['1.399.0.-276.0', '1.399.0.-276.0.d', '1.399.0.-276.0.f.3']) {
        const kind =
          id.split('.').length === 5 ? 'star' : id.split('.').length === 6 ? 'planet' : 'moon';
        expect(formatToken(seed, id)).toBe(formatDeepLink({ kind, id }, seed));
      }
    }
  });
});

describe('deepLinkUrl', () => {
  it('keeps the page and swaps the hash', () => {
    const url = deepLinkUrl('42~1.2.3.4.5');
    expect(url.endsWith('#42~1.2.3.4.5')).toBe(true);
    expect(url.startsWith('http')).toBe(true);
  });
});

describe('copyText', () => {
  it('uses the async clipboard when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('hello')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the clipboard rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    await expect(copyText('hello')).resolves.toBe('copied');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull(); // cleaned up
  });

  it('reports failure so the UI can show the text pre-selected', async () => {
    vi.stubGlobal('navigator', {});
    document.execCommand = vi.fn().mockReturnValue(false);
    await expect(copyText('hello')).resolves.toBe('failed');
    document.execCommand = vi.fn(() => {
      throw new Error('blocked');
    });
    await expect(copyText('hello')).resolves.toBe('failed');
  });
});
