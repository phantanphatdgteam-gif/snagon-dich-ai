import { SnagonError } from '../errors.ts';
import { SOURCE_LANG_NAME, type SourceLang } from '../lang/codes.ts';

/** Sampling options for profile B (spec §6.2): deliberately below Gemma 4's general-purpose defaults. */
export const INSTRUCT_JSON_OPTIONS = { temperature: 0.3, top_p: 0.95, top_k: 64 } as const;
export const INSTRUCT_JSON_NUM_PREDICT_EXTRA = 128;

/** JSON schema sent as `format` (spec §7.3). Constrained decoding enforces the shape; ids are still checked by the caller. */
export const TRANSLATIONS_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
} as const;

/** System prompt from spec §6.2, verbatim. `glossaryLines` is the empty hook the spec keeps for later (no glossary in v1). */
export function buildInstructJsonSystem(
  src: SourceLang,
  glossaryLines: readonly string[] = [],
): string {
  const name = SOURCE_LANG_NAME[src];
  return [
    `You translate web page text from ${name} into natural, fluent Vietnamese for a Vietnamese professional reader.`,
    'Rules:',
    '1. Translate meaning, not word by word. Restructure sentences when Vietnamese grammar requires it: subject-verb-object order, active voice where natural, no dangling passive constructions.',
    '2. Translate everything, including technical, financial and e-commerce terminology, into the Vietnamese term a professional would use. Do not leave source-language words untranslated unless they are proper nouns, brand names, or code identifiers.',
    '3. Keep every placeholder tag exactly as given (<1>...</1>, <2/>). Never add, drop, reorder or re-nest them.',
    '4. Keep numbers, units, percentages, currency codes, URLs, emails, product codes and code identifiers unchanged.',
    '5. Register: neutral-formal, impersonal; never "bạn/mình". No explanations, notes, transliterations in brackets, or quotation marks around the output.',
    '6. Return ONLY JSON matching the schema {"translations":[{"id":"...","text":"..."}]}: one item per input id, same ids, same order.',
    ...glossaryLines,
  ].join('\n');
}

export interface InstructJsonContext {
  title: string;
  domain: string;
}

export interface InstructJsonSegment {
  id: string;
  text: string;
}

/** User message: JSON with the page context and the batch segments (spec §6.2). Page text is data, never instructions. */
export function buildInstructJsonUser(
  src: SourceLang,
  context: InstructJsonContext,
  segments: readonly InstructJsonSegment[],
): string {
  return JSON.stringify({
    source_lang: src,
    context: { title: context.title, domain: context.domain },
    segments: segments.map((segment) => ({ id: segment.id, text: segment.text })),
  });
}

export interface Translation {
  id: string;
  text: string;
}

/** Parses the model's JSON output. Anything that is not `{translations:[{id,text}]}` → E_OUTPUT. */
export function parseTranslations(content: string): Translation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new SnagonError('E_OUTPUT', 'model output is not valid JSON', content.slice(0, 200));
  }
  const list = (parsed as { translations?: unknown } | null)?.translations;
  if (!Array.isArray(list)) {
    throw new SnagonError(
      'E_OUTPUT',
      'model output has no translations array',
      content.slice(0, 200),
    );
  }
  const translations: Translation[] = [];
  for (const item of list as unknown[]) {
    const id = (item as { id?: unknown } | null)?.id;
    const text = (item as { text?: unknown } | null)?.text;
    if (typeof id !== 'string' || typeof text !== 'string') {
      throw new SnagonError(
        'E_OUTPUT',
        'translation item must have string id and text',
        JSON.stringify(item).slice(0, 200),
      );
    }
    translations.push({ id, text });
  }
  return translations;
}
