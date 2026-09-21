import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnagonError } from '../../src/lib/errors.ts';
import { createOllamaProvider, type FetchLike } from '../../src/lib/provider/ollama.ts';
import type { Chunk, TranslateBatch } from '../../src/lib/provider/types.ts';

interface FakeFetchOptions {
  /** Raw body pieces (may split a line). */
  pieces: string[];
  status?: number;
  /** Enqueue only this many pieces and keep the stream open (simulates a stall). */
  stallAfter?: number;
  /** Never resolve the fetch until the signal aborts (simulates no response at all). */
  hang?: boolean;
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

/** A fetch stub that streams `pieces` and errors its body with AbortError when `init.signal` aborts. */
function fakeFetch(options: FakeFetchOptions): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({ url, init });
      const signal = init?.signal;
      if (options.hang) {
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        return;
      }
      const encoder = new TextEncoder();
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          const limit = options.stallAfter ?? options.pieces.length;
          for (const piece of options.pieces.slice(0, limit))
            controller.enqueue(encoder.encode(piece));
          // A stalled stream stays open even when every piece was enqueued.
          if (options.stallAfter === undefined) controller.close();
        },
      });
      signal?.addEventListener(
        'abort',
        () => {
          try {
            streamController?.error(abortError());
          } catch {
            // stream already closed
          }
        },
        { once: true },
      );
      resolve(
        new Response(stream, {
          status: options.status ?? 200,
          headers: { 'content-type': 'application/x-ndjson' },
        }),
      );
    });
  return { fetch, calls };
}

function lines(objects: unknown[]): string {
  return objects.map((object) => JSON.stringify(object)).join('\n') + '\n';
}

const DONE = {
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 40,
  eval_count: 3,
  eval_duration: 100_000_000, // ns → 100 ms
};

function batchA(): TranslateBatch {
  return {
    model: 'translategemma:12b',
    profile: 'translategemma',
    src: 'en',
    tgt: 'vi',
    segments: [{ id: 's1', text: 'Hello world', tokensEst: 4 }],
    context: { title: 'Snagon test', domain: 'example.com' },
  };
}

function batchB(): TranslateBatch {
  return {
    ...batchA(),
    model: 'gemma4:26b',
    profile: 'instruct-json',
    segments: [
      { id: 's1', text: 'Hello', tokensEst: 2 },
      { id: 's2', text: 'Bye', tokensEst: 1 },
    ],
  };
}

