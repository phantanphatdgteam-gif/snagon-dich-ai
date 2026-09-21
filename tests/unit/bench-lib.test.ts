import { describe, expect, it } from 'vitest';
import {
  CSV_HEADER,
  DEFAULT_MODELS,
  csvLine,
  markdownTable,
  median,
  parseArgs,
  rowLine,
  summarize,
  tagOk,
  tagSet,
  tokPerSec,
  type CsvRow,
} from '../../bench/lib.ts';

describe('parseArgs', () => {
  it('defaults to the five M0 models, 3 runs, bench/results', () => {
    expect(parseArgs([])).toEqual({
      models: DEFAULT_MODELS,
      runs: 3,
      probe: false,
      out: 'bench/results',
    });
    expect(DEFAULT_MODELS).toEqual([
      'gemma4:26b',
      'translategemma:12b',
      'translategemma:27b',
      'qwen3.5:27b',
      'gemma4:26b-mlx',
    ]);
  });

  it('reads repeated --model, --runs, --probe, --out', () => {
    expect(
      parseArgs(['--model', 'a', '--model', 'b', '--runs', '5', '--probe', '--out', 'tmp']),
    ).toEqual({
      models: ['a', 'b'],
      runs: 5,
      probe: true,
      out: 'tmp',
    });
  });

  it('ignores the "--" separator pnpm forwards to the script', () => {
    expect(parseArgs(['--', '--probe'])).toEqual({
      models: DEFAULT_MODELS,
      runs: 3,
      probe: true,
      out: 'bench/results',
    });
  });

  it('rejects bad input', () => {
    expect(() => parseArgs(['--runs', '0'])).toThrow(/--runs/);
    expect(() => parseArgs(['--model'])).toThrow(/--model/);
    expect(() => parseArgs(['--wat'])).toThrow(/unknown argument/);
  });
});

describe('placeholder tags', () => {
  it('extracts tags in order', () => {
    expect(tagSet('a <1>b</1> c<2/> d')).toEqual(['<1>', '</1>', '<2/>']);
    expect(tagSet('plain')).toEqual([]);
  });

  it('tagOk compares the multiset of tags', () => {
    expect(tagOk('<1>a</1><2/>', '<2/><1>x</1>')).toBe(true);
    expect(tagOk('<1>a</1><2/>', '<1>x</1>')).toBe(false);
    expect(tagOk('<1>a</1>', '<1>x</1><1>y</1>')).toBe(false);
  });
});

describe('numbers', () => {
  it('median handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('tokPerSec guards zero duration', () => {
    expect(tokPerSec(100, 2000)).toBe(50);
    expect(tokPerSec(100, 0)).toBe(0);
  });
});

describe('csv', () => {
  it('quotes fields with commas or quotes and rounds numbers to 2 decimals', () => {
    expect(csvLine(['a', 'b,c', 'say "hi"', 1.2345, true, ''])).toBe(
      'a,"b,c","say ""hi""",1.23,true,',
    );
  });

  it('rowLine follows CSV_HEADER order', () => {
    const row = Object.fromEntries(CSV_HEADER.map((key) => [key, key])) as unknown as CsvRow;
    expect(rowLine(row)).toBe(CSV_HEADER.join(','));
  });
});

describe('summary', () => {
  const base: CsvRow = {
    ts: 't',
    model: 'gemma4:26b',
    profile: 'instruct-json',
    lang: 'en',
    kind: 'single',
    run: 1,
    ttft_ms: 100,
    total_ms: 1000,
    prompt_eval_count: 50,
    eval_count: 60,
    eval_duration_ms: 1000,
    tok_s: 60,
    done_reason: 'stop',
    chars_in: 300,
    chars_out: 320,
    tag_ok: true,
    loaded_before: true,
  };

  it('groups by model+profile with medians over single runs and the warm-up time', () => {
    const rows: CsvRow[] = [
      { ...base, kind: 'warmup', total_ms: 4000, done_reason: 'load', tag_ok: '' },
      base,
      { ...base, run: 2, ttft_ms: 300, tok_s: 50, tag_ok: false },
      { ...base, kind: 'batch3', ttft_ms: 999 },
    ];
    expect(summarize(rows)).toEqual([
      {
        model: 'gemma4:26b',
        profile: 'instruct-json',
        warmupMs: 4000,
        ttftMs: 200,
        tokS: 55,
        tagOkPct: 50,
        n: 2,
        failed: 0,
      },
    ]);
  });

  // A run whose segment never came back carries real stats but no tag_ok: it is a failure, and
  // folding its TTFT/tok-s into the medians would publish a truncation as a measurement.
  it('keeps failed single runs out of the medians and counts them', () => {
    const rows: CsvRow[] = [
      base,
      { ...base, run: 2, ttft_ms: 9000, tok_s: 5, done_reason: 'E_TRUNC/length', tag_ok: '' },
      { ...base, run: 3, ttft_ms: '', tok_s: '', done_reason: 'E_DOWN', tag_ok: '' },
    ];
    expect(summarize(rows)).toEqual([
      {
        model: 'gemma4:26b',
        profile: 'instruct-json',
        warmupMs: Number.NaN,
        ttftMs: 100,
        tokS: 60,
        tagOkPct: 100,
        n: 1,
        failed: 2,
      },
    ]);
  });

  // A warm-up that hit its deadline spent that time failing to load, not loading: reporting it as
  // "Warm-up ms" would publish a timeout as a measurement.
  it('does not report a failed warm-up as a warm-up time', () => {
    const rows: CsvRow[] = [
      { ...base, kind: 'warmup', total_ms: 60_000, done_reason: 'E_TIMEOUT', tag_ok: '' },
      base,
    ];
    expect(summarize(rows)[0]?.warmupMs).toBeNaN();
    expect(markdownTable(summarize(rows))).toContain('| gemma4:26b | instruct-json | — |');
  });

  it('renders a markdown table with the failure count', () => {
    const table = markdownTable(summarize([base]));
    expect(table.split('\n')).toHaveLength(3);
    expect(table).toContain('| Model | Profile | Warm-up ms | TTFT ms (median) |');
    expect(table).toContain('| tag_ok % | n | failed |');
    expect(table).toContain('| gemma4:26b | instruct-json | — | 100 | 60.0 | 100 | 1 | 0 |');
  });
});
