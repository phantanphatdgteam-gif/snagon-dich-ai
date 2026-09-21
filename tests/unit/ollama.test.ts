import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnagonError } from '../../src/lib/errors.ts';
import {
  DEFAULT_OLLAMA_URL,
  DEFAULT_TIMEOUTS,
  createOllamaProvider,
  type FetchLike,
} from '../../src/lib/provider/ollama.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function providerWith(fetchFn: FetchLike) {
  return createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434/', fetch: fetchFn });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof SnagonError ? error.code : `not a SnagonError: ${String(error)}`;
  }
}

/** `E_*:detail` for a SnagonError, the DOMException name for an abort, 'resolved' when it does not reject. */
async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    if (error instanceof SnagonError) return `${error.code}:${error.detail ?? ''}`;
    return error instanceof Error ? error.name : String(error);
  }
}

/** Ollama accepts the connection and never answers: the fetch settles only when its signal aborts. */
function hangingFetch(): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted', 'AbortError')),
          { once: true },
        );
      }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createOllamaProvider — constants', () => {
  it('defaults to 127.0.0.1:11434 and spec §7.3 timeouts', () => {
    expect(DEFAULT_OLLAMA_URL).toBe('http://127.0.0.1:11434');
    expect(DEFAULT_TIMEOUTS).toEqual({
      ttftMs: 60_000,
      idleMs: 20_000,
      totalMs: 150_000,
      metadataMs: 10_000,
    });
  });
});

describe('createOllamaProvider — metadata deadlines', () => {
  it('version() gives up with E_TIMEOUT naming the path when Ollama never answers', async () => {
    vi.useFakeTimers();
    const pending = errorOf(providerWith(hangingFetch()).version());
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUTS.metadataMs);
    expect(await pending).toBe('E_TIMEOUT:/api/version');
  });

  it.each([
    ['listModels', '/api/tags'],
    ['loaded', '/api/ps'],
    ['describe', '/api/show'],
  ] as const)('%s() gives up with E_TIMEOUT on %s', async (method, path) => {
    vi.useFakeTimers();
    const provider = providerWith(hangingFetch());
    const call = method === 'describe' ? provider.describe('gemma4:26b') : provider[method]();
    const pending = errorOf(call);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUTS.metadataMs);
    expect(await pending).toBe(`E_TIMEOUT:${path}`);
  });

  it('the deadline is configurable like the stream timeouts', async () => {
    vi.useFakeTimers();
    const provider = createOllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      fetch: hangingFetch(),
      timeouts: { metadataMs: 500 },
    });
    const pending = errorOf(provider.version());
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBe('E_TIMEOUT:/api/version');
  });

  // Loading a 19 GB model is not a fault: warm-up keeps the cold-load budget (spec §7.3), not 10 s.
  it('warmUp() outlives the metadata budget and times out on the TTFT one', async () => {
    vi.useFakeTimers();
    const pending = errorOf(providerWith(hangingFetch()).warmUp('gemma4:26b'));
    let settled = false;
    void pending.then(() => (settled = true));

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUTS.metadataMs);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUTS.ttftMs);
    expect(await pending).toBe('E_TIMEOUT:/api/chat');
  });

  it('warmUp() still rejects through the caller signal, not the deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = errorOf(providerWith(hangingFetch()).warmUp('gemma4:26b', controller.signal));

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();

    expect(await pending).toBe('AbortError');
  });
});

