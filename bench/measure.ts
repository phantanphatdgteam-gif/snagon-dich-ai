// Live measurement against the real Ollama (design §6). Runs the extension's own provider code.
// Usage:  SNAGON_LIVE=1 pnpm bench -- [--model gemma4:26b]... [--runs 3] [--out bench/results]
//         SNAGON_LIVE=1 pnpm bench -- --probe
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSnagonError } from '../src/lib/errors.ts';
import { SOURCE_LANGS, type SourceLang } from '../src/lib/lang/codes.ts';
import { pickProfile, type Profile } from '../src/lib/prompt/profile.ts';
import { DEFAULT_OLLAMA_URL, createOllamaProvider } from '../src/lib/provider/ollama.ts';
import type { GenStats, TranslateBatch, TranslateProvider } from '../src/lib/provider/types.ts';
import { SAMPLES } from '../src/lib/samples.ts';
import { tokensEst } from '../src/lib/tokens.ts';
import {
  CSV_HEADER,
  csvLine,
  markdownTable,
  parseArgs,
  rowLine,
  summarize,
  tagOk,
  tokPerSec,
  type CsvRow,
} from './lib.ts';

const CONTEXT = { title: 'Snagon bench', domain: 'example.com' };

interface Outcome {
  stats: GenStats;
  outputs: string[];
  tagOk: boolean;
  charsIn: number;
  charsOut: number;
  /** Segment ids the provider never yielded — nothing was translated for them (§5.6). */
  missing: string[];
}

/** '' when every segment came back; otherwise the code the run is recorded under. */
function failureCode(outcome: Outcome): 'E_TRUNC' | 'E_OUTPUT' | '' {
  if (outcome.missing.length === 0) return '';
  return outcome.stats.doneReason === 'length' ? 'E_TRUNC' : 'E_OUTPUT';
}

function joinReason(errorCode: string, stats: GenStats | undefined): string {
  return stats ? `${errorCode}/${stats.doneReason}` : errorCode;
}

function describeFailure(outcome: Outcome, code: string): string {
  return `${code} — no translation for ${outcome.missing.join('+')} · ttft ${Math.round(outcome.stats.ttftMs)} ms · done_reason ${outcome.stats.doneReason}`;
}

