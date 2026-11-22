// `w:compat/w:useAltKinsokuLineBreakRules` in a legacy compatibility mode: a line-end mark
// outside its run language's (`w:lang` `w:eastAsia`) hanging set never hangs. When
// `w:characterSpacingControl` compresses punctuation it may give up its blank right half, so
// only the overflow passes the margin and the text keeps its natural width. A larger overflow
// wraps the mark with the ideograph before it.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer, type FixtureOptions } from './punctuation-kerning-fixture.ts';
import { caretAt } from '../semantic-interaction.ts';

// 19 ideographs of 24 pt take 456 pt. A 24 pt mark then overflows a 480 - n pt measure by n.
const H = '国'.repeat(19);
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
const caretX = (result: ReturnType<typeof loadFixture>, offset: number) => {
  const line = result.lines[0]!;
  return (
    caretAt(result.layout, { paragraphId: line.range.paragraphId, offset }, measurer)!.x -
    line.box.x
  );
};
const layout = (mark: string, overflow: number, options: FixtureOptions = {}) =>
  loadFixture({
    text: H + mark + '余',
    available: 480 - overflow,
    language: 'zh-CN',
    compatibility: 14,
    alternateKinsoku: true,
    compression: 'compressPunctuation',
    paragraphProperties: '<w:jc w:val="both"/>',
    ...options,
  });
const wraps = (mark: string) => [H.slice(1), '国' + mark + '余'];

describe('alternate line-break rules in legacy modes', () => {
  for (const compatibility of [11, 12, 14] as const) {
    for (const mark of [...'，。；、：！）」》』']) {
      test(`mode ${compatibility}: ${mark} passes the margin only by the overflow`, () => {
        for (const overflow of [6, 12]) {
          const result = layout(mark, overflow, { compatibility });
          expect(texts(result)).toEqual([H + mark, '余']);
          // The ideographs keep their natural advances.
          expect(caretX(result, 19)).toBeCloseTo(456, 6);
        }
        expect(texts(layout(mark, 13, { compatibility }))).toEqual(wraps(mark));
      });
    }
  }

  test('mode 15 ignores the option and hangs the blank half', () => {
    expect(caretX(layout('，', 6, { compatibility: 15 }), 19)).toBeCloseTo(462, 6);
    expect(texts(layout('，', 13, { compatibility: 15 }))).toEqual([H + '，', '余']);
  });

  test('without the option a legacy mark hangs its blank half', () => {
    expect(caretX(layout('，', 6, { alternateKinsoku: false }), 19)).toBeCloseTo(462, 6);
  });

  test('a mark without a blank right half wraps at any overflow', () => {
    expect(texts(layout('？', 1))).toEqual(wraps('？'));
    // Traditional Chinese centers these marks.
    for (const mark of [...'，。；、：'])
      expect(texts(layout(mark, 1, { language: 'zh-TW' }))).toEqual(wraps(mark));
    expect(caretX(layout('）', 6, { language: 'zh-TW' }), 19)).toBeCloseTo(456, 6);
  });

  test('Japanese half-width marks keep their usual hanging', () => {
    for (const mark of [...'｡､']) {
      const options = { language: 'ja-JP' };
      expect(texts(layout(mark, 6, options))).toEqual(
        texts(layout(mark, 6, { ...options, alternateKinsoku: false }))
      );
    }
  });

  test('Japanese keeps its hanging set and limits brackets', () => {
    // `、。，` keep the blank-side rule: the trailing blank hangs and the text spreads.
    expect(caretX(layout('，', 6, { language: 'ja-JP' }), 19)).toBeCloseTo(462, 6);
    expect(texts(layout('，', 13, { language: 'ja-JP' }))).toEqual([H + '，', '余']);
    expect(caretX(layout('）', 6, { language: 'ja-JP' }), 19)).toBeCloseTo(456, 6);
    expect(texts(layout('）', 13, { language: 'ja-JP' }))).toEqual(wraps('）'));
  });

  test('half-width Latin marks keep their usual hanging, and curly quotes wrap', () => {
    for (const mark of [...'.,)!']) {
      expect(texts(layout(mark, 13))).toEqual([H + mark, '余']);
      expect(texts(layout(mark, 13))).toEqual(texts(layout(mark, 13, { alternateKinsoku: false })));
    }
    expect(texts(layout('”', 13, { text: H + '”余', available: 456 + 6 }))).toEqual([
      H.slice(1),
      '国”余',
    ]);
  });

  test('no punctuation compression or Korean text wraps the mark', () => {
    expect(texts(layout('，', 1, { compression: 'doNotCompress' }))).toEqual(wraps('，'));
    // Korean text may break before the mark, so the mark wraps alone.
    expect(texts(layout('，', 1, { language: 'ko-KR' }))).toEqual([H, '，余']);
  });

  test('kana compression follows the same rule', () => {
    const options = { compression: 'compressPunctuationAndJapaneseKana' };
    expect(caretX(layout('，', 6, options), 19)).toBeCloseTo(456, 6);
    expect(texts(layout('，', 13, options))).toEqual(wraps('，'));
  });
});

