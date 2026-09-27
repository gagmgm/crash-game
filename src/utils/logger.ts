type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const DEDUPE_WINDOW_MS = 5000;

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * Scoped console logger. Repeated identical warnings are suppressed for a few seconds
 * so a misbehaving stream (e.g. malformed messages every tick) can't flood the console.
 */
export function createLogger(scope: string, minLevel: Level = defaultLevel()): Logger {
  const lastSeen = new Map<string, number>();

  const log = (level: Level, message: string, data?: unknown) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    if (level === 'warn' || level === 'error') {
      const key = `${level}:${message}`;
      const now = Date.now();
      const previous = lastSeen.get(key);
      if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return;
      lastSeen.set(key, now);
      if (lastSeen.size > 200) lastSeen.clear();
    }
    const line = `[${scope}] ${message}`;
    const args = data === undefined ? [line] : [line, data];
    // eslint-disable-next-line no-console -- the logger is the one sanctioned console sink
    console[level](...args);
  };

  return {
    debug: (m, d) => log('debug', m, d),
    info: (m, d) => log('info', m, d),
    warn: (m, d) => log('warn', m, d),
    error: (m, d) => log('error', m, d),
  };
}

function defaultLevel(): Level {
  if (import.meta.env.MODE === 'test') return 'error';
  return import.meta.env.DEV ? 'info' : 'warn';
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
