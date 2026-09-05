import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { alignSpans, breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { cjkTypographyFromSettings, resolveCjkTypography } from '../cjk-typography.ts';
import { buildStyleCascadeTable, resolveParagraphLayoutInputs } from '../style-cascade.ts';
import { anchorLineStartsByModelOffset } from '../anchor-line-probe.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { FieldAwarePiece } from '../field-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function root(xml: string): OoxmlElement {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}
function paragraph(parts: readonly string[], pPr = '', rPr = ''): OoxmlElement {
  return root(
    `<w:p xmlns:w="${W}"><w:pPr><w:overflowPunct w:val="0"/>${pPr}</w:pPr>${parts.map((text) => `<w:r><w:rPr><w:sz w:val="22"/>${rPr}</w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`).join('')}</w:p>`
  );
}
function layout(parts: readonly string[], width: number, pPr = '', rPr = '', settings = '') {
  const p = paragraph(parts, pPr, rPr);
  const settingsRoot = root(`<w:settings xmlns:w="${W}">${settings}</w:settings>`);
  const props = resolveParagraphLayoutInputs(p, width, undefined).props;
  return breakParagraph(
    p,
    'p',
    0,
    width,
    measurer,
    undefined,
    null,
    [],
    undefined,
    undefined,
    undefined,
    { typography: resolveCjkTypography(props, cjkTypographyFromSettings(settingsRoot)) }
  );
}
const textLines = (...args: Parameters<typeof layout>) =>
  layout(...args).map((line) => line.spans.map((span) => span.text).join(''));

describe('CJK follow-up: protected groups across every run seam', () => {
  test.each([
    [['月。', '。盈'], 7, ['月。。', '盈']],
    [['月、', '」盈'], 7, ['月、」', '盈']],
    [['（以', '）来'], 7, ['（以）', '来']],
    [['「方」', '）盈'], 13, ['「方」）', '盈']],
  ] as const)('%j at %dpt', (parts, width, expected) => {
    expect(textLines(parts, width)).toEqual([...expected]);
  });

  test('formatting seams cannot change line breaks or lose source offsets', () => {
    for (const text of [
      '甲方（以下简称「买方」）应当按照本合同第３条、第４条之约定，支付０．５％。',
      '甲か\u3099\u309a月𠀋乙',
      '甲👩‍👩‍👧‍👦乙',
      '甲ＡＢＣ乙１２，３４５．６７％丙',
    ]) {
      for (const width of [7, 13, 25, 36, 60]) {
        const expected = textLines([text], width);
        for (let split = 1; split < text.length; split++) {
          // XML cannot represent an isolated surrogate; split at code-point boundaries.
          if (/[\udc00-\udfff]/u.test(text[split]!)) continue;
          const lines = layout([text.slice(0, split), text.slice(split)], width);
          expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
            expected
          );
          expect(
            lines
              .flatMap((line) => line.spans)
              .map((span) => span.text)
              .join('')
          ).toBe(text);
          let end = 0;
          for (const line of lines)
            for (const span of line.spans) {
              expect(span.range.start).toBe(end);
              expect(span.range.end - span.range.start).toBe(span.text.length);
              end = span.range.end;
            }
          expect(end).toBe(text.length);
        }
      }
    }
  });
});

describe('CJK follow-up: mixed text and figure groups', () => {
  test('full-width decimal and alphabetic groups move together', () => {
    expect(textLines(['天地０.５日'], 24)).toEqual(['天地', '０.５日']);
    expect(textLines(['天地０．５日'], 24)).toEqual(['天地', '０．５日']);
    expect(textLines(['天地ＡＢＣ日'], 24)).toEqual(['天地', 'ＡＢＣ日']);
  });
  test('Latin words remain whole while boundaries beside CJK become available', () => {
    expect(textLines(['甲ABCD乙'], 25)).toEqual(['甲', 'ABCD', '乙']);
    expect(textLines(['aa bb ℃cccc'], 60)).toEqual(['aa bb ', '℃cccc']);
  });
  test('ASCII punctuation beside CJK stays with its carrier', () => {
    expect(textLines(['天地,月'], 13)).toEqual(['天', '地,', '月']);
    expect(textLines(['天(', '地)月'], 13)).toEqual(['天', '(地)', '月']);
  });
  test('Korean word wrapping is selectable without dividing a syllable', () => {
    expect(textLines(['가나 다라마'], 25)).toEqual(['가나 ', '다라마']);
    expect(textLines(['가나 다라마'], 25, '<w:wordWrap w:val="0"/>')).toEqual(['가나 다', '라마']);
    expect(textLines(['ᄀ', 'ᅡᆨ나'], 7, '<w:wordWrap w:val="0"/>')).toEqual(['각', '나']);
  });
});

