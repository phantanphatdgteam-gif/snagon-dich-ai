export const SOURCE_LANGS = ['en', 'ru', 'zh-Hans', 'zh-Hant', 'th'] as const;
export type SourceLang = (typeof SOURCE_LANGS)[number];

export const TARGET_LANG = 'vi';
export type TargetLang = typeof TARGET_LANG;

/** Language names used verbatim in the prompt templates (spec §6.1). */
export const SOURCE_LANG_NAME: Record<SourceLang, string> = {
  en: 'English',
  ru: 'Russian',
  'zh-Hans': 'Chinese',
  'zh-Hant': 'Chinese',
  th: 'Thai',
};

export function isSourceLang(value: unknown): value is SourceLang {
  return typeof value === 'string' && (SOURCE_LANGS as readonly string[]).includes(value);
}
