export const PROFILES = ['translategemma', 'instruct-json'] as const;
export type Profile = (typeof PROFILES)[number];

export function isProfile(value: unknown): value is Profile {
  return typeof value === 'string' && (PROFILES as readonly string[]).includes(value);
}

/**
 * Spec §7.1 wanted to read the template from /api/show, but translategemma ships the plain
 * Gemma-3 chat template and gemma4 returns "{{ .Prompt }}" (checked 2026-09-21), so the model
 * name decides: translategemma* → profile A, everything else → profile B.
 */
export function pickProfile(modelName: string): Profile {
  return /^translategemma(?::|$)/i.test(modelName.trim()) ? 'translategemma' : 'instruct-json';
}