describe('CJK follow-up: document and paragraph policy', () => {
  test('kinsoku can be disabled without disabling grapheme safety', () => {
    expect(textLines(['天。地'], 7, '<w:kinsoku w:val="0"/>')).toEqual(['天', '。', '地']);
    expect(textLines(['か', '\u3099月'], 7, '<w:kinsoku w:val="0"/>')).toEqual(['か\u3099', '月']);
  });
  test('Japanese normal and strict kinsoku use different small-kana rules', () => {
    const lang = '<w:lang w:eastAsia="ja-JP"/>';
    expect(textLines(['あゃい'], 7, '', lang)).toEqual(['あ', 'ゃ', 'い']);
    expect(textLines(['あゃい'], 7, '', lang, '<w:strictFirstAndLastChars/>')).toEqual([
      'あゃ',
      'い',
    ]);
  });
  test('custom settings replace the specified direction for the specified language', () => {
    const custom = '<w:noLineBreaksBefore w:lang="ja-JP" w:val="甲"/>';
    expect(textLines(['天地甲人'], 13, '', '<w:lang w:eastAsia="ja-JP"/>', custom)).toEqual([
      '天',
      '地甲',
      '人',
    ]);
    expect(textLines(['天地甲人'], 13, '', '<w:lang w:eastAsia="zh-CN"/>', custom)).toEqual([
      '天地',
      '甲人',
    ]);
    expect(
      textLines(
        ['天地甲人'],
        13,
        '',
        '<w:lang w:eastAsia="ja-JP"/>',
        '<w:noLineBreaksAfter w:lang="ja-JP" w:val="地"/>'
      )
    ).toEqual(['天', '地甲', '人']);
  });
  test('style inheritance and settings participate in the cascade fingerprint', () => {
    const styles = root(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Base" w:default="1"><w:pPr><w:kinsoku w:val="0"/></w:pPr></w:style></w:styles>`
    );
    const before = buildStyleCascadeTable(styles);
    const after = buildStyleCascadeTable(
      styles,
      undefined,
      root(`<w:settings xmlns:w="${W}"><w:strictFirstAndLastChars/></w:settings>`)
    );
    expect(after.cacheToken).not.toBe(before.cacheToken);
    const inherited = resolveParagraphLayoutInputs(paragraph(['天。']), 13, before);
    expect(resolveCjkTypography(inherited.props, before.typography).kinsoku).toBe(false);
    const overridden = resolveParagraphLayoutInputs(
      paragraph(['天。'], '<w:kinsoku/>'),
      13,
      before
    );
    expect(resolveCjkTypography(overridden.props, before.typography).kinsoku).toBe(true);
  });
  test('punctuation overflow follows the paragraph switch and allows only one character', () => {
    expect(textLines(['天地。人'], 12, '<w:overflowPunct/>')).toEqual(['天地。', '人']);
    expect(textLines(['天地。人'], 12, '<w:overflowPunct w:val="0"/>')).toEqual([
      '天',
      '地。',
      '人',
    ]);
    expect(textLines(['天地。。人'], 12, '<w:overflowPunct/>')).toEqual(['天', '地。。', '人']);
  });
  test('compression changes advances, keeps text and model ranges, and respects dont-compress', () => {
    const ordinary = layout(['天。地。'], 18);
    const compressed = layout(
      ['天。地。'],
      18,
      '',
      '',
      '<w:characterSpacingControl w:val="compressPunctuation"/>'
    );
    expect(ordinary.length).toBe(2);
    expect(compressed.length).toBe(1);
    expect(compressed[0]!.width).toBe(18);
    expect(compressed[0]!.spans.map((span) => span.text).join('')).toBe('天。地。');
    expect(compressed[0]!.end).toBe(4);
    expect(
      textLines(['天。地。'], 18, '', '', '<w:characterSpacingControl w:val="doNotCompress"/>')
    ).toEqual(['天。', '地。']);
    expect(
      layout(
        ['アイ'],
        12,
        '',
        '',
        '<w:characterSpacingControl w:val="compressPunctuationAndJapaneseKana"/>'
      )[0]!.width
    ).toBe(10.5);
  });
});

describe('CJK follow-up: geometry', () => {
  test('justification fills a shortened line with measured inter-character gaps', () => {
    const line = layout(['天地玄黄'], 60)[0]!;
    const aligned = alignSpans(line.spans, measurer, 0, 30, 'both', false);
    expect(aligned.map((span) => span.box.x)).toEqual([0, 8, 16, 24]);
    expect(aligned.at(-1)!.box.x + aligned.at(-1)!.box.width).toBe(30);
    expect(aligned.map((span) => span.range.start)).toEqual([0, 1, 2, 3]);
    expect(alignSpans(line.spans, measurer, 0, 30, 'both', true)).toBe(line.spans);
  });
  test('anchor probe uses the same protected seams as placement', () => {
    const pieces: FieldAwarePiece[] = [
      {
        text: '天地月',
        start: 0,
        end: 3,
        props: [],
        style: { ...DEFAULT_RUN_STYLE, fontSizePt: 11 },
      },
      {
        text: '、盈',
        start: 3,
        end: 5,
        props: [],
        style: { ...DEFAULT_RUN_STYLE, fontSizePt: 11 },
      },
    ];
    const typography = resolveCjkTypography([
      { localName: 'overflowPunct', attributes: { val: '0' } },
    ]);
    const starts = anchorLineStartsByModelOffset({
      pieces,
      measurer,
      available: 18,
      firstLineOffset: 0,
      anchorStarts: [0, 2, 3],
      equationLayoutOf: () => null,
      typography,
      cjkBreaks: cjkParagraphBreaks(pieces, typography),
    });
    expect(starts.get(3)).toBe(2);
    expect(starts.get(0)).toBe(0);
    expect(starts.get(2)).toBe(2);
  });
});
