import { SnagonError, mapFetchError, mapHttpError } from '../errors.ts';
import { KEEP_ALIVE } from '../prompt/index.ts';
import { pickProfile } from '../prompt/profile.ts';
import type {
  Chunk,
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
    void batch;
    void signal;
    void timeouts;
    throw new SnagonError('E_OUTPUT', 'translate is implemented in Task 8');
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
      await postJson('/api/chat', { model, keep_alive: KEEP_ALIVE, stream: false }, signal);
    },

    translate(batch: TranslateBatch, signal: AbortSignal): AsyncIterable<Chunk> {
      return translateStream(batch, signal);
    },
  };
}
