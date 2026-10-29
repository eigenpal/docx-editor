// In a legacy compatibility mode that compresses punctuation, in a document whose defaults name
// an East Asian face, a line at any alignment shrinks its inter-word spaces by up to 19.8
// percent of their advance to keep one more word, with no other test. A final half-width mark
// stays inside when the spaces make room for it, and hangs beside spaces at that limit.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer, type FixtureOptions } from './punctuation-kerning-fixture.ts';
import { caretAt } from '../semantic-interaction.ts';

// Every character, a space too, is 24 pt. Six words and their spaces take 432 pt; at 19.8
// percent of 24 pt, the six spaces lend 28.51 pt, so the seventh word (48 pt) joins from
// 451.49 pt.
const WORDS = 'aa aa aa aa aa aa aa aa';
const SEVEN = 'aa aa aa aa aa aa aa ';
const SIX = 'aa aa aa aa aa aa ';
const load = (text: string, available: number, options: FixtureOptions = {}) =>
  loadFixture({
    text,
    available,
    language: 'zh-CN',
    compatibility: 14,
    compression: 'compressPunctuation',
    paragraphProperties: '<w:jc w:val="left"/>',
    ...options,
  });
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
const caretX = (result: ReturnType<typeof loadFixture>, offset: number) => {
  const line = result.lines[0]!;
  return (
    caretAt(result.layout, { paragraphId: line.range.paragraphId, offset }, measurer)!.x -
    line.box.x
  );
};

describe('a legacy mode that compresses punctuation shrinks spaces by up to 19.8 percent', () => {
  for (const jc of ['left', 'both', 'distribute']) {
    test(`a ${jc} line keeps the word and fills the measure`, () => {
      const result = load(WORDS, 452, { paragraphProperties: `<w:jc w:val="${jc}"/>` });
      expect(texts(result)[0]).toBe(SEVEN);
      // The seventh word ends at the margin: each space gave up 4 pt.
      expect(caretX(result, 20)).toBeCloseTo(452, 6);
    });
  }

  test('kana compression shrinks the spaces too', () => {
    const result = load(WORDS, 452, { compression: 'compressPunctuationAndJapaneseKana' });
    expect(texts(result)[0]).toBe(SEVEN);
  });

  test('the word wraps when the spaces would give up more than 19.8 percent', () => {
    expect(texts(load(WORDS, 450))[0]).toBe(SIX);
  });

  test('without punctuation compression the spaces keep their advance', () => {
    expect(texts(load(WORDS, 452, { compression: 'doNotCompress' }))[0]).toBe(SIX);
  });

  test('without an East Asian face in the document defaults the spaces keep their advance', () => {
    expect(texts(load(WORDS, 452, { defaultFace: null }))[0]).toBe(SIX);
  });

  test('a modern mode keeps natural spaces on a left-aligned line', () => {
    expect(texts(load(WORDS, 452, { compatibility: 15 }))[0]).toBe(SIX);
  });
});

describe('a final half-width mark beside spaces that shrink by up to 19.8 percent', () => {
  const COMMA = 'aa aa aa aa aa aa aa, aa';

  test('the mark stays inside when the spaces make room for it', () => {
    // `aa,` needs 28 pt of the 28.51 pt the spaces lend.
    const result = load(COMMA, 476);
    expect(texts(result)).toEqual(['aa aa aa aa aa aa aa, ', 'aa']);
    expect(caretX(result, 21)).toBeCloseTo(476, 6);
  });

  test('the mark hangs when only the text before it fits', () => {
    const result = load(COMMA, 460);
    expect(texts(result)).toEqual(['aa aa aa aa aa aa aa, ', 'aa']);
    expect(caretX(result, 20)).toBeCloseTo(460, 6);
    expect(caretX(result, 21)).toBeCloseTo(484, 6);
  });

  test('the word wraps when even the text before the mark needs more than the limit', () => {
    expect(texts(load(COMMA, 450))[0]).toBe(SIX);
  });
});
