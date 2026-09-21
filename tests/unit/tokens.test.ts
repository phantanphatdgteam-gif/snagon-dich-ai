import { describe, expect, it } from 'vitest';
import { NUM_PREDICT_CAP, numPredict, tokensEst } from '../../src/lib/tokens.ts';

describe('tokensEst', () => {
  it('uses chars/3.5 for English, rounding up', () => {
    expect(tokensEst('a'.repeat(35), 'en')).toBe(10);
    expect(tokensEst('a'.repeat(36), 'en')).toBe(11);
  });

  it('uses chars/2.5 for Russian and Thai', () => {
    expect(tokensEst('б'.repeat(25), 'ru')).toBe(10);
    expect(tokensEst('ก'.repeat(25), 'th')).toBe(10);
  });

  it('uses chars/1.3 for both Chinese scripts', () => {
    expect(tokensEst('中'.repeat(4), 'zh-Hans')).toBe(4); // 3.08 → 4
    expect(tokensEst('中'.repeat(3), 'zh-Hant')).toBe(3); // 2.31 → 3
  });

  it('never returns less than 1', () => {
    expect(tokensEst('', 'en')).toBe(1);
  });
});

describe('numPredict', () => {
  it('is 3 × input tokens + the profile constant', () => {
    expect(numPredict(100, 64)).toBe(364);
    expect(numPredict(100, 128)).toBe(428);
  });

  it('caps at 2048 (spec §7.3)', () => {
    expect(NUM_PREDICT_CAP).toBe(2048);
    expect(numPredict(1000, 128)).toBe(2048);
  });
});
