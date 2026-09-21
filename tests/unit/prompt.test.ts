import { describe, expect, it } from 'vitest';
import { SnagonError } from '../../src/lib/errors.ts';
import {
  KEEP_ALIVE,
  NUM_CTX,
  PROMPT_VERSION,
  buildChatRequest,
  type PromptBatch,
} from '../../src/lib/prompt/index.ts';
import {
  TRANSLATIONS_SCHEMA,
  buildInstructJsonSystem,
  parseTranslations,
} from '../../src/lib/prompt/instruct-json.ts';
import { isProfile, pickProfile } from '../../src/lib/prompt/profile.ts';
import { buildTranslateGemmaPrompt } from '../../src/lib/prompt/translategemma.ts';

const EXPECTED_A_RU =
  'You are a professional Russian (ru) to Vietnamese (vi) translator. Your goal is to accurately convey the meaning and nuances of the original Russian text while adhering to Vietnamese grammar, vocabulary, and cultural sensitivities.\n' +
  'Produce only the Vietnamese translation, without any additional explanations or commentary. Please translate the following Russian text into Vietnamese:\n' +
  '\n' +
  '\n' +
  'Привет';

function batch(overrides: Partial<PromptBatch> = {}): PromptBatch {
  return {
    model: 'translategemma:12b',
    profile: 'translategemma',
    src: 'en',
    segments: [{ id: 's1', text: 'Hello <1>world</1>', tokensEst: 6 }],
    context: { title: 'Snagon test', domain: 'example.com' },
    ...overrides,
  };
}

function thrownCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof SnagonError ? error.code : `not a SnagonError: ${String(error)}`;
  }
}

describe('pickProfile (by model name — /api/show template is not distinctive)', () => {
  it.each([
    ['translategemma:12b', 'translategemma'],
    ['translategemma', 'translategemma'],
    ['TranslateGemma:27b', 'translategemma'],
    ['gemma4:26b', 'instruct-json'],
    ['qwen3.5:27b', 'instruct-json'],
    ['translategemma-custom:1b', 'instruct-json'],
  ])('%s → %s', (name, profile) => {
    expect(pickProfile(name)).toBe(profile);
  });

  it('guards profile values', () => {
    expect(isProfile('instruct-json')).toBe(true);
    expect(isProfile('A')).toBe(false);
  });
});

describe('profile A template (spec §6.1)', () => {
  it('is byte-exact, with two blank lines before the text', () => {
    expect(buildTranslateGemmaPrompt('ru', 'Привет')).toBe(EXPECTED_A_RU);
  });

  it.each([
    ['en', 'English (en)'],
    ['zh-Hans', 'Chinese (zh-Hans)'],
    ['zh-Hant', 'Chinese (zh-Hant)'],
    ['th', 'Thai (th)'],
  ] as const)('names %s as %s', (src, label) => {
    expect(buildTranslateGemmaPrompt(src, 'x')).toContain(
      `You are a professional ${label} to Vietnamese (vi) translator.`,
    );
  });
});

describe('buildChatRequest — profile A', () => {
  it('sends one user message, no system/think/format, and the §6.1 options', () => {
    const req = buildChatRequest(batch());
    expect(req.model).toBe('translategemma:12b');
    expect(req.messages).toEqual([
      { role: 'user', content: buildTranslateGemmaPrompt('en', 'Hello <1>world</1>') },
    ]);
    expect(req).not.toHaveProperty('think');
    expect(req).not.toHaveProperty('format');
    expect(req.stream).toBe(true);
    expect(req.keep_alive).toBe('10m');
    expect(req.options).toEqual({
      temperature: 0.2,
      top_p: 0.9,
      seed: 42,
      num_ctx: 8192,
      num_predict: 3 * 6 + 64,
    });
  });

  it('refuses more than one segment', () => {
    const two = [
      { id: 'a', text: 'a', tokensEst: 1 },
      { id: 'b', text: 'b', tokensEst: 1 },
    ];
    expect(() => buildChatRequest(batch({ segments: two }))).toThrow(/exactly one segment/);
  });
});

