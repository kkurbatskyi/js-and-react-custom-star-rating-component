import { describe, expect, it } from 'vitest';
import { DEFAULT_GALAXY_SEED } from '../universe';
import { formatDeepLink, parseDeepLink } from './deepLink';

describe('deep links', () => {
  it('parses bare star, planet and moon ids', () => {
    expect(parseDeepLink('#1.399.0.-276.0')).toEqual({
      seed: null,
      target: { kind: 'star', id: '1.399.0.-276.0' },
    });
    expect(parseDeepLink('8.-2.113.7.4.c')?.target).toEqual({
      kind: 'planet',
      id: '8.-2.113.7.4.c',
    });
    expect(parseDeepLink('#1.399.0.-276.0.d.1')?.target).toEqual({
      kind: 'moon',
      id: '1.399.0.-276.0.d.1',
    });
  });

  it('parses a seed prefix', () => {
    expect(parseDeepLink('#42~1.2.3.4.5')).toEqual({
      seed: 42,
      target: { kind: 'star', id: '1.2.3.4.5' },
    });
  });

  it('rejects malformed tokens', () => {
    for (const bad of [
      '',
      '#',
      '#hello',
      '#1.2.3',
      '#x~1.2.3.4.5',
      '#01~1.2.3.4.5',
      '#1.2.3.4.5.A',
    ])
      expect(parseDeepLink(bad)).toBeNull();
  });

  it('formats with a seed prefix only off the default seed', () => {
    const t = { kind: 'planet', id: '1.399.0.-276.0.d' } as const;
    expect(formatDeepLink(t, DEFAULT_GALAXY_SEED)).toBe('1.399.0.-276.0.d');
    expect(formatDeepLink(t, 7)).toBe('7~1.399.0.-276.0.d');
    expect(formatDeepLink({ kind: 'galaxy', centerLy: [0, 0, 0] }, 7)).toBe('');
    expect(formatDeepLink(null, 7)).toBe('');
  });

  it('round-trips', () => {
    const token = formatDeepLink({ kind: 'moon', id: '3.101.-1.14.7.f.2' }, 99);
    expect(parseDeepLink(`#${token}`)).toEqual({
      seed: 99,
      target: { kind: 'moon', id: '3.101.-1.14.7.f.2' },
    });
  });
});
