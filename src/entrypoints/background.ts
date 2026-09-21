import { browser, defineBackground } from '#imports';
import { isSnagonError, type ErrorCode } from '../lib/errors.ts';
import { createLog } from '../lib/log.ts';
import {
  PORT_NAME,
  isPopupRequest,
  isPortMessage,
  type BatchTranslate,
  type JobStart,
  type OllamaState,
  type PopupReply,
  type PopupRequest,
  type PortReply,
} from '../lib/messages.ts';
import { DEFAULT_OLLAMA_URL, createOllamaProvider } from '../lib/provider/ollama.ts';
import type { GenStats, TranslateBatch, TranslateProvider } from '../lib/provider/types.ts';

type Port = ReturnType<typeof browser.runtime.connect>;

const ENDPOINT_KEY = 'snagon.endpoint';
const log = createLog('sw');

interface Job {
  start: JobStart;
  controller: AbortController;
}

export default defineBackground({
  type: 'module',
  main() {
    // Both listeners register synchronously: browser.runtime.sendMessage rejects when no
    // listener exists yet, and the popup calls status.get as soon as it opens.
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isPopupRequest(message)) return false;
      handlePopupRequest(message).then(sendResponse, (error: unknown) => {
        log.error('popup request failed', message.type, error);
        sendResponse(failureReply(message, error));
      });
      return true; // keep the channel open for the async response
    });

    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== PORT_NAME) return;
      attachJobPort(port);
    });
  },
});

/** The SW keeps no config in memory: read the endpoint on every use (spec §7.4). */
async function getProvider(): Promise<TranslateProvider> {
  const stored = await browser.storage.local.get(ENDPOINT_KEY);
  const endpoint = stored[ENDPOINT_KEY];
  return createOllamaProvider({
    baseUrl: typeof endpoint === 'string' && endpoint !== '' ? endpoint : DEFAULT_OLLAMA_URL,
  });
}

function stateFromCode(code: ErrorCode): OllamaState {
  if (code === 'E_DOWN') return 'down';
  if (code === 'E_CORS') return 'cors';
  if (code === 'E_BUSY') return 'busy';
  return 'error';
}

/** Unknown failures (bugs, not provider errors) are reported as E_OUTPUT so the client still gets a code. */
function errorInfo(error: unknown): { code: ErrorCode; message: string } {
  if (isSnagonError(error)) {
    return {
      code: error.code,
      message: error.detail ? `${error.message}: ${error.detail}` : error.message,
    };
  }
  return { code: 'E_OUTPUT', message: error instanceof Error ? error.message : String(error) };
}

async function handlePopupRequest(request: PopupRequest): Promise<PopupReply> {
  const provider = await getProvider();

  if (request.type === 'status.get') {
    const [version, models, loaded] = await Promise.allSettled([
      provider.version(),
      provider.listModels(),
      provider.loaded(),
    ]);
    if (version.status === 'rejected') {
      const info = errorInfo(version.reason);
      return {
        type: 'status',
        ollama: stateFromCode(info.code),
        models: [],
        loaded: [],
        error: info,
      };
    }
    return {
      type: 'status',
      ollama: 'ok',
      version: version.value,
      models: models.status === 'fulfilled' ? models.value : [],
      loaded: loaded.status === 'fulfilled' ? loaded.value : [],
      ...(models.status === 'rejected' ? { error: errorInfo(models.reason) } : {}),
    };
  }

  const details = await provider.describe(request.model);
  return {
    type: 'model.described',
    model: request.model,
    profile: details.profile,
    contextLength: details.contextLength,
    capabilities: details.capabilities,
  };
}

