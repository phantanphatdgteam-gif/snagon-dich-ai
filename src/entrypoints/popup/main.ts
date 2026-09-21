import { browser } from '#imports';
import type { ErrorCode } from '../../lib/errors.ts';
import { SOURCE_LANGS, isSourceLang } from '../../lib/lang/codes.ts';
import { createLog } from '../../lib/log.ts';
import {
  PORT_NAME,
  isPopupReply,
  isPortReply,
  type BatchTranslate,
  type JobCancel,
  type JobStart,
  type ModelDescribe,
  type ModelDescribed,
  type StatusGet,
  type StatusMsg,
} from '../../lib/messages.ts';
import { pickProfile } from '../../lib/prompt/profile.ts';
import { SAMPLES } from '../../lib/samples.ts';
import { tokensEst } from '../../lib/tokens.ts';
import { vi } from '../../locales/vi.ts';

type Port = ReturnType<typeof browser.runtime.connect>;

const MODEL_KEY = 'snagon.model';
const TEST_URL = 'https://example.com/snagon-test';
const TEST_TITLE = 'Snagon test';
const log = createLog('popup');

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`popup: missing #${id}`);
  return node as T;
}

const ui = {
  title: el<HTMLHeadingElement>('title'),
  status: el<HTMLDivElement>('status'),
  check: el<HTMLButtonElement>('check'),
  modelLabel: el<HTMLLabelElement>('model-label'),
  model: el<HTMLSelectElement>('model'),
  modelInfo: el<HTMLDivElement>('model-info'),
  srcLabel: el<HTMLLabelElement>('src-label'),
  src: el<HTMLSelectElement>('src'),
  textLabel: el<HTMLLabelElement>('text-label'),
  text: el<HTMLTextAreaElement>('text'),
  run: el<HTMLButtonElement>('run'),
  cancel: el<HTMLButtonElement>('cancel'),
  output: el<HTMLPreElement>('output'),
  stats: el<HTMLDivElement>('stats'),
  error: el<HTMLDivElement>('error'),
  cors: el<HTMLDivElement>('cors'),
  corsHelp: el<HTMLParagraphElement>('cors-help'),
  corsCmd: el<HTMLPreElement>('cors-cmd'),
  copy: el<HTMLButtonElement>('copy'),
  corsRestart: el<HTMLParagraphElement>('cors-restart'),
};

let activePort: Port | undefined;
let activeJobId: string | undefined;

function setStaticText(): void {
  ui.title.textContent = vi.popup.title;
  ui.status.textContent = vi.popup.notChecked;
  ui.check.textContent = vi.popup.checkConnection;
  ui.modelLabel.textContent = vi.popup.modelLabel;
  ui.srcLabel.textContent = vi.popup.sourceLabel;
  ui.textLabel.textContent = vi.popup.textLabel;
  ui.run.textContent = vi.popup.translateTest;
  ui.cancel.textContent = vi.popup.cancel;
  ui.copy.textContent = vi.popup.copy;
  ui.corsRestart.textContent = vi.corsRestart;
  for (const lang of SOURCE_LANGS) {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = lang;
    ui.src.append(option);
  }
  ui.text.value = SAMPLES.en.paragraph;
}

function showCors(show: boolean): void {
  ui.cors.hidden = !show;
  if (show) {
    ui.corsHelp.textContent = vi.errors.E_CORS;
    ui.corsCmd.textContent = vi.corsCommand(browser.runtime.id);
    ui.copy.textContent = vi.popup.copy;
  }
}

function showError(code: ErrorCode, message: string): void {
  ui.error.hidden = false;
  ui.error.textContent = `${code} — ${vi.errors[code]} ${message}`.trim();
  showCors(code === 'E_CORS');
}

function clearError(): void {
  ui.error.hidden = true;
  ui.error.textContent = '';
  showCors(false);
}

async function checkConnection(): Promise<void> {
  ui.status.textContent = vi.popup.checking;
  clearError();
  const request: StatusGet = { type: 'status.get' };
  const reply: unknown = await browser.runtime.sendMessage(request);
  if (!isPopupReply(reply) || reply.type !== 'status') {
    ui.status.textContent = vi.ollama.error;
    log.warn('unexpected status reply', reply);
    return;
  }
  renderStatus(reply);
}

function renderStatus(status: StatusMsg): void {
  const version = status.version ? ` ${status.version}` : '';
  ui.status.textContent = `Ollama${version} · ${vi.ollama[status.ollama]}`;
  if (status.error) showError(status.error.code, status.error.message);

  const loaded = new Set(status.loaded.map((model) => model.name));
  const previous = ui.model.value;
  ui.model.replaceChildren();
  if (status.models.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = vi.popup.noModels;
    ui.model.append(option);
  }
  for (const model of status.models) {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = loaded.has(model.name) ? `• ${model.name} (${vi.popup.warm})` : model.name;
    ui.model.append(option);
  }
  void restoreModel(previous);
}

