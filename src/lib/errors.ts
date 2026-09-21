export const ERROR_CODES = [
  'E_DOWN',
  'E_CORS',
  'E_MODEL',
  'E_BUSY',
  'E_OOM',
  'E_TIMEOUT',
  'E_TRUNC',
  'E_BADREQ',
  'E_PERM',
  'E_OUTPUT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Every provider/protocol failure is one of these. `message` is for logs (English);
 * `detail` is raw context (HTTP body, timeout kind); user-facing text lives in src/locales/vi.ts.
 */
export class SnagonError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message?: string, detail?: string) {
    super(message ?? code);
    this.name = 'SnagonError';
    this.code = code;
    this.detail = detail;
  }
}

export function isSnagonError(value: unknown): value is SnagonError {
  return value instanceof SnagonError;
}

/** fetch() rejects with a DOMException named AbortError when its signal aborts (browser and Node). */
export function isAbortError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'AbortError'
  );
}

/** `detail` is bounded so a huge HTML error page cannot bloat a log line or a stored job. */
const DETAIL_MAX_LENGTH = 500;

/** Spec §7.5: HTTP status → error code. `body` is the response text; its first 500 chars become `detail`. */
export function mapHttpError(status: number, body: string): SnagonError {
  const detail = body.slice(0, DETAIL_MAX_LENGTH);
  if (status === 403) {
    return new SnagonError('E_CORS', 'Ollama rejected the extension origin (HTTP 403)', detail);
  }
  if (status === 404) return new SnagonError('E_MODEL', 'model not found (HTTP 404)', detail);
  if (status === 503) return new SnagonError('E_BUSY', 'Ollama is busy (HTTP 503)', detail);
  if (status === 500 && /memory/i.test(body)) {
    return new SnagonError('E_OOM', 'Ollama ran out of memory (HTTP 500)', detail);
  }
  if (status === 400) {
    return new SnagonError('E_BADREQ', 'Ollama rejected the request (HTTP 400)', detail);
  }
  return new SnagonError('E_BADREQ', `unexpected HTTP ${status}`, detail);
}

/** Network-level failures: a TypeError from fetch means connection refused → E_DOWN. Abort and SnagonError pass through. */
export function mapFetchError(error: unknown): Error {
  if (error instanceof SnagonError) return error;
  if (isAbortError(error)) return error as Error;
  if (error instanceof TypeError) {
    return new SnagonError(
      'E_DOWN',
      'cannot reach Ollama (connection refused)',
      error.message.slice(0, DETAIL_MAX_LENGTH),
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