async function collect(iterable: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof SnagonError
      ? `${error.code}:${error.detail ?? ''}`
      : `not a SnagonError: ${String(error)}`;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('translate — profile A', () => {
  it('streams progress with accumulated text, then the segment, then done with stats', async () => {
    const body = lines([
      { message: { role: 'assistant', content: 'Xin' } },
      { message: { role: 'assistant', content: ' chào' } },
      { message: { role: 'assistant', content: ' thế giới' } },
      { message: { role: 'assistant', content: '' }, ...DONE },
    ]);
    const { fetch, calls } = fakeFetch({ pieces: [body.slice(0, 20), body.slice(20)] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const chunks = await collect(provider.translate(batchA(), new AbortController().signal));

    expect(chunks.slice(0, 3)).toEqual([
      { kind: 'progress', tokens: 1, text: 'Xin' },
      { kind: 'progress', tokens: 2, text: 'Xin chào' },
      { kind: 'progress', tokens: 3, text: 'Xin chào thế giới' },
    ]);
    expect(chunks[3]).toEqual({ kind: 'segment', id: 's1', text: 'Xin chào thế giới' });
    const done = chunks[4];
    expect(done?.kind).toBe('done');
    if (done?.kind === 'done') {
      expect(done.stats).toMatchObject({
        promptEvalCount: 40,
        evalCount: 3,
        evalDurationMs: 100,
        doneReason: 'stop',
      });
      expect(done.stats.ttftMs).toBeGreaterThanOrEqual(0);
      expect(done.stats.totalMs).toBeGreaterThanOrEqual(done.stats.ttftMs);
    }
    expect(chunks).toHaveLength(5);

    const request = JSON.parse(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(request.model).toBe('translategemma:12b');
    expect(request.stream).toBe(true);
    expect(request.options.num_ctx).toBe(8192);
    expect(request.messages).toHaveLength(1);
  });

  it('yields no segment when the output was cut (done_reason length)', async () => {
    const body = lines([
      { message: { content: 'Xin' } },
      { message: { content: '' }, ...DONE, done_reason: 'length' },
    ]);
    const { fetch } = fakeFetch({ pieces: [body] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const chunks = await collect(provider.translate(batchA(), new AbortController().signal));

    expect(chunks.map((chunk) => chunk.kind)).toEqual(['progress', 'done']);
    expect(chunks[1]).toMatchObject({ kind: 'done', stats: { doneReason: 'length' } });
  });
});

describe('translate — profile B', () => {
  it('counts tokens without text, then yields one segment per known id from the JSON', async () => {
    const json =
      '{"translations":[{"id":"s2","text":"Tạm biệt"},{"id":"s1","text":"Xin chào"},{"id":"s9","text":"?"}]}';
    const body = lines([
      { message: { content: json.slice(0, 30) } },
      { message: { content: json.slice(30) } },
      { message: { content: '' }, ...DONE },
    ]);
    const { fetch } = fakeFetch({ pieces: [body] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const chunks = await collect(provider.translate(batchB(), new AbortController().signal));

    expect(chunks.slice(0, 2)).toEqual([
      { kind: 'progress', tokens: 1 },
      { kind: 'progress', tokens: 2 },
    ]);
    expect(chunks.slice(2, 4)).toEqual([
      { kind: 'segment', id: 's2', text: 'Tạm biệt' },
      { kind: 'segment', id: 's1', text: 'Xin chào' },
    ]);
    expect(chunks[4]?.kind).toBe('done');
    expect(chunks).toHaveLength(5);
  });

  it('rejects with E_OUTPUT when the JSON is malformed', async () => {
    const body = lines([
      { message: { content: '{"translations":[' } },
      { message: { content: '' }, ...DONE },
    ]);
    const { fetch } = fakeFetch({ pieces: [body] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    expect(
      await codeOf(collect(provider.translate(batchB(), new AbortController().signal))),
    ).toMatch(/^E_OUTPUT:/);
  });
});

describe('translate — failures', () => {
  it('maps HTTP 403 before streaming to E_CORS', async () => {
    const { fetch } = fakeFetch({ pieces: ['{"error":"origin not allowed"}'], status: 403 });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    expect(await codeOf(collect(provider.translate(batchA(), new AbortController().signal)))).toBe(
      'E_CORS:{"error":"origin not allowed"}',
    );
  });

  it('maps an in-stream error line to E_OUTPUT', async () => {
    const { fetch } = fakeFetch({ pieces: [lines([{ error: 'something broke' }])] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    expect(
      await codeOf(collect(provider.translate(batchA(), new AbortController().signal))),
    ).toMatch(/^E_OUTPUT:/);
  });

  it('rejects with E_OUTPUT when the stream ends without a done line', async () => {
    const { fetch } = fakeFetch({ pieces: [lines([{ message: { content: 'Xin' } }])] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    expect(
      await codeOf(collect(provider.translate(batchA(), new AbortController().signal))),
    ).toMatch(/^E_OUTPUT:/);
  });

  it('ends silently when the caller aborts mid-stream, and aborts the underlying fetch', async () => {
    const body = lines([{ message: { content: 'Xin' } }, { message: { content: ' chào' } }]);
    const { fetch, calls } = fakeFetch({ pieces: [body], stallAfter: 1 });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    const controller = new AbortController();

    const chunks: Chunk[] = [];
    for await (const chunk of provider.translate(batchA(), controller.signal)) {
      chunks.push(chunk);
      if (chunks.length === 2) controller.abort();
    }

    expect(chunks).toHaveLength(2);
    expect(calls[0]?.init?.signal?.aborted).toBe(true);
  });

  it('ends silently when the caller aborts after the stream closed without a done line', async () => {
    // The stream closes right after the two lines (no `done: true`), so the read that follows
    // the abort returns done instead of rejecting — the race the post-loop guard covers.
    const body = lines([{ message: { content: 'Xin' } }, { message: { content: ' chào' } }]);
    const { fetch, calls } = fakeFetch({ pieces: [body] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    const controller = new AbortController();

    const chunks: Chunk[] = [];
    for await (const chunk of provider.translate(batchA(), controller.signal)) {
      chunks.push(chunk);
      if (chunks.length === 2) controller.abort();
    }

    expect(chunks.map((chunk) => chunk.kind)).toEqual(['progress', 'progress']);
    expect(calls[0]?.init?.signal?.aborted).toBe(true);
  });

  it('returns nothing when the signal is already aborted', async () => {
    const { fetch, calls } = fakeFetch({ pieces: [] });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });
    const controller = new AbortController();
    controller.abort();
    expect(await collect(provider.translate(batchA(), controller.signal))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('times out with E_TIMEOUT:ttft when no response arrives within 60 s', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch({ pieces: [], hang: true });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const pending = codeOf(collect(provider.translate(batchA(), new AbortController().signal)));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await pending).toBe('E_TIMEOUT:ttft');
  });

  it('times out with E_TIMEOUT:idle when the stream stalls for 20 s after the first chunk', async () => {
    vi.useFakeTimers();
    const body = lines([{ message: { content: 'Xin' } }, { message: { content: ' chào' } }]);
    const { fetch } = fakeFetch({ pieces: [body], stallAfter: 1 });
    const provider = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch });

    const pending = codeOf(collect(provider.translate(batchA(), new AbortController().signal)));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await pending).toBe('E_TIMEOUT:idle');
  });

  it('honours custom timeouts (total)', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch({ pieces: [], hang: true });
    const provider = createOllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      fetch,
      timeouts: { ttftMs: 5_000, totalMs: 1_000 },
    });

    const pending = codeOf(collect(provider.translate(batchA(), new AbortController().signal)));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toBe('E_TIMEOUT:total');
  });
});