async function restoreModel(previous: string): Promise<void> {
  const stored = await browser.storage.local.get(MODEL_KEY);
  const remembered = stored[MODEL_KEY];
  const wanted = previous || (typeof remembered === 'string' ? remembered : '');
  const names = [...ui.model.options].map((option) => option.value);
  if (wanted && names.includes(wanted)) ui.model.value = wanted;
  if (ui.model.value) await describeModel(ui.model.value);
}

async function describeModel(model: string): Promise<void> {
  ui.modelInfo.textContent = vi.popup.describing;
  await browser.storage.local.set({ [MODEL_KEY]: model });
  const request: ModelDescribe = { type: 'model.describe', model };
  const reply: unknown = await browser.runtime.sendMessage(request);
  if (!isPopupReply(reply) || reply.type !== 'model.described') {
    ui.modelInfo.textContent = vi.ollama.error;
    log.warn('unexpected describe reply', reply);
    return;
  }
  renderModel(reply);
}

function renderModel(reply: ModelDescribed): void {
  if ('error' in reply) {
    ui.modelInfo.textContent = `${vi.profileLabel(pickProfile(reply.model))} · ${reply.error.code}`;
    showError(reply.error.code, reply.error.message);
    return;
  }
  const context =
    reply.contextLength === null
      ? vi.popup.unknownContext
      : `ctx ${reply.contextLength.toLocaleString('vi-VN')}`;
  ui.modelInfo.textContent = `${vi.profileLabel(reply.profile)} · ${context} · ${reply.capabilities.join(', ')}`;
}

function finishTest(): void {
  const port = activePort;
  activePort = undefined;
  activeJobId = undefined;
  port?.disconnect();
  ui.run.disabled = false;
  ui.cancel.disabled = true;
}

function cancelTest(): void {
  if (activePort && activeJobId) {
    const cancel: JobCancel = { type: 'job.cancel', jobId: activeJobId };
    try {
      activePort.postMessage(cancel);
    } catch (error) {
      log.warn('port already closed', error);
    }
    ui.stats.textContent = vi.popup.cancelled;
  }
  finishTest();
}

function startTest(): void {
  const model = ui.model.value;
  const src = ui.src.value;
  const text = ui.text.value.trim();
  if (!model || !isSourceLang(src) || !text) return;

  finishTest();
  clearError();
  ui.output.textContent = '';
  ui.stats.textContent = vi.popup.translating;
  ui.run.disabled = true;
  ui.cancel.disabled = false;

  const jobId = crypto.randomUUID();
  const port = browser.runtime.connect({ name: PORT_NAME });
  activePort = port;
  activeJobId = jobId;

  let settled = false; // a seg.done or seg.error arrived for this job
  port.onMessage.addListener((raw: unknown) => {
    if (!isPortReply(raw) || raw.jobId !== jobId) return;
    if (raw.type === 'seg.partial') {
      ui.output.textContent = raw.text;
      ui.stats.textContent = `${raw.tokens} ${vi.popup.tokens}`;
      return;
    }
    settled = true;
    if (raw.type === 'seg.done') {
      ui.output.textContent = raw.text;
      const stats = raw.stats;
      ui.stats.textContent = stats
        ? vi.statsLine(
            stats.ttftMs,
            stats.evalDurationMs > 0 ? (stats.evalCount * 1000) / stats.evalDurationMs : 0,
            stats.evalCount,
            stats.doneReason,
          )
        : '';
    } else {
      // Fail-closed: a half-streamed translation never stays on screen next to an error.
      ui.output.textContent = '';
      showError(raw.code, raw.message);
      ui.stats.textContent = '';
    }
    finishTest();
  });
  port.onDisconnect.addListener(() => {
    if (activePort !== port) return;
    if (!settled) {
      // Chrome killed the service worker mid-request: no seg.done/seg.error will ever arrive.
      ui.output.textContent = '';
      ui.stats.textContent = '';
      ui.error.hidden = false;
      ui.error.textContent = vi.popup.disconnected;
    }
    finishTest();
  });

  void (async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const start: JobStart = {
      type: 'job.start',
      jobId,
      tabId: tab?.id ?? -1,
      frameId: 0,
      src,
      tgt: 'vi',
      model,
      profile: pickProfile(model), // derived at send time: model.describe may not have replied yet
      url: TEST_URL,
      title: TEST_TITLE,
    };
    const batch: BatchTranslate = {
      type: 'batch.translate',
      jobId,
      batchId: 'b1',
      priority: 0,
      segments: [{ id: 's1', text, tokensEst: tokensEst(text, src) }],
    };
    port.postMessage(start);
    port.postMessage(batch);
  })();
}

async function copyCommand(): Promise<void> {
  await navigator.clipboard.writeText(ui.corsCmd.textContent ?? '');
  ui.copy.textContent = vi.popup.copied;
}

setStaticText();
ui.check.addEventListener('click', () => void checkConnection());
ui.model.addEventListener('change', () => void describeModel(ui.model.value));
ui.src.addEventListener('change', () => {
  const src = ui.src.value;
  if (isSourceLang(src)) ui.text.value = SAMPLES[src].paragraph;
});
ui.run.addEventListener('click', startTest);
ui.cancel.addEventListener('click', cancelTest);
ui.copy.addEventListener('click', () => void copyCommand());
void checkConnection();
