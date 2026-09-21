export interface BenchArgs {
  models: string[];
  runs: number;
  probe: boolean;
  out: string;
}

/** Spec §13: four candidates plus the MLX build. Missing models are skipped at runtime, not fatal. */
export const DEFAULT_MODELS = [
  'gemma4:26b',
  'translategemma:12b',
  'translategemma:27b',
  'qwen3.5:27b',
  'gemma4:26b-mlx',
];

export function parseArgs(argv: readonly string[]): BenchArgs {
  const args: BenchArgs = { models: [], runs: 3, probe: false, out: 'bench/results' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--model') {
      const value = argv[index + 1];
      if (!value) throw new Error('--model needs a value');
      args.models.push(value);
      index += 1;
    } else if (arg === '--runs') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--runs needs a positive integer');
      args.runs = value;
      index += 1;
    } else if (arg === '--probe') {
      args.probe = true;
    } else if (arg === '--') {
      // pnpm 11 forwards the separator itself: `pnpm bench -- --probe` execs
      // `node bench/measure.ts -- --probe`, so the documented invocation must not be an error.
      continue;
    } else if (arg === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out needs a value');
      args.out = value;
      index += 1;
    } else {
      throw new Error(`unknown argument ${String(arg)}`);
    }
  }
  if (args.models.length === 0) args.models = [...DEFAULT_MODELS];
  return args;
}

/** Placeholder tags (<1>, </1>, <2/>) in order of appearance. */
export function tagSet(text: string): string[] {
  return text.match(/<\/?\d+\s*\/?>/g) ?? [];
}

/** Sanity indicator for spec §5.6 tag integrity: same multiset of tags in and out. */
export function tagOk(input: string, output: string): boolean {
  const expected = tagSet(input).sort();
  const actual = tagSet(output).sort();
  return expected.length === actual.length && expected.every((tag, index) => tag === actual[index]);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? Number.NaN;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1] ?? Number.NaN;
  return (lower + upper) / 2;
}

export function tokPerSec(evalCount: number, evalDurationMs: number): number {
  return evalDurationMs > 0 ? (evalCount * 1000) / evalDurationMs : 0;
}

export const CSV_HEADER = [
  'ts',
  'model',
  'profile',
  'lang',
  'kind',
  'run',
  'ttft_ms',
  'total_ms',
  'prompt_eval_count',
  'eval_count',
  'eval_duration_ms',
  'tok_s',
  'done_reason',
  'chars_in',
  'chars_out',
  'tag_ok',
  'loaded_before',
] as const;

export type CsvValue = string | number | boolean;
export type CsvRow = Record<(typeof CSV_HEADER)[number], CsvValue>;

export function csvLine(values: readonly CsvValue[]): string {
  return values
    .map((value) => {
      const text =
        typeof value === 'number'
          ? Number.isFinite(value)
            ? String(Math.round(value * 100) / 100)
            : ''
          : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(',');
}

export function rowLine(row: CsvRow): string {
  return csvLine(CSV_HEADER.map((key) => row[key]));
}

export interface SummaryRow {
  model: string;
  profile: string;
  warmupMs: number;
  ttftMs: number;
  tokS: number;
  tagOkPct: number;
  n: number;
}

/** Medians over successful `single` rows per model+profile (error rows have no ttft); warm-up time from the `warmup` row. */
export function summarize(rows: readonly CsvRow[]): SummaryRow[] {
  const groups = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = `${String(row.model)}|${String(row.profile)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => {
    const [model = '', profile = ''] = key.split('|');
    const singles = list.filter((row) => row.kind === 'single' && row.ttft_ms !== '');
    const warmup = list.find((row) => row.kind === 'warmup');
    const okCount = singles.filter((row) => row.tag_ok === true || row.tag_ok === 'true').length;
    return {
      model,
      profile,
      warmupMs: warmup ? Number(warmup.total_ms) : Number.NaN,
      ttftMs: median(singles.map((row) => Number(row.ttft_ms))),
      tokS: median(singles.map((row) => Number(row.tok_s))),
      tagOkPct: singles.length > 0 ? (100 * okCount) / singles.length : Number.NaN,
      n: singles.length,
    };
  });
}

export function markdownTable(rows: readonly SummaryRow[]): string {
  const format = (value: number, digits = 0): string =>
    Number.isFinite(value) ? value.toFixed(digits) : '—';
  const lines = [
    '| Model | Profile | Warm-up ms | TTFT ms (median) | tok/s (median) | tag_ok % | n |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.model} | ${row.profile} | ${format(row.warmupMs)} | ${format(row.ttftMs)} | ${format(row.tokS, 1)} | ${format(row.tagOkPct)} | ${row.n} |`,
    );
  }
  return lines.join('\n');
}