function describeError(error: unknown): string {
  if (isSnagonError(error)) {
    return `${error.code}: ${error.message}${error.detail ? ` (${error.detail})` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function makeBatch(
  model: string,
  profile: Profile,
  lang: SourceLang,
  inputs: readonly string[],
): TranslateBatch {
  return {
    model,
    profile,
    src: lang,
    tgt: 'vi',
    segments: inputs.map((text, index) => ({
      id: `s${index + 1}`,
      text,
      tokensEst: tokensEst(text, lang),
    })),
    context: CONTEXT,
  };
}

async function translateOnce(
  provider: TranslateProvider,
  batch: TranslateBatch,
  signal: AbortSignal = new AbortController().signal,
): Promise<Outcome> {
  const texts = new Map<string, string>();
  let stats: GenStats | undefined;
  for await (const chunk of provider.translate(batch, signal)) {
    if (chunk.kind === 'segment') texts.set(chunk.id, chunk.text);
    else if (chunk.kind === 'done') stats = chunk.stats;
  }
  if (!stats) throw new Error('translate ended without stats (aborted?)');
  // The provider is fail-closed: output cut by num_predict, or empty, yields no segment at all.
  // Substituting the accumulated partial text here would publish a half-translation as a
  // finished measurement — and compute tag_ok on text the model never finished.
  const missing = batch.segments
    .filter((segment) => !texts.has(segment.id))
    .map((segment) => segment.id);
  const outputs = batch.segments.map((segment) => texts.get(segment.id) ?? '');
  return {
    stats,
    outputs,
    missing,
    tagOk:
      missing.length === 0 &&
      batch.segments.every((segment, index) => tagOk(segment.text, outputs[index] ?? '')),
    charsIn: batch.segments.reduce((sum, segment) => sum + segment.text.length, 0),
    charsOut: outputs.reduce((sum, text) => sum + text.length, 0),
  };
}

function row(
  base: {
    model: string;
    profile: Profile;
    lang: string;
    kind: string;
    run: number;
    loadedBefore: boolean;
  },
  outcome: Outcome | undefined,
  errorCode = '',
  /** Stats of a run that reached the model but produced no usable translation: a failure, measured. */
  failedStats?: GenStats,
): CsvRow {
  const stats = outcome?.stats ?? failedStats;
  return {
    ts: new Date().toISOString(),
    model: base.model,
    profile: base.profile,
    lang: base.lang,
    kind: base.kind,
    run: base.run,
    ttft_ms: stats?.ttftMs ?? '',
    total_ms: stats?.totalMs ?? '',
    prompt_eval_count: stats?.promptEvalCount ?? '',
    eval_count: stats?.evalCount ?? '',
    eval_duration_ms: stats?.evalDurationMs ?? '',
    tok_s: stats ? tokPerSec(stats.evalCount, stats.evalDurationMs) : '',
    // A failure keeps its code in this column; with stats it also keeps what Ollama reported.
    done_reason: errorCode === '' ? (stats?.doneReason ?? '') : joinReason(errorCode, stats),
    chars_in: outcome?.charsIn ?? '',
    chars_out: outcome?.charsOut ?? '',
    tag_ok: outcome?.tagOk ?? '',
    loaded_before: base.loadedBefore,
  };
}

async function measure(
  provider: TranslateProvider,
  models: string[],
  runs: number,
  out: string,
  stamp: string,
): Promise<void> {
  const csvPath = join(out, `m0-${stamp}.csv`);
  const jsonlPath = join(out, `m0-${stamp}.jsonl`);
  if (!existsSync(csvPath)) writeFileSync(csvPath, csvLine([...CSV_HEADER]) + '\n');
  const rows: CsvRow[] = [];
  const record = (entry: CsvRow): void => {
    rows.push(entry);
    appendFileSync(csvPath, rowLine(entry) + '\n');
  };
  const recordText = (entry: Record<string, unknown>): void => {
    appendFileSync(jsonlPath, JSON.stringify(entry) + '\n');
  };

  for (const model of models) {
    const profile = pickProfile(model);
    try {
      await provider.describe(model);
    } catch (error) {
      console.log(`skipped ${model}: ${describeError(error)}`);
      continue;
    }
    const loadedBefore = (await provider.loaded()).some((loaded) => loaded.name === model);
    const startedAt = performance.now();
    await provider.warmUp(model);
    const warmupMs = performance.now() - startedAt;
    const warmupRow = row(
      { model, profile, lang: '', kind: 'warmup', run: 0, loadedBefore },
      undefined,
    );
    record({ ...warmupRow, total_ms: warmupMs, done_reason: 'load' });
    console.log(
      `\n${model} (${profile}) warm-up ${Math.round(warmupMs)} ms · loaded before: ${loadedBefore}`,
    );

    for (const lang of SOURCE_LANGS) {
      const sample = SAMPLES[lang];
      for (let run = 1; run <= runs; run += 1) {
        const base = { model, profile, lang, kind: 'single', run, loadedBefore };
        try {
          const outcome = await translateOnce(
            provider,
            makeBatch(model, profile, lang, [sample.paragraph]),
          );
          const failure = failureCode(outcome);
          if (failure !== '') {
            record(row(base, undefined, failure, outcome.stats));
            console.log(`  ${lang} run ${run}: ${describeFailure(outcome, failure)}`);
            continue;
          }
          record(row(base, outcome));
          recordText({ ...base, input: sample.paragraph, output: outcome.outputs[0] });
          const tokS = tokPerSec(outcome.stats.evalCount, outcome.stats.evalDurationMs).toFixed(1);
          console.log(
            `  ${lang} run ${run}: ttft ${Math.round(outcome.stats.ttftMs)} ms · ${tokS} tok/s · ${outcome.stats.doneReason} · tag_ok ${outcome.tagOk}`,
          );
        } catch (error) {
          const code = isSnagonError(error) ? error.code : 'ERROR';
          record(row(base, undefined, code));
          console.log(`  ${lang} run ${run}: ${describeError(error)}`);
        }
      }
      if (profile === 'instruct-json') {
        const base = { model, profile, lang, kind: 'batch3', run: 1, loadedBefore };
        try {
          const outcome = await translateOnce(
            provider,
            makeBatch(model, profile, lang, sample.sentences),
          );
          const failure = failureCode(outcome);
          if (failure !== '') {
            record(row(base, undefined, failure, outcome.stats));
            console.log(`  ${lang} batch3: ${describeFailure(outcome, failure)}`);
          } else {
            record(row(base, outcome));
            recordText({ ...base, input: sample.sentences, output: outcome.outputs });
            console.log(
              `  ${lang} batch3: ttft ${Math.round(outcome.stats.ttftMs)} ms · ${outcome.stats.doneReason} · tag_ok ${outcome.tagOk}`,
            );
          }
        } catch (error) {
          record(row(base, undefined, isSnagonError(error) ? error.code : 'ERROR'));
          console.log(`  ${lang} batch3: ${describeError(error)}`);
        }
      }
    }
  }

  console.log('\n' + markdownTable(summarize(rows)));
  console.log(`\nCSV: ${csvPath}\nJSONL (gitignored): ${jsonlPath}`);
}

async function probes(provider: TranslateProvider, out: string, stamp: string): Promise<void> {
  const csvPath = join(out, `m0-probe-${stamp}.csv`);
  if (!existsSync(csvPath)) writeFileSync(csvPath, 'ts,probe,model,result,detail\n');
  const record = (probe: string, model: string, result: 'ok' | 'fail', detail: string): void => {
    appendFileSync(
      csvPath,
      csvLine([new Date().toISOString(), probe, model, result, detail]) + '\n',
    );
    console.log(`${probe} [${model}]: ${result} — ${detail}`);
  };
  const firstSentence = SAMPLES.en.sentences[0];

  // P1 — `format` schema together with `stream: true` (design §6.2).
  try {
    await provider.warmUp('gemma4:26b');
    let progressChunks = 0;
    const ids: string[] = [];
    let doneReason = '';
    const batch = makeBatch('gemma4:26b', 'instruct-json', 'en', SAMPLES.en.sentences);
    for await (const chunk of provider.translate(batch, new AbortController().signal)) {
      if (chunk.kind === 'progress') progressChunks += 1;
      else if (chunk.kind === 'segment') ids.push(chunk.id);
      else doneReason = chunk.stats.doneReason;
    }
    const ok = progressChunks >= 2 && ids.length === 3;
    record(
      'P1_format_stream',
      'gemma4:26b',
      ok ? 'ok' : 'fail',
      `progress_chunks=${progressChunks} segments=${ids.join('+')} done_reason=${doneReason}`,
    );
  } catch (error) {
    record('P1_format_stream', 'gemma4:26b', 'fail', describeError(error));
  }

  // P2 — client abort stops generation on the server (spec §7.3, Ollama 0.34.2).
  try {
    await provider.warmUp('translategemma:12b');
    const short = makeBatch('translategemma:12b', 'translategemma', 'en', [firstSentence]);
    const baseline = (await translateOnce(provider, short)).stats.ttftMs;
    const controller = new AbortController();
    let seen = 0;
    const long = makeBatch('translategemma:12b', 'translategemma', 'en', [SAMPLES.en.paragraph]);
    for await (const chunk of provider.translate(long, controller.signal)) {
      if (chunk.kind === 'progress') {
        seen += 1;
        if (seen >= 5) controller.abort();
      }
    }
    const after = (await translateOnce(provider, short)).stats.ttftMs;
    const ok = after - baseline < 1500;
    record(
      'P2_abort_stops',
      'translategemma:12b',
      ok ? 'ok' : 'fail',
      `ttft_baseline_ms=${Math.round(baseline)} ttft_after_abort_ms=${Math.round(after)}`,
    );
  } catch (error) {
    record('P2_abort_stops', 'translategemma:12b', 'fail', describeError(error));
  }

  // P3 — `think: false` is accepted by a model without the thinking capability (spec §6.2).
  try {
    const batch = makeBatch('translategemma:12b', 'instruct-json', 'en', [firstSentence]);
    const outcome = await translateOnce(provider, batch);
    record('P3_think_false', 'translategemma:12b', 'ok', `done_reason=${outcome.stats.doneReason}`);
  } catch (error) {
    record('P3_think_false', 'translategemma:12b', 'fail', describeError(error));
  }
}

async function main(): Promise<void> {
  if (process.env.SNAGON_LIVE !== '1') {
    console.log(
      'bench skipped: set SNAGON_LIVE=1 to run against the real Ollama (ask Phát first — it occupies the GPU for minutes).',
    );
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.SNAGON_OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  const provider = createOllamaProvider({ baseUrl });
  console.log(`Ollama ${await provider.version()} at ${baseUrl}`);
  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (args.probe) await probes(provider, args.out, stamp);
  else await measure(provider, args.models, args.runs, args.out, stamp);
}

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exit(1);
});
