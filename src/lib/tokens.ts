import type { SourceLang } from './lang/codes.ts';

/** Static chars-per-token ratios from spec §5.4. `th` is an assumption until the M0 bench calibrates it (LEDGER). */
export const CHARS_PER_TOKEN: Record<SourceLang, number> = {
  en: 3.5,
  ru: 2.5,
  'zh-Hans': 1.3,
  'zh-Hant': 1.3,
  th: 2.5,
};

/** Hard ceiling for `num_predict` on every request (spec §7.3), so no request can approach the 5-minute SW limit. */
export const NUM_PREDICT_CAP = 2048;

export function tokensEst(text: string, lang: SourceLang): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN[lang]));
}

/** Output budget per request: 3 × input tokens + a per-profile constant, capped (spec §6.1/§6.2/§7.3). */
export function numPredict(tokensIn: number, extra: number): number {
  return Math.min(NUM_PREDICT_CAP, 3 * tokensIn + extra);
}
