import type { TargetLang } from '../lang/codes.ts';
import type { PromptBatch, PromptSegment } from '../prompt/index.ts';
import type { Profile } from '../prompt/profile.ts';

export type Segment = PromptSegment;

/** One request to the model: one segment (profile A) or up to 8 segments of the same source language (profile B). */
export interface TranslateBatch extends PromptBatch {
  tgt: TargetLang;
}

/** Numbers from Ollama's final `done: true` line plus client-side timings (spec §7.3). */
export interface GenStats {
  ttftMs: number;
  totalMs: number;
  promptEvalCount: number;
  evalCount: number;
  evalDurationMs: number;
  doneReason: string;
}

export type Chunk =
  /** Stream progress. `text` is the accumulated translation for profile A; profile B only counts tokens. */
  | { kind: 'progress'; tokens: number; text?: string }
  /** A finished segment. Never emitted for output cut by `num_predict` (`done_reason: "length"`). */
  | { kind: 'segment'; id: string; text: string }
  | { kind: 'done'; stats: GenStats };

export interface ModelInfo {
  name: string;
  size: number;
  family: string;
  modifiedAt: string;
}

export interface ModelDetails {
  name: string;
  family: string;
  capabilities: string[];
  contextLength: number | null;
  profile: Profile;
}

export interface LoadedModel {
  name: string;
  sizeVram: number;
  until: string;
}

/** Spec §15: the pipeline never knows which provider runs. Ollama is the only implementation in v1. */
export interface TranslateProvider {
  version(): Promise<string>;
  listModels(): Promise<ModelInfo[]>;
  describe(model: string): Promise<ModelDetails>;
  loaded(): Promise<LoadedModel[]>;
  warmUp(model: string, signal?: AbortSignal): Promise<void>;
  translate(batch: TranslateBatch, signal: AbortSignal): AsyncIterable<Chunk>;
}