describe('buildChatRequest — profile B', () => {
  const two = batch({
    model: 'gemma4:26b',
    profile: 'instruct-json',
    src: 'ru',
    segments: [
      { id: 's1', text: 'Привет <1>мир</1>', tokensEst: 5 },
      { id: 's2', text: 'Пока', tokensEst: 2 },
    ],
  });

  it('sends system §6.2 + JSON user message, think:false, format schema and the §6.2 options', () => {
    const req = buildChatRequest(two);
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]).toEqual({ role: 'system', content: buildInstructJsonSystem('ru') });
    expect(req.messages[1]?.role).toBe('user');
    expect(JSON.parse(req.messages[1]?.content ?? '')).toEqual({
      source_lang: 'ru',
      context: { title: 'Snagon test', domain: 'example.com' },
      segments: [
        { id: 's1', text: 'Привет <1>мир</1>' },
        { id: 's2', text: 'Пока' },
      ],
    });
    expect(req.think).toBe(false);
    expect(req.format).toBe(TRANSLATIONS_SCHEMA);
    expect(req.stream).toBe(true);
    expect(req.keep_alive).toBe('10m');
    expect(req.options).toEqual({
      temperature: 0.3,
      top_p: 0.95,
      top_k: 64,
      seed: 42,
      num_ctx: 8192,
      num_predict: 3 * 7 + 128,
    });
  });

  it('system prompt names the source language and carries the six rules verbatim', () => {
    const system = buildInstructJsonSystem('zh-Hans');
    expect(
      system.startsWith(
        'You translate web page text from Chinese into natural, fluent Vietnamese for a Vietnamese professional reader.\nRules:\n1. Translate meaning, not word by word.',
      ),
    ).toBe(true);
    expect(system).toContain(
      '3. Keep every placeholder tag exactly as given (<1>...</1>, <2/>). Never add, drop, reorder or re-nest them.',
    );
    expect(
      system.endsWith(
        '6. Return ONLY JSON matching the schema {"translations":[{"id":"...","text":"..."}]}: one item per input id, same ids, same order.',
      ),
    ).toBe(true);
    expect(buildInstructJsonSystem('en', ['Glossary: foo = bar'])).toMatch(
      /\nGlossary: foo = bar$/,
    );
  });

  it('caps num_predict at 2048 and always pins num_ctx 8192', () => {
    const req = buildChatRequest(
      batch({ profile: 'instruct-json', segments: [{ id: 's1', text: 'x', tokensEst: 900 }] }),
    );
    expect(req.options.num_predict).toBe(2048);
    expect(req.options.num_ctx).toBe(NUM_CTX);
    expect(NUM_CTX).toBe(8192);
    expect(KEEP_ALIVE).toBe('10m');
    expect(PROMPT_VERSION).toBe(1);
  });

  it('schema requires id and text and forbids extra properties', () => {
    expect(TRANSLATIONS_SCHEMA.required).toEqual(['translations']);
    expect(TRANSLATIONS_SCHEMA.properties.translations.items.required).toEqual(['id', 'text']);
    expect(TRANSLATIONS_SCHEMA.properties.translations.items.additionalProperties).toBe(false);
  });
});

describe('parseTranslations', () => {
  it('returns id/text pairs in order', () => {
    expect(
      parseTranslations(
        '{"translations":[{"id":"s2","text":"Tạm biệt"},{"id":"s1","text":"Xin chào"}]}',
      ),
    ).toEqual([
      { id: 's2', text: 'Tạm biệt' },
      { id: 's1', text: 'Xin chào' },
    ]);
  });

  it.each([
    'not json',
    '{"foo":1}',
    '{"translations":[{"id":1,"text":"x"}]}',
    '{"translations":[{"id":"s1"}]}',
  ])('rejects %s with E_OUTPUT', (content) => {
    expect(thrownCode(() => parseTranslations(content))).toBe('E_OUTPUT');
  });
});
