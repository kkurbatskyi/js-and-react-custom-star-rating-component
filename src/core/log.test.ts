import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, isDebugEnabled, log, setDebugEnabled, setLogLevel } from './log';

afterEach(() => {
  setLogLevel(null);
  setDebugEnabled(false, false);
  vi.restoreAllMocks();
});

describe('log', () => {
  it('stays quiet below warn by default under test', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const l = createLogger('quiet');
    l.debug('no');
    l.info('no');
    l.warn('yes');
    expect(out).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('%c[quiet]', expect.any(String), 'yes');
  });

  it('honours an explicit level and the debug flag', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const l = createLogger('lvl');
    setLogLevel('error');
    l.warn('hidden');
    l.error('shown', 42);
    expect(err).toHaveBeenCalledWith('%c[lvl]', expect.any(String), 'shown', 42);
    setLogLevel(null);
    setDebugEnabled(true, false);
    expect(isDebugEnabled()).toBe(true);
    l.debug('now visible');
    expect(out).toHaveBeenCalledWith('%c[lvl]', expect.any(String), 'now visible');
  });

  it('child loggers nest their scope', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLogLevel('debug');
    log.child('flight').child('path').info('hi');
    expect(out).toHaveBeenCalledWith('%c[sidereal/flight/path]', expect.any(String), 'hi');
  });

  it('survives missing or throwing storage', () => {
    expect(() => setDebugEnabled(true)).not.toThrow();
    expect(() => setDebugEnabled(false)).not.toThrow();
  });
});
