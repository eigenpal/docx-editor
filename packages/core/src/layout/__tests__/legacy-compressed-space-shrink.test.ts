// In a legacy compatibility mode that compresses punctuation, in a document whose defaults name
// an East Asian face, a line at any alignment shrinks its inter-word spaces down to half the
// average character width of their face to keep one more word, with no other test. A face with
// no known average width gives up a fifth of each space. A final half-width mark stays inside
// when the spaces make room for it, and hangs beside spaces at that limit.
// `w:balanceSingleByteDoubleByteWidth` keeps natural spaces.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer, type FixtureOptions } from './punctuation-kerning-fixture.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { caretAt } from '../semantic-interaction.ts';

// Every character, a space too, is 24 pt, in a face with no known average width. Six words and
// their spaces take 432 pt; at a fifth of 24 pt, the six spaces lend 28.8 pt, so the seventh
// word (48 pt) joins from 451.2 pt.
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

describe('a legacy mode that compresses punctuation shrinks spaces', () => {
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

  test('the word wraps when the spaces would give up more than their limit', () => {
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

  test('balancing single-byte and double-byte widths keeps natural spaces', () => {
    expect(texts(load(WORDS, 452, { balanceWidths: true }))[0]).toBe(SIX);
    expect(
      texts(
        load(WORDS, 452, { balanceWidths: true, paragraphProperties: '<w:jc w:val="both"/>' })
      )[0]
    ).toBe(SIX);
  });
});

describe('a final half-width mark beside shrinking spaces', () => {
  const COMMA = 'aa aa aa aa aa aa aa, aa';

  test('the mark stays inside when the spaces make room for it', () => {
    // `aa,` needs 28 pt of the 28.8 pt the spaces lend.
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

// Letters are one em wide; a space takes its face's real share of the em. The floor is half the
// face's recorded average character width: Times New Roman 821, Century 951, Calibri 1067, and
// Courier New 1229 of a 2048-unit em.
const SPACE_EM: Record<string, number> = {
  'Times New Roman': 0.25,
  Century: 0.278,
  Calibri: 0.2263,
  'Courier New': 0.6,
};
const faceMeasurer: TextMeasurer = {
  measure: (text, style) =>
    [...text].reduce(
      (sum, c) =>
        sum +
        (c === ' '
          ? style.fontSizePt * (SPACE_EM[style.fontFamily ?? ''] ?? 0.25) +
            (style.shaping?.wordSpacingPt ?? 0)
          : style.fontSizePt),
      0
    ),
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.2, baseline: style.fontSizePt }),
};
const inFace = (face: string, available: number) =>
  loadFixture({
    text: WORDS,
    available,
    language: 'zh-CN',
    compatibility: 14,
    compression: 'compressPunctuation',
    paragraphProperties: '<w:jc w:val="left"/>',
    face,
    measurer: faceMeasurer,
  });
const lineEnd = (result: ReturnType<typeof loadFixture>) => {
  const line = result.lines[0]!;
  const last = line.spans.at(-1)!;
  return last.box.x + last.box.width - line.box.x;
};

describe('a space shrinks down to half its face average character width', () => {
  // Six words and their spaces, then a seventh word of 48 pt.
  const natural = (face: string) => 7 * 48 + 6 * 24 * SPACE_EM[face]!;
  const floor = (average: number) => (24 * average) / 2048 / 2;

  test('Times New Roman: about a fifth of each space', () => {
    // 6 pt spaces, 4.81 pt floor: the six spaces lend 7.14 pt.
    const lend = 6 * (6 - floor(821));
    expect(texts(inFace('Times New Roman', natural('Times New Roman') - lend + 0.5))[0]).toBe(
      SEVEN
    );
    expect(texts(inFace('Times New Roman', natural('Times New Roman') - lend - 0.5))[0]).toBe(SIX);
  });

  test('Century: less than a fifth', () => {
    // 6.67 pt spaces, 5.57 pt floor: each space lends 1.10 pt, about 16 percent.
    const lend = 6 * (24 * 0.278 - floor(951));
    expect(lend / (6 * 24 * 0.278)).toBeLessThan(0.17);
    expect(texts(inFace('Century', natural('Century') - lend + 0.5))[0]).toBe(SEVEN);
    expect(texts(inFace('Century', natural('Century') - lend - 0.5))[0]).toBe(SIX);
  });

  test('Calibri: the floor is wider than the space, so spaces keep their advance', () => {
    expect(floor(1067)).toBeGreaterThan(24 * 0.2263);
    expect(texts(inFace('Calibri', natural('Calibri') - 0.5))[0]).toBe(SIX);
  });

  test('Courier New: half of each space, and the line still fills the measure', () => {
    // 14.4 pt spaces, 7.2 pt floor: a word that needs 40 percent of the spaces joins.
    const available = natural('Courier New') - 0.4 * 6 * 14.4;
    const result = inFace('Courier New', available);
    expect(texts(result)[0]).toBe(SEVEN);
    expect(lineEnd(result)).toBeCloseTo(available, 4);
    expect(texts(inFace('Courier New', natural('Courier New') - 6 * 7.2 - 0.5))[0]).toBe(SIX);
  });
});