describe('an interior semicolon gives up its blank half', () => {
  const inkMeasurer = {
    ...measurer,
    inkBounds: (text: string) =>
      /[，；》]/u.test(text) ? { left: 2, right: 8 } : { left: 1, right: 23 },
  };
  for (const alternateKinsoku of [true, false])
    test(`alternate rules ${alternateKinsoku ? 'on' : 'off'}: an ideograph fits after ；`, () => {
      // 18 ideographs and one interior semicolon take 456 pt; one more ideograph overflows.
      const prefix = H.slice(0, 8) + '；' + H.slice(9);
      const result = loadFixture({
        text: prefix + '国余',
        available: 474,
        language: 'zh-CN',
        compatibility: 15,
        alternateKinsoku,
        compression: 'compressPunctuation',
        paragraphProperties: '<w:jc w:val="both"/>',
        measurer: inkMeasurer,
      });
      expect(texts(result)).toEqual([prefix + '国', '余']);
    });

  test('a final semicolon keeps its blank half', () => {
    for (const alternateKinsoku of [true, false]) {
      const options = { language: 'ja-JP', measurer: inkMeasurer, alternateKinsoku };
      expect(texts(layout('；', 1, options))).toEqual(wraps('；'));
    }
  });

  test('a final mark outside the hanging set may still give up its blank half', () => {
    // Japanese never hangs `》`, but its blank right half compresses to fit the line.
    const options = { language: 'ja-JP', measurer: inkMeasurer };
    expect(texts(layout('》', 6, options))).toEqual([H + '》', '余']);
  });

  test('optical fitting does not compress a final mark that the rules wrap', () => {
    const options = { measurer: inkMeasurer };
    expect(texts(layout('，', 1, { ...options, language: 'zh-TW' }))).toEqual(wraps('，'));
    expect(texts(layout('，', 1, { ...options, language: 'ko-KR' }))).toEqual([H, '，余']);
    expect(texts(layout('，', 1, { ...options, compression: 'doNotCompress' }))).toEqual(
      wraps('，')
    );
  });

  test('without hanging punctuation the final mark keeps its usual optical fit', () => {
    const options = {
      language: 'zh-TW',
      measurer: inkMeasurer,
      paragraphProperties: '<w:overflowPunct w:val="0"/><w:jc w:val="both"/>',
    };
    const withRules = texts(layout('，', 1, options));
    expect(withRules).toEqual([H + '，', '余']);
    expect(withRules).toEqual(texts(layout('，', 1, { ...options, alternateKinsoku: false })));
  });

  test('an interior semicolon lets an alternate final mark fit a larger overflow', () => {
    const prefix = H.slice(0, 8) + '；' + H.slice(9);
    const result = layout('，', 16, { measurer: inkMeasurer, text: prefix + '，余' });
    expect(texts(result)).toEqual([prefix + '，', '余']);
  });
});
