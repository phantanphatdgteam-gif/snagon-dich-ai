import { SnagonError, isAbortError, mapFetchError, mapHttpError } from '../errors.ts';
import { KEEP_ALIVE, NUM_CTX, buildChatRequest } from '../prompt/index.ts';
import { parseTranslations } from '../prompt/instruct-json.ts';
import { pickProfile } from '../prompt/profile.ts';
import { parseNdjson } from './ndjson.ts';
import type {
  Chunk,
  GenStats,
  LoadedModel,
  ModelDetails,
  ModelInfo,
  TranslateBatch,
  TranslateProvider,
} from './types.ts';

/** The only default endpoint in the codebase (CLAUDE.md §4); the service worker overrides it from config. */
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export interface Timeouts {
  ttftMs: number;
  idleMs: number;
  totalMs: number;
}

/** Spec §7.3: cold load + prompt eval may take up to 60 s; a stalled stream is dead after 20 s; nothing runs past 150 s. */
export const DEFAULT_TIMEOUTS: Timeouts = { ttftMs: 60_000, idleMs: 20_000, totalMs: 150_000 };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OllamaProviderOptions {
  baseUrl: string;
  /** Injected in unit tests; defaults to the global fetch. */
  fetch?: FetchLike;
  timeouts?: Partial<Timeouts>;
}

interface RawTag {
  name: string;
  size: number;
  modified_at: string;
  details?: { family?: string };
}

interface RawShow {
  capabilities?: string[];
  details?: { family?: string };
  model_info?: Record<string, unknown>;
}

interface RawPs {
  name: string;
  size_vram: number;
  expires_at: string;
}

interface RawChatLine {
  message?: { role?: string; content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
}

type TimeoutKind = 'ttft' | 'idle' | 'total';

const JSON_HEADERS = { 'content-type': 'application/json' };

export function createOllamaProvider(options: OllamaProviderOptions): TranslateProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeouts: Timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };

  async function request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetchFn(baseUrl + path, init);
    } catch (error) {
      throw mapFetchError(error);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw mapHttpError(response.status, body);
    }
    return response;
  }

  async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await request(path, { method: 'GET', signal });
    return (await response.json()) as T;
  }

  async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await request(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      signal,
    });
    return (await response.json()) as T;
  }

  async function* translateStream(
    batch: TranslateBatch,
    signal: AbortSignal,
  ): AsyncGenerator<Chunk, void, undefined> {
    if (signal.aborted) return;
    const body = buildChatRequest(batch);

    // One internal controller aborts the fetch for both reasons: caller cancel and timeouts.
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    signal.addEventListener('abort', abortFromCaller, { once: true });

    let timeoutKind: TimeoutKind | null = null;
    let phaseTimer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number, kind: TimeoutKind) => {
      clearTimeout(phaseTimer);
      phaseTimer = setTimeout(() => {
        timeoutKind = kind;
        controller.abort();
      }, ms);
    };
    const totalTimer = setTimeout(() => {
      timeoutKind = 'total';
      controller.abort();
    }, timeouts.totalMs);

    const startedAt = performance.now();
    let ttftMs = -1;
    let content = '';
    let tokens = 0;
    let stats: GenStats | undefined;

    try {
      arm(timeouts.ttftMs, 'ttft');
      const response = await request('/api/chat', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.body) throw new SnagonError('E_OUTPUT', 'empty response body');

      for await (const raw of parseNdjson(response.body)) {
        const line = raw as RawChatLine;
        if (typeof line.error === 'string') {
          throw new SnagonError('E_OUTPUT', 'ollama reported an error mid-stream', line.error);
        }
        if (ttftMs < 0) ttftMs = performance.now() - startedAt;
        arm(timeouts.idleMs, 'idle');

        const piece = line.message?.content ?? '';
        if (piece) {
          content += piece;
          tokens += 1;
          yield batch.profile === 'translategemma'
            ? { kind: 'progress', tokens, text: content }
            : { kind: 'progress', tokens };
        }
        if (line.done) {
          stats = {
            ttftMs,
            totalMs: performance.now() - startedAt,
            promptEvalCount: line.prompt_eval_count ?? 0,
            evalCount: line.eval_count ?? 0,
            evalDurationMs: (line.eval_duration ?? 0) / 1_000_000,
            doneReason: line.done_reason ?? 'unknown',
          };
          break;
        }
      }
    } catch (error) {
      if (signal.aborted) return; // caller cancelled: not an error
      if (timeoutKind !== null) {
        throw new SnagonError(
          'E_TIMEOUT',
          `no response within the ${timeoutKind} timeout`,
          timeoutKind,
        );
      }
      if (isAbortError(error)) return; // consumer stopped iterating
      throw mapFetchError(error);
    } finally {
      clearTimeout(phaseTimer);
      clearTimeout(totalTimer);
      signal.removeEventListener('abort', abortFromCaller);
    }

    // The caller may cancel while this generator sits at a yield and the stream has already
    // ended on its own; cancellation is silent even then (no E_* code, no more chunks).
    if (signal.aborted) return;
    if (!stats) throw new SnagonError('E_OUTPUT', 'stream ended without a done line');

    // Output cut by num_predict is never a finished segment (spec §7.3); the caller maps it to E_TRUNC.
    if (stats.doneReason !== 'length') {
      if (batch.profile === 'translategemma') {
        const segment = batch.segments[0];
        if (segment) yield { kind: 'segment', id: segment.id, text: content.trim() };
      } else {
        const wanted = new Set(batch.segments.map((segment) => segment.id));
        for (const translation of parseTranslations(content)) {
          if (wanted.has(translation.id)) {
            yield { kind: 'segment', id: translation.id, text: translation.text };
          }
        }
      }
    }
    yield { kind: 'done', stats };
  }

  return {
    async version(): Promise<string> {
      const data = await getJson<{ version: string }>('/api/version');
      return data.version;
    },

    async listModels(): Promise<ModelInfo[]> {
      const data = await getJson<{ models?: RawTag[] }>('/api/tags');
      return (data.models ?? []).map((model) => ({
        name: model.name,
        size: model.size,
        family: model.details?.family ?? '',
        modifiedAt: model.modified_at,
      }));
    },

    async describe(model: string): Promise<ModelDetails> {
      const data = await postJson<RawShow>('/api/show', { model });
      const info = data.model_info ?? {};
      const architecture = info['general.architecture'];
      const contextLength =
        typeof architecture === 'string' ? info[`${architecture}.context_length`] : undefined;
      return {
        name: model,
        family: data.details?.family ?? '',
        capabilities: data.capabilities ?? [],
        contextLength: typeof contextLength === 'number' ? contextLength : null,
        profile: pickProfile(model),
      };
    },

    async loaded(): Promise<LoadedModel[]> {
      const data = await getJson<{ models?: RawPs[] }>('/api/ps');
      return (data.models ?? []).map((model) => ({
        name: model.name,
        sizeVram: model.size_vram,
        until: model.expires_at,
      }));
    },

    async warmUp(model: string, signal?: AbortSignal): Promise<void> {
      // No `messages` → Ollama only loads the model and keeps it resident (spec §7.1).
      // num_ctx is a load option: without it the model loads at its default context and the
      // first translate request (num_ctx 8192) makes Ollama unload and reload it.
      await postJson(
        '/api/chat',
        { model, keep_alive: KEEP_ALIVE, stream: false, options: { num_ctx: NUM_CTX } },
        signal,
      );
    },

    translate(batch: TranslateBatch, signal: AbortSignal): AsyncIterable<Chunk> {
      return translateStream(batch, signal);
    },
  };
}
