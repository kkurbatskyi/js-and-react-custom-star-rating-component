/**
 * Tiny levelled logger — the only sanctioned way to write to the console (docs/ARCHITECTURE.md §12).
 *
 * Levels: debug < info < warn < error. By default production shows warn+error, the dev server
 * also shows info, and tests stay quiet below warn. Debug output is enabled by `?debug` in the
 * page URL or by the persisted flag `localStorage['sidereal:debug'] = '1'` (`setDebugEnabled`).
 * Storage and location access are wrapped in try/catch: sandboxed hosts may throw on access.
 *
 * Disabled calls cost one comparison, but arguments are still evaluated (and rest parameters
 * allocate) — don't log inside per-frame hot paths.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Logger with a nested scope: `log.child('flight')` prints "[sidereal/flight]". */
  child(scope: string): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const STORAGE_KEY = 'sidereal:debug';

let debugFlag: boolean | null = null;
let thresholdOverride: LogLevel | null = null;

function readEnv(): { DEV?: boolean; MODE?: string } {
  try {
    return (import.meta as ImportMeta & { env?: { DEV?: boolean; MODE?: string } }).env ?? {};
  } catch {
    return {};
  }
}

function detectDebug(): boolean {
  try {
    const search = globalThis.location?.search;
    if (search && new URLSearchParams(search).has('debug')) return true;
  } catch {
    // location unavailable (worker/sandbox) — fall through
  }
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when debug logging is on (URL `?debug` or the persisted flag). */
export function isDebugEnabled(): boolean {
  if (debugFlag === null) debugFlag = detectDebug();
  return debugFlag;
}

/** Turn debug logging on/off for this session and (by default) persist the choice. */
export function setDebugEnabled(on: boolean, persist = true): void {
  debugFlag = on;
  if (!persist) return;
  try {
    if (on) globalThis.localStorage?.setItem(STORAGE_KEY, '1');
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked — the in-memory flag still applies
  }
}

/** Force a minimum level (null restores the automatic default). */
export function setLogLevel(level: LogLevel | null): void {
  thresholdOverride = level;
}

function threshold(): number {
  if (thresholdOverride) return LEVELS[thresholdOverride];
  if (isDebugEnabled()) return LEVELS.debug;
  const env = readEnv();
  return env.DEV && env.MODE !== 'test' ? LEVELS.info : LEVELS.warn;
}

const STYLE: Record<LogLevel, string> = {
  debug: 'color:#8a93a6',
  info: 'color:#7fb2ff',
  warn: 'color:#e8b04a',
  error: 'color:#ff6b6b',
};

/** Create a scoped logger. */
export function createLogger(scope: string): Logger {
  const prefix = `%c[${scope}]`;
  const emit = (level: LogLevel, args: unknown[]): void => {
    if (LEVELS[level] < threshold()) return;
    // console.debug is hidden by default in Chromium ("Verbose"), so debug/info use console.log.
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(prefix, STYLE[level], ...args);
  };
  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    child: (sub) => createLogger(`${scope}/${sub}`),
  };
}

/** The root logger. Prefer `log.child('module')` in modules. */
export const log: Logger = createLogger('sidereal');