function failureReply(request: PopupRequest, error: unknown): PopupReply {
  const info = errorInfo(error);
  if (request.type === 'model.describe') {
    return { type: 'model.described', model: request.model, error: info };
  }
  return { type: 'status', ollama: stateFromCode(info.code), models: [], loaded: [], error: info };
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function attachJobPort(port: Port): void {
  // The only job state in the SW: in-flight controllers for this port (spec §7.4 allows a temporary in-flight map).
  const jobs = new Map<string, Job>();

  const post = (reply: PortReply): void => {
    try {
      port.postMessage(reply);
    } catch (error) {
      log.warn('port closed while posting', reply.type, error);
    }
  };

  port.onMessage.addListener((raw: unknown) => {
    if (!isPortMessage(raw)) {
      log.warn('rejected malformed port message', raw);
      return;
    }
    switch (raw.type) {
      case 'job.start': {
        const job: Job = { start: raw, controller: new AbortController() };
        jobs.set(raw.jobId, job);
        void warmUp(job);
        return;
      }
      case 'batch.translate':
        void runBatch(raw);
        return;
      case 'job.cancel':
        jobs.get(raw.jobId)?.controller.abort();
        jobs.delete(raw.jobId);
        return;
    }
  });

  // Port closed (popup closed, tab navigated) → abort every fetch of its jobs (spec §4).
  port.onDisconnect.addListener(() => {
    for (const job of jobs.values()) job.controller.abort();
    jobs.clear();
  });

  async function warmUp(job: Job): Promise<void> {
    try {
      const provider = await getProvider();
      await provider.warmUp(job.start.model, job.controller.signal);
    } catch (error) {
      if (!job.controller.signal.aborted) log.warn('warm-up failed', job.start.model, error);
    }
  }

  async function runBatch(message: BatchTranslate): Promise<void> {
    const job = jobs.get(message.jobId);
    if (!job) {
      for (const segment of message.segments) {
        post({
          type: 'seg.error',
          jobId: message.jobId,
          segId: segment.id,
          code: 'E_BADREQ',
          message: `unknown jobId ${message.jobId} (send job.start first)`,
        });
      }
      return;
    }

    const { start } = job;
    const batch: TranslateBatch = {
      model: start.model,
      profile: start.profile,
      src: start.src,
      tgt: start.tgt,
      segments: message.segments,
      context: { title: start.title, domain: domainOf(start.url) },
    };
    const firstId = message.segments[0]?.id ?? '';
    const texts = new Map<string, string>();
    let stats: GenStats | undefined;

    try {
      const provider = await getProvider();
      for await (const chunk of provider.translate(batch, job.controller.signal)) {
        if (chunk.kind === 'progress') {
          post({
            type: 'seg.partial',
            jobId: message.jobId,
            segId: firstId,
            text: chunk.text ?? '',
            tokens: chunk.tokens,
          });
        } else if (chunk.kind === 'segment') {
          texts.set(chunk.id, chunk.text);
        } else {
          stats = chunk.stats;
        }
      }
    } catch (error) {
      if (job.controller.signal.aborted) return; // cancelled — the client already knows
      const info = errorInfo(error);
      log.warn('batch failed', message.batchId, info.code, info.message);
      for (const segment of message.segments) {
        post({
          type: 'seg.error',
          jobId: message.jobId,
          segId: segment.id,
          code: info.code,
          message: info.message,
        });
      }
      return;
    }

    if (job.controller.signal.aborted) return; // cancelled — the client already knows

    for (const segment of message.segments) {
      const text = texts.get(segment.id);
      if (text !== undefined) {
        post({ type: 'seg.done', jobId: message.jobId, segId: segment.id, text, stats });
      } else if (stats?.doneReason === 'length') {
        post({
          type: 'seg.error',
          jobId: message.jobId,
          segId: segment.id,
          code: 'E_TRUNC',
          message: 'output cut by num_predict (done_reason=length)',
        });
      } else {
        post({
          type: 'seg.error',
          jobId: message.jobId,
          segId: segment.id,
          code: 'E_OUTPUT',
          message: 'model output has no translation for this segment',
        });
      }
    }
  }
}
