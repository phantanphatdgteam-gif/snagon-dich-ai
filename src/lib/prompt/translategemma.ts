import { SOURCE_LANG_NAME, type SourceLang } from '../lang/codes.ts';

/** Sampling options for profile A (spec §6.1). */
export const TRANSLATEGEMMA_OPTIONS = { temperature: 0.2, top_p: 0.9 } as const;
export const TRANSLATEGEMMA_NUM_PREDICT_EXTRA = 64;

/**
 * Template copied verbatim from spec §6.1 (the Ollama model card). The two blank lines
 * before the text are part of the contract — a wrong template degrades quality silently.
 */
export function buildTranslateGemmaPrompt(src: SourceLang, text: string): string {
  const name = SOURCE_LANG_NAME[src];
  return [
    `You are a professional ${name} (${src}) to Vietnamese (vi) translator. Your goal is to accurately convey the meaning and nuances of the original ${name} text while adhering to Vietnamese grammar, vocabulary, and cultural sensitivities.`,
    `Produce only the Vietnamese translation, without any additional explanations or commentary. Please translate the following ${name} text into Vietnamese:`,
    '',
    '',
    text,
  ].join('\n');
}
