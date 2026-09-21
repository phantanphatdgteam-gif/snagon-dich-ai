/**
 * The only console wrapper in the codebase (CLAUDE.md §4). Prefix keeps SW/popup/content
 * logs searchable.
 */
export interface Log {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLog(scope: string): Log {
  const prefix = `[snagon:${scope}]`;
  return {
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
