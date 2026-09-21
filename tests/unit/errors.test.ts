import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  SnagonError,
  isAbortError,
  isErrorCode,
  isSnagonError,
  mapFetchError,
  mapHttpError,
} from '../../src/lib/errors.ts';

describe('error codes', () => {
  it('has exactly the nine codes of spec §7.5 plus E_OUTPUT', () => {
    expect([...ERROR_CODES]).toEqual([
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
    ]);
    expect(isErrorCode('E_CORS')).toBe(true);
    expect(isErrorCode('E_NOPE')).toBe(false);
  });

  it('SnagonError carries code, message and detail', () => {
    const err = new SnagonError('E_TRUNC', 'cut by num_predict', 'done_reason=length');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SnagonError');
    expect(err.code).toBe('E_TRUNC');
    expect(err.message).toBe('cut by num_predict');
    expect(err.detail).toBe('done_reason=length');
    expect(new SnagonError('E_DOWN').message).toBe('E_DOWN');
    expect(isSnagonError(err)).toBe(true);
    expect(isSnagonError(new Error('x'))).toBe(false);
  });
});

describe('mapHttpError (spec §7.5)', () => {
  it.each([
    [403, '', 'E_CORS'],
    [404, '{"error":"model \'x\' not found"}', 'E_MODEL'],
    [503, '', 'E_BUSY'],
    [500, '{"error":"model requires more system memory"}', 'E_OOM'],
    [500, '{"error":"boom"}', 'E_BADREQ'],
    [400, '{"error":"does not support thinking"}', 'E_BADREQ'],
    [418, '', 'E_BADREQ'],
  ])('maps HTTP %i with body %j to %s', (status, body, code) => {
    const err = mapHttpError(status, body);
    expect(err).toBeInstanceOf(SnagonError);
    expect(err.code).toBe(code);
    expect(err.detail).toBe(body);
  });

  it('truncates detail to 500 chars', () => {
    expect(mapHttpError(503, 'x'.repeat(900)).detail).toHaveLength(500);
  });
});

describe('mapFetchError', () => {
  it('maps a fetch TypeError (connection refused) to E_DOWN', () => {
    const err = mapFetchError(new TypeError('fetch failed'));
    expect(isSnagonError(err) && err.code).toBe('E_DOWN');
  });

  it('passes AbortError and SnagonError through unchanged', () => {
    const abort = new DOMException('The operation was aborted', 'AbortError');
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(mapFetchError(abort)).toBe(abort);
    const own = new SnagonError('E_TRUNC');
    expect(mapFetchError(own)).toBe(own);
  });

  it('wraps non-Error values', () => {
    expect(mapFetchError('boom')).toBeInstanceOf(Error);
    expect(mapFetchError('boom').message).toBe('boom');
  });
});
