// Which paragraphs hang line-end punctuation past the margin. Modern compatibility modes hang
// in justified and distributed paragraphs; legacy modes hang at every alignment. Document
// defaults that name no East Asian face leave only distributed paragraphs hanging.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer } from './punctuation-kerning-fixture.ts';
import { caretAt } from '../semantic-interaction.ts';

// 19 ideographs of 24 pt fill 456 pt of the 468 pt measure, so a 24 pt mark overflows.
const H = '国'.repeat(19);
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));

/** The caret x of `offset` on the first line, from the line's left edge. */
const caretX = (result: ReturnType<typeof loadFixture>, offset: number) => {
  const line = result.lines[0]!;
  return (
    caretAt(result.layout, { paragraphId: line.range.paragraphId, offset }, measurer)!.x -
    line.box.x
  );
};

describe('legacy compatibility modes hang at every alignment', () => {
  for (const jc of ['left', 'center', 'right']) {
    for (const mark of [...'。、）']) {
      test(`mode 14 ${jc}: ${mark} hangs and the text before it fills the measure`, () => {
        const result = loadFixture({
          text: H + mark + '国',
          available: 468,
          language: 'ja-JP',
          compatibility: 14,
          paragraphProperties: `<w:jc w:val="${jc}"/>`,
        });
        expect(texts(result)).toEqual([H + mark, '国']);
        expect(caretX(result, 0)).toBeCloseTo(0, 6);
        expect(caretX(result, 19)).toBeCloseTo(468, 6);
      });
    }

    test(`mode 15 ${jc}: 。 wraps with the ideograph before it`, () => {
      const result = loadFixture({
        text: H + '。国',
        available: 468,
        language: 'ja-JP',
        compatibility: 15,
        paragraphProperties: `<w:jc w:val="${jc}"/>`,
      });
      expect(texts(result)).toEqual([H.slice(1), '国。国']);
    });

    test(`mode 14 ${jc}: a mark that never hangs still wraps`, () => {
      const result = loadFixture({
        text: H + '！国',
        available: 468,
        language: 'ja-JP',
        compatibility: 14,
        paragraphProperties: `<w:jc w:val="${jc}"/>`,
      });
      expect(texts(result)).toEqual([H.slice(1), '国！国']);
    });
  }

  test('mode 14: 。 hangs although the paragraph turns kinsoku off', () => {
    const result = loadFixture({
      text: H + '。国',
      available: 468,
      language: 'ja-JP',
      compatibility: 14,
      paragraphProperties: '<w:jc w:val="left"/><w:kinsoku w:val="0"/>',
    });
    expect(texts(result)).toEqual([H + '。', '国']);
  });

  test('mode 14: a custom list without 。 starts the next line with it', () => {
    const result = loadFixture({
      text: H + '。国',
      available: 468,
      language: 'ja-JP',
      compatibility: 14,
      lineStartRule: { language: 'ja-JP', characters: '！' },
      paragraphProperties: '<w:jc w:val="left"/>',
    });
    expect(texts(result)).toEqual([H, '。国']);
  });

  test('mode 14 left: no hang without East Asian document defaults', () => {
    const result = loadFixture({
      text: H + '。国',
      available: 468,
      language: 'ja-JP',
      compatibility: 14,
      defaultFace: null,
      paragraphProperties: '<w:jc w:val="left"/>',
    });
    expect(texts(result)).toEqual([H.slice(1), '国。国']);
  });
});

describe('Korean paragraph-final marks in legacy modes', () => {
  const K = '가'.repeat(19);
  for (const compression of ['compressPunctuation', 'compressPunctuationAndJapaneseKana']) {
    for (const jc of ['left', 'both']) {
      test(`${compression}, ${jc}: a final ! starts the next line by itself`, () => {
        const result = loadFixture({
          text: K + '!',
          available: 468,
          language: 'ko-KR',
          compatibility: 14,
          compression,
          paragraphProperties: `<w:jc w:val="${jc}"/>`,
        });
        expect(texts(result)).toEqual([K, '!']);
      });
    }
  }

  test('without compression a final ! hangs', () => {
    const result = loadFixture({
      text: K + '!',
      available: 468,
      language: 'ko-KR',
      compatibility: 14,
      paragraphProperties: '<w:jc w:val="left"/>',
    });
    expect(texts(result)).toEqual([K + '!']);
  });
});

describe('distributed paragraphs hang without East Asian document defaults', () => {
  for (const compatibility of [11, 12, 14, 15] as const) {
    for (const mark of [...'。、）']) {
      test(`mode ${compatibility}: a distributed paragraph hangs ${mark}`, () => {
        const result = loadFixture({
          text: H + mark + '国',
          available: 468,
          language: 'ja-JP',
          compatibility,
          defaultFace: null,
          paragraphProperties: '<w:jc w:val="distribute"/>',
        });
        expect(texts(result)).toEqual([H + mark, '国']);
        expect(caretX(result, 19)).toBeCloseTo(468, 6);
      });
    }

    test(`mode ${compatibility}: the spacing voiced mark wraps with its ideograph`, () => {
      const result = loadFixture({
        text: H + '゛国',
        available: 468,
        language: 'ja-JP',
        compatibility,
        defaultFace: null,
        paragraphProperties: '<w:jc w:val="distribute"/>',
      });
      expect(texts(result)[0]).toBe(H.slice(1));
    });

    test(`mode ${compatibility}: a justified paragraph does not hang`, () => {
      const result = loadFixture({
        text: H + '。国',
        available: 468,
        language: 'ja-JP',
        compatibility,
        defaultFace: null,
        paragraphProperties: '<w:jc w:val="both"/>',
      });
      expect(texts(result)).toEqual([H.slice(1), '国。国']);
    });
  }
});

