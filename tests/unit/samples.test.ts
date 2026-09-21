import { describe, expect, it } from 'vitest';
import { SOURCE_LANGS } from '../../src/lib/lang/codes.ts';
import { SAMPLES } from '../../src/lib/samples.ts';

describe('samples', () => {
  it.each(SOURCE_LANGS)('%s has a paragraph with placeholders and three sentences', (lang) => {
    const sample = SAMPLES[lang];
    expect(sample.paragraph.length).toBeGreaterThan(150);
    expect(sample.paragraph).toContain('<1>');
    expect(sample.paragraph).toContain('</1>');
    expect(sample.paragraph).toContain('<2/>');
    expect(sample.sentences).toHaveLength(3);
    for (const sentence of sample.sentences) expect(sentence.length).toBeGreaterThan(25);
    expect(sample.sentences[1]).toContain('<1>');
  });
});
