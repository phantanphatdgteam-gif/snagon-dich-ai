import { describe, expect, it } from 'vitest';
import { SOURCE_LANGS, SOURCE_LANG_NAME, TARGET_LANG, isSourceLang } from '../../src/lib/lang/codes.ts';

describe('lang/codes', () => {
  it('lists the five source languages of spec §6.1 and targets vi', () => {
    expect([...SOURCE_LANGS]).toEqual(['en', 'ru', 'zh-Hans', 'zh-Hant', 'th']);
    expect(TARGET_LANG).toBe('vi');
  });

  it('maps codes to the names used verbatim in the TranslateGemma template', () => {
    expect(SOURCE_LANG_NAME).toEqual({
      en: 'English',
      ru: 'Russian',
      'zh-Hans': 'Chinese',
      'zh-Hant': 'Chinese',
      th: 'Thai',
    });
  });

  it('guards unknown values', () => {
    expect(isSourceLang('ru')).toBe(true);
    expect(isSourceLang('zh')).toBe(false);
    expect(isSourceLang(42)).toBe(false);
  });
});
