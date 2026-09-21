import type { SourceLang } from '../lang/codes.ts';
import { numPredict } from '../tokens.ts';
import {
  INSTRUCT_JSON_NUM_PREDICT_EXTRA,
  INSTRUCT_JSON_OPTIONS,
  TRANSLATIONS_SCHEMA,
  buildInstructJsonSystem,
  buildInstructJsonUser,
} from './instruct-json.ts';
import type { Profile } from './profile.ts';
import {
  TRANSLATEGEMMA_NUM_PREDICT_EXTRA,
  TRANSLATEGEMMA_OPTIONS,
  buildTranslateGemmaPrompt,
} from './translategemma.ts';

/** Part of the cache key from M1. Bump it whenever a template changes — and ask Phát first. */
export const PROMPT_VERSION = 1;
/** Fixed for every request of every model: changing it makes Ollama reload the model (spec §7.3). */
export const NUM_CTX = 8192;
export const KEEP_ALIVE = '10m';
export const SEED = 42;

export interface PromptSegment {
  id: string;
  text: string;
  tokensEst: number;
}

export interface PromptBatch {
  model: string;
  profile: Profile;
  src: SourceLang;
  segments: readonly PromptSegment[];
  context: { title: string; domain: string };
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatOptions {
  temperature: number;
  top_p: number;
  top_k?: number;
  seed: number;
  num_ctx: number;
  num_predict: number;
}

/** Body of `POST /api/chat` (spec §7.3). */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: true;
  keep_alive: string;
  think?: false;
  format?: typeof TRANSLATIONS_SCHEMA;
  options: ChatOptions;
}

/** Builds the exact `/api/chat` body for a batch. Profile A takes exactly one segment per request. */
export function buildChatRequest(batch: PromptBatch): ChatRequest {
  const tokensIn = batch.segments.reduce((sum, segment) => sum + segment.tokensEst, 0);

  if (batch.profile === 'translategemma') {
    const segment = batch.segments[0];
    if (!segment || batch.segments.length !== 1) {
      throw new Error('profile translategemma takes exactly one segment per request');
    }
    return {
      model: batch.model,
      messages: [{ role: 'user', content: buildTranslateGemmaPrompt(batch.src, segment.text) }],
      stream: true,
      keep_alive: KEEP_ALIVE,
      options: {
        ...TRANSLATEGEMMA_OPTIONS,
        seed: SEED,
        num_ctx: NUM_CTX,
        num_predict: numPredict(tokensIn, TRANSLATEGEMMA_NUM_PREDICT_EXTRA),
      },
    };
  }

  return {
    model: batch.model,
    messages: [
      { role: 'system', content: buildInstructJsonSystem(batch.src) },
      { role: 'user', content: buildInstructJsonUser(batch.src, batch.context, batch.segments) },
    ],
    stream: true,
    think: false,
    format: TRANSLATIONS_SCHEMA,
    keep_alive: KEEP_ALIVE,
    options: {
      ...INSTRUCT_JSON_OPTIONS,
      seed: SEED,
      num_ctx: NUM_CTX,
      num_predict: numPredict(tokensIn, INSTRUCT_JSON_NUM_PREDICT_EXTRA),
    },
  };
}