describe('a hanging mark with punctuation compression hangs its blank side first', () => {
  // 19 ideographs and a 24 pt mark take 480 pt. A measure of 480 - overflow pt leaves the mark
  // over the margin by that overflow. The mark's x shows how much of it hangs.
  const markX = (
    mark: string,
    overflow: number,
    options: Parameters<typeof loadFixture>[0] = {}
  ) => {
    const result = loadFixture({
      text: H + mark + '余',
      available: 480 - overflow,
      language: 'zh-CN',
      compatibility: 14,
      compression: 'compressPunctuation',
      paragraphProperties: '<w:jc w:val="both"/>',
      ...options,
    });
    expect(texts(result)).toEqual([H + mark, '余']);
    return caretX(result, 19);
  };

  for (const compatibility of [11, 12, 14, 15] as const) {
    for (const mark of [...'，。；：！、）」》』']) {
      test(`mode ${compatibility}: ${mark} within its blank half hangs only that half`, () => {
        // The ink half ends at the margin; the ideographs before it spread to meet it.
        expect(markX(mark, 6, { compatibility })).toBeCloseTo(474 - 12, 6);
        expect(markX(mark, 12, { compatibility })).toBeCloseTo(468 - 12, 6);
      });
    }
  }

  test('an overflow past the blank half hangs the whole mark', () => {
    expect(markX('，', 18)).toBeCloseTo(462, 6);
  });

  test('a mark without a blank side hangs whole', () => {
    expect(markX('？', 6)).toBeCloseTo(474, 6);
    expect(markX('！', 6, { language: 'zh-TW' })).toBeCloseTo(474, 6);
    expect(markX('”', 6)).toBeCloseTo(474, 6);
  });

  test('a distributed line and a Japanese run hang the blank half', () => {
    const paragraphProperties = '<w:jc w:val="distribute"/>';
    expect(markX('，', 6, { paragraphProperties })).toBeCloseTo(474 - 12, 6);
    expect(markX('、', 6, { language: 'ja-JP' })).toBeCloseTo(474 - 12, 6);
  });

  test('character spacing changes the trailing blank', () => {
    // -4 pt spacing: 20 pt cells; the mark's trailing blank is 12 - 4 = 8 pt.
    const tracked = (overflow: number) => {
      const result = loadFixture({
        text: H + '，余',
        available: 400 - overflow,
        language: 'zh-CN',
        compatibility: 14,
        compression: 'compressPunctuation',
        tracking: -80,
        paragraphProperties: '<w:jc w:val="both"/>',
      });
      expect(texts(result)).toEqual([H + '，', '余']);
      return caretX(result, 19);
    };
    expect(tracked(6)).toBeCloseTo(394 - 12, 6);
    expect(tracked(9)).toBeCloseTo(391, 6);
  });

  test('a Korean paragraph-final mark hangs whole', () => {
    const result = loadFixture({
      text: '가'.repeat(19) + '，',
      available: 474,
      language: 'ko-KR',
      compatibility: 15,
      compression: 'compressPunctuation',
      paragraphProperties: '<w:jc w:val="both"/>',
    });
    expect(texts(result)).toEqual(['가'.repeat(19) + '，']);
    expect(caretX(result, 19)).toBeCloseTo(474, 6);
  });

  test('without compression the whole mark hangs', () => {
    expect(markX('，', 6, { compression: 'doNotCompress' })).toBeCloseTo(474, 6);
  });

  test('kana compression hangs the blank half too (kana-line-fit.test.ts covers the fit skip)', () => {
    const compression = 'compressPunctuationAndJapaneseKana';
    expect(markX('，', 6, { compression })).toBeCloseTo(474 - 12, 6);
  });

  test('a legacy left-aligned line hangs the blank half', () => {
    const paragraphProperties = '<w:jc w:val="left"/>';
    expect(markX('。', 6, { paragraphProperties })).toBeCloseTo(474 - 12, 6);
  });

  for (const language of ['zh-TW', 'zh-HK']) {
    test(`${language}: a centered mark hangs its trailing quarter`, () => {
      expect(markX('，', 4, { language })).toBeCloseTo(476 - 18, 6);
      // Past the trailing quarter the text keeps its advances and the overflow hangs.
      expect(markX('，', 9, { language })).toBeCloseTo(456, 6);
      expect(markX('，', 13, { language })).toBeCloseTo(467, 6);
      expect(markX('）', 6, { language })).toBeCloseTo(474 - 12, 6);
    });
  }

  test("the mark's own run language decides its blank sides", () => {
    const options = { split: 19, language: 'zh-CN', secondLanguage: 'zh-TW' };
    expect(markX('，', 4, options)).toBeCloseTo(476 - 18, 6);
  });
});
