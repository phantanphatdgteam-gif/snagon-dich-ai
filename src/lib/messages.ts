import { isErrorCode, type ErrorCode } from './errors.ts';
import { TARGET_LANG, isSourceLang, type SourceLang, type TargetLang } from './lang/codes.ts';
import { isProfile, type Profile } from './prompt/profile.ts';
import type { GenStats, LoadedModel, ModelInfo, Segment } from './provider/types.ts';

/**
 * Long-lived Port between a job client (popup in M0, content script from M1)
 * and the service worker.
 */
export const PORT_NAME = 'snagon-job';

export type OllamaState = 'ok' | 'down' | 'cors' | 'busy' | 'error';
const OLLAMA_STATES: readonly string[] = ['ok', 'down', 'cors', 'busy', 'error'];

// ---- client → service worker (Port) -------------------------------------------------------

export interface JobStart {
  type: 'job.start';
  jobId: string;
  tabId: number;
  frameId: number;
  src: SourceLang;
  tgt: TargetLang;
  model: string;
  profile: Profile;
  url: string;
  title: string;
}

export interface BatchTranslate {
  type: 'batch.translate';
  jobId: string;
  batchId: string;
  segments: Segment[];
  /** 0 = viewport, 1 = ±1 viewport, 2 = rest (spec §5.4). M0 always sends 0. */
  priority: 0 | 1 | 2;
}

export interface JobCancel {
  type: 'job.cancel';
  jobId: string;
}

export type PortMessage = JobStart | BatchTranslate | JobCancel;

// ---- service worker → client (Port) -------------------------------------------------------

export interface SegPartial {
  type: 'seg.partial';
  jobId: string;
  segId: string;
  /** Accumulated text for profile A; empty string for profile B (only `tokens` moves). */
  text: string;
  tokens: number;
}

export interface SegDone {
  type: 'seg.done';
  jobId: string;
  segId: string;
  text: string;
  stats?: GenStats;
}

export interface SegError {
  type: 'seg.error';
  jobId: string;
  segId: string;
  code: ErrorCode;
  message: string;
}

export type PortReply = SegPartial | SegDone | SegError;

// ---- popup → service worker (sendMessage) -------------------------------------------------

export interface StatusGet {
  type: 'status.get';
}

export interface ModelDescribe {
  type: 'model.describe';
  model: string;
}

export type PopupRequest = StatusGet | ModelDescribe;

// ---- service worker → popup (sendMessage response) ----------------------------------------

export interface StatusMsg {
  type: 'status';
  ollama: OllamaState;
  version?: string;
  models: ModelInfo[];
  loaded: LoadedModel[];
  error?: { code: ErrorCode; message: string };
}

export type ModelDescribed =
  | {
      type: 'model.described';
      model: string;
      profile: Profile;
      contextLength: number | null;
      capabilities: string[];
    }
  | { type: 'model.described'; model: string; error: { code: ErrorCode; message: string } };

export type PopupReply = StatusMsg | ModelDescribed;

// ---- guards --------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null;
}

function isStr(value: unknown): value is string {
  return typeof value === 'string';
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSegment(value: unknown): value is Segment {
  return isRec(value) && isStr(value.id) && isStr(value.text) && isNum(value.tokensEst);
}

function isErrorInfo(value: unknown): value is { code: ErrorCode; message: string } {
  return isRec(value) && isErrorCode(value.code) && isStr(value.message);
}

function isGenStats(value: unknown): value is GenStats {
  return (
    isRec(value) &&
    isNum(value.ttftMs) &&
    isNum(value.totalMs) &&
    isNum(value.promptEvalCount) &&
    isNum(value.evalCount) &&
    isNum(value.evalDurationMs) &&
    isStr(value.doneReason)
  );
}

function isModelInfo(value: unknown): value is ModelInfo {
  return (
    isRec(value) &&
    isStr(value.name) &&
    isNum(value.size) &&
    isStr(value.family) &&
    isStr(value.modifiedAt)
  );
}

function isLoadedModel(value: unknown): value is LoadedModel {
  return isRec(value) && isStr(value.name) && isNum(value.sizeVram) && isStr(value.until);
}

export function isPortMessage(value: unknown): value is PortMessage {
  if (!isRec(value)) return false;
  switch (value.type) {
    case 'job.start':
      return (
        isStr(value.jobId) &&
        isNum(value.tabId) &&
        isNum(value.frameId) &&
        isSourceLang(value.src) &&
        value.tgt === TARGET_LANG &&
        isStr(value.model) &&
        isProfile(value.profile) &&
        isStr(value.url) &&
        isStr(value.title)
      );
    case 'batch.translate':
      return (
        isStr(value.jobId) &&
        isStr(value.batchId) &&
        Array.isArray(value.segments) &&
        // .every() is vacuously true on []: without this the SW would accept a batch it can
        // answer with nothing, leaving the client waiting for replies that never come.
        value.segments.length > 0 &&
        value.segments.every(isSegment) &&
        (value.priority === 0 || value.priority === 1 || value.priority === 2)
      );
    case 'job.cancel':
      return isStr(value.jobId);
    default:
      return false;
  }
}

export function isPortReply(value: unknown): value is PortReply {
  if (!isRec(value) || !isStr(value.jobId) || !isStr(value.segId)) return false;
  switch (value.type) {
    case 'seg.partial':
      return isStr(value.text) && isNum(value.tokens);
    case 'seg.done':
      return isStr(value.text) && (value.stats === undefined || isGenStats(value.stats));
    case 'seg.error':
      return isErrorCode(value.code) && isStr(value.message);
    default:
      return false;
  }
}

export function isPopupRequest(value: unknown): value is PopupRequest {
  if (!isRec(value)) return false;
  if (value.type === 'status.get') return true;
  if (value.type === 'model.describe') return isStr(value.model);
  return false;
}

export function isPopupReply(value: unknown): value is PopupReply {
  if (!isRec(value)) return false;
  if (value.type === 'status') {
    return (
      isStr(value.ollama) &&
      OLLAMA_STATES.includes(value.ollama) &&
      (value.version === undefined || isStr(value.version)) &&
      Array.isArray(value.models) &&
      value.models.every(isModelInfo) &&
      Array.isArray(value.loaded) &&
      value.loaded.every(isLoadedModel) &&
      (value.error === undefined || isErrorInfo(value.error))
    );
  }
  if (value.type === 'model.described') {
    if (!isStr(value.model)) return false;
    if (isErrorInfo(value.error)) return true;
    return (
      isProfile(value.profile) &&
      (value.contextLength === null || isNum(value.contextLength)) &&
      Array.isArray(value.capabilities) &&
      value.capabilities.every(isStr)
    );
  }
  return false;
}
