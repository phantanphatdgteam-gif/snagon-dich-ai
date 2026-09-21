import { describe, expect, it } from 'vitest';
import {
  PORT_NAME,
  isPopupReply,
  isPopupRequest,
  isPortMessage,
  isPortReply,
  type BatchTranslate,
  type JobStart,
  type SegDone,
  type StatusMsg,
} from '../../src/lib/messages.ts';

const jobStart: JobStart = {
  type: 'job.start',
  jobId: 'j1',
  tabId: 12,
  frameId: 0,
  src: 'en',
  tgt: 'vi',
  model: 'gemma4:26b',
  profile: 'instruct-json',
  url: 'https://example.com/a',
  title: 'Example',
};

const batch: BatchTranslate = {
  type: 'batch.translate',
  jobId: 'j1',
  batchId: 'b1',
  priority: 0,
  segments: [{ id: 's1', text: 'Hello', tokensEst: 2 }],
};

const segDone: SegDone = {
  type: 'seg.done',
  jobId: 'j1',
  segId: 's1',
  text: 'Xin chào',
  stats: {
    ttftMs: 1,
    totalMs: 2,
    promptEvalCount: 3,
    evalCount: 4,
    evalDurationMs: 5,
    doneReason: 'stop',
  },
};

const status: StatusMsg = {
  type: 'status',
  ollama: 'ok',
  version: '0.34.2',
  models: [{ name: 'gemma4:26b', size: 1, family: 'gemma4', modifiedAt: 'x' }],
  loaded: [],
};

describe('messages', () => {
  it('names the job port', () => {
    expect(PORT_NAME).toBe('snagon-job');
  });

  it('accepts well-formed port messages', () => {
    expect(isPortMessage(jobStart)).toBe(true);
    expect(isPortMessage(batch)).toBe(true);
    expect(isPortMessage({ type: 'job.cancel', jobId: 'j1' })).toBe(true);
  });

  it('rejects malformed port messages', () => {
    expect(isPortMessage(null)).toBe(false);
    expect(isPortMessage({ type: 'job.start' })).toBe(false);
    expect(isPortMessage({ ...jobStart, src: 'zh' })).toBe(false);
    expect(isPortMessage({ ...jobStart, profile: 'A' })).toBe(false);
    expect(isPortMessage({ ...jobStart, tgt: 'en' })).toBe(false);
    expect(isPortMessage({ ...batch, priority: 3 })).toBe(false);
    expect(isPortMessage({ ...batch, segments: [{ id: 's1', text: 'x' }] })).toBe(false);
    expect(isPortMessage({ type: 'seg.done', jobId: 'j1', segId: 's1', text: 'x' })).toBe(false);
  });

  it('accepts and rejects port replies', () => {
    expect(
      isPortReply({ type: 'seg.partial', jobId: 'j1', segId: 's1', text: 'Xin', tokens: 1 }),
    ).toBe(true);
    expect(isPortReply(segDone)).toBe(true);
    expect(isPortReply({ ...segDone, stats: undefined })).toBe(true);
    expect(
      isPortReply({ type: 'seg.error', jobId: 'j1', segId: 's1', code: 'E_CORS', message: 'x' }),
    ).toBe(true);
    expect(
      isPortReply({ type: 'seg.error', jobId: 'j1', segId: 's1', code: 'E_NOPE', message: 'x' }),
    ).toBe(false);
    expect(isPortReply(jobStart)).toBe(false);
  });

  it('accepts and rejects popup requests and replies', () => {
    expect(isPopupRequest({ type: 'status.get' })).toBe(true);
    expect(isPopupRequest({ type: 'model.describe', model: 'gemma4:26b' })).toBe(true);
    expect(isPopupRequest({ type: 'model.describe' })).toBe(false);
    expect(isPopupRequest(jobStart)).toBe(false);

    expect(isPopupReply(status)).toBe(true);
    expect(
      isPopupReply({
        type: 'status',
        ollama: 'down',
        models: [],
        loaded: [],
        error: { code: 'E_DOWN', message: 'x' },
      }),
    ).toBe(true);
    expect(isPopupReply({ type: 'status', ollama: 'weird', models: [], loaded: [] })).toBe(false);
    expect(
      isPopupReply({
        type: 'model.described',
        model: 'gemma4:26b',
        profile: 'instruct-json',
        contextLength: 262144,
        capabilities: ['completion'],
      }),
    ).toBe(true);
    expect(
      isPopupReply({
        type: 'model.described',
        model: 'x',
        error: { code: 'E_MODEL', message: 'x' },
      }),
    ).toBe(true);
    expect(isPopupReply({ type: 'model.described', model: 'x' })).toBe(false);
  });
});