describe('createOllamaProvider — status endpoints', () => {
  it('version() GETs /api/version (trailing slash of baseUrl is trimmed)', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse({ version: '0.34.2' }));
    await expect(providerWith(fetchFn).version()).resolves.toBe('0.34.2');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/version',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('listModels() maps /api/tags to ModelInfo', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        models: [
          {
            name: 'translategemma:12b',
            model: 'translategemma:12b',
            size: 8_100_000_000,
            modified_at: '2026-09-21T15:49:41+07:00',
            details: { family: 'gemma3', context_length: 131072 },
          },
        ],
      }),
    );
    await expect(providerWith(fetchFn).listModels()).resolves.toEqual([
      {
        name: 'translategemma:12b',
        size: 8_100_000_000,
        family: 'gemma3',
        modifiedAt: '2026-09-21T15:49:41+07:00',
      },
    ]);
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.anything());
  });

  it('describe() POSTs /api/show and derives context length + profile', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        capabilities: ['completion', 'vision'],
        details: { family: 'gemma3' },
        model_info: { 'general.architecture': 'gemma3', 'gemma3.context_length': 131072 },
        template: '{{ .Prompt }}',
      }),
    );
    await expect(providerWith(fetchFn).describe('translategemma:12b')).resolves.toEqual({
      name: 'translategemma:12b',
      family: 'gemma3',
      capabilities: ['completion', 'vision'],
      contextLength: 131072,
      profile: 'translategemma',
    });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:11434/api/show');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'translategemma:12b' });
  });

  it('describe() falls back to null context length and profile B for unknown shapes', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({ capabilities: ['completion', 'thinking'] }),
    );
    await expect(providerWith(fetchFn).describe('gemma4:26b')).resolves.toEqual({
      name: 'gemma4:26b',
      family: '',
      capabilities: ['completion', 'thinking'],
      contextLength: null,
      profile: 'instruct-json',
    });
  });

  it('loaded() maps /api/ps', async () => {
    const fetchFn = vi.fn<FetchLike>(async () =>
      jsonResponse({
        models: [
          {
            name: 'gemma4:26b',
            size_vram: 19_000_000_000,
            expires_at: '2026-09-21T18:00:00+07:00',
          },
        ],
      }),
    );
    await expect(providerWith(fetchFn).loaded()).resolves.toEqual([
      { name: 'gemma4:26b', sizeVram: 19_000_000_000, until: '2026-09-21T18:00:00+07:00' },
    ]);
  });

  it('warmUp() POSTs /api/chat without messages, keep_alive 10m, stream false, num_ctx 8192', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse({ done: true, done_reason: 'load' }));
    await providerWith(fetchFn).warmUp('gemma4:26b', new AbortController().signal);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    // Without options.num_ctx Ollama loads the model at its default context and reloads it on
    // the first translate request (spec §7.1, measured 2026-09-21).
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gemma4:26b',
      keep_alive: '10m',
      stream: false,
      options: { num_ctx: 8192 },
    });
    // The fetch runs under a signal of the provider's own (caller abort + deadline are linked into
    // it); that the caller's abort still reaches it is covered in "metadata deadlines".
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('createOllamaProvider — error mapping', () => {
  it.each([
    [403, { error: 'origin not allowed' }, 'E_CORS'],
    [404, { error: "model 'x' not found" }, 'E_MODEL'],
    [503, { error: 'server busy' }, 'E_BUSY'],
    [500, { error: 'model requires more system memory' }, 'E_OOM'],
    [400, { error: 'invalid' }, 'E_BADREQ'],
  ])('HTTP %i → %s', async (status, body, code) => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse(body, status));
    expect(await codeOf(providerWith(fetchFn).version())).toBe(code);
  });

  // A proxy's HTML error page or a truncated body answers 200 with something that is not JSON:
  // the raw SyntaxError from response.json() is neither a SnagonError nor mapped by mapFetchError.
  it('200 with a non-JSON body → E_OUTPUT carrying the start of the body', async () => {
    const fetchFn = vi.fn<FetchLike>(
      async () =>
        new Response('<!doctype html><title>502 Bad Gateway</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    expect(await errorOf(providerWith(fetchFn).version())).toBe(
      'E_OUTPUT:<!doctype html><title>502 Bad Gateway</title>',
    );
  });

  it('connection refused (fetch TypeError) → E_DOWN', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await codeOf(providerWith(fetchFn).listModels())).toBe('E_DOWN');
  });
});
