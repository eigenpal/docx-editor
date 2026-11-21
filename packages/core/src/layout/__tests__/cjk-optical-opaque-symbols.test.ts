import { expect, test } from 'bun:test';
import { createCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY, type CjkParagraphTypography } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import { loadFixture } from './punctuation-kerning-fixture.ts';
import type { PendingLine } from '../pending-line.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

// Synthetic metrics: ASCII letters and digits 7 pt, everything else 12 pt.
const advance = (text: string) =>
  [...text].reduce((sum, char) => sum + (/[A-Za-z0-9]/u.test(char) ? 7 : 12), 0);
const outlines: string[] = [];
const measurer: TextMeasurer = {
  measure: (text, style) => advance(text) + text.length * style.characterSpacingPt,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds(text) {
    if ([...text].length !== 1) return undefined;
    if (text === '（') return { left: 8, right: 10 };
    if (text === '）') return { left: 2, right: 4 };
    if (text === '、') return { left: 1, right: 4 };
    return { left: 0.6, right: 11.4 };
  },
  textOutline(text) {
    outlines.push(text);
    return { path: null, ink: { left: 0.4, right: advance(text) - 0.3, top: -10, bottom: 2 } };
  },
};
const policy: CjkParagraphTypography = {
  ...DEFAULT_CJK_TYPOGRAPHY,
  overflowPunctuation: false,
  settings: {
    strict: false,
    compression: 'compressPunctuation',
    punctuationKerning: true,
    sourceEastAsianFont: true,
    before: {},
    after: {},
  },
};
const style = {
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'Test Latin',
  fontFamilyEastAsia: 'Test CJK',
  fontSizePt: 12,
};

/**
 * One fitter call on a line of `texts` (eastAsia slot unless `latin` names the text), with
 * `candidate` as the next group and `room` points left on the line.
 */
function attempt(
  texts: readonly string[],
  candidate: string,
  room: number,
  latin = '',
  requireLocalQualification = true
) {
  let start = 0;
  let x = 0;
  const pieces: FieldAwarePiece[] = [...texts, candidate].map((text) => {
    const piece: FieldAwarePiece = {
      text,
      start,
      end: start + text.length,
      props: [],
      style,
      ...(text === latin ? {} : { fontSlot: 'eastAsia' as const }),
    };
    start = piece.end;
    return piece;
  });
  const spans: StyleSpanRecord[] = pieces.slice(0, -1).map((piece) => {
    const width = advance(piece.text);
    const span = {
      text: piece.text,
      props: [],
      style,
      ...(piece.fontSlot ? { fontSlot: piece.fontSlot } : {}),
      range: { paragraphId: 'p', start: piece.start, end: piece.end },
      box: { x, y: 0, width, height: 16 },
    };
    x += width;
    return span;
  });
  const line: PendingLine = {
    spans,
    drawings: [],
    start: 0,
    end: pieces.at(-2)!.end,
    width: x,
    height: 16,
    baseline: 12,
    leading: 0,
    trailingSpacing: 0,
  };
  const last = pieces.at(-1)!;
  outlines.length = 0;
  const result = createCjkOpticalFitter(pieces, cjkParagraphBreaks(pieces, policy), measurer, {
    hangingPunctuation: false,
    requireLocalQualification,
  })(
    line,
    pieces.length - 1,
    last.text,
    { paragraphId: 'p', start: last.start, end: last.end },
    advance(last.text),
    x,
    x + room,
    true
  );
  const width = (text: string) => line.spans.find((span) => span.text === text)?.box.width;
  return { result, line, width, natural: x };
}

test.each(['℃', '‰', '№', '°', '①', '※', '★', '￥'])(
  'an East Asian face symbol %s keeps its advance and no longer refuses the line',
  (symbol) => {
    const { result, line, width, natural } = attempt(['甲', symbol + '、', '乙'], '丙', 9);
    expect(result).toBeDefined();
    expect(width(symbol)).toBe(12);
    expect(line.spans.find((span) => span.text === symbol)?.range).toEqual({
      paragraphId: 'p',
      start: 1,
      end: 2,
    });
    expect(width('、')).toBe(9);
    expect(line.width + result!.width).toBe(natural + 9);
  }
);

test('an opening mark gives its leading blank side next to an East Asian face symbol', () => {
  const { result, line, width } = attempt(['甲', '℃', '（', '乙'], '丙', 7);
  expect(result).toBeDefined();
  expect(width('℃')).toBe(12);
  expect(width('（')).toBe(7);
  expect(line.spans.find((span) => span.text === '（')?.glyphOffsetPt).toBe(-5);
});

test('a symbol that joins the line end passes the same expansion gate as an ideograph', () => {
  // 11.5 pt of compression for 0.5 pt of room: three closing marks could absorb it, but
  // spreading 0.5 pt is the cheaper choice.
  for (const candidate of ['№', '丁']) {
    const tight = attempt(['甲）', '乙）', '丙）'], candidate, 0.5);
    expect(tight.result).toBeUndefined();
    expect(tight.line.width).toBe(tight.natural);
  }
  const roomy = attempt(['甲）', '乙）', '丙）'], '№', 6);
  expect(roomy.result).toBeDefined();
  expect(roomy.result!.candidate.find((span) => span.text === '№')?.box.width).toBe(12);
});

test('Latin-face text with symbols or accents stays whole and lets other punctuation fit', () => {
  for (const latin of ['Café', '25℃']) {
    const { result, width } = attempt(['甲', latin, '、', '乙'], '丙', 9, latin);
    expect(result).toBeDefined();
    expect(width(latin)).toBe(advance(latin));
    expect(width('、')).toBe(9);
    // No blank side faces the text, so it is never shaped for its ink.
    expect(outlines).not.toContain(latin);
  }
});

test('an opening mark gives its leading blank side next to Latin-face text with symbols', () => {
  for (const latin of ['Café', '25℃']) {
    const { result, width } = attempt(['甲', latin, '（', '乙'], '丙', 7, latin);
    expect(result).toBeDefined();
    expect(width(latin)).toBe(advance(latin));
    expect(width('（')).toBe(7);
    expect(outlines).toContain(latin);
  }
});

test('Latin-face text in other scripts and East Asian marks in a Latin face still refuse', () => {
  for (const latin of ['Мир', 'αβ', '12、']) {
    const { result, line, natural } = attempt(['甲', latin, '）', '乙'], '丙', 9, latin);
    expect(result).toBeUndefined();
    expect(line.width).toBe(natural);
  }
});

test('a letter of another script in the East Asian face still refuses the line', () => {
  for (const letter of ['Ж', 'α']) {
    const { result, line, natural } = attempt(['甲', letter + '、', '乙'], '丙', 9);
    expect(result).toBeUndefined();
    expect(line.width).toBe(natural);
  }
});

test('a symbol cluster with marks stays one opaque glyph, and a joined sequence refuses', () => {
  for (const symbol of ['★\ufe0f', '1\ufe0f\u20e3']) {
    const { result, line, width } = attempt(['甲', symbol + '、', '乙'], '丙', 9);
    expect(result).toBeDefined();
    expect(line.spans.filter((span) => span.text === symbol)).toHaveLength(1);
    expect(width('、')).toBe(9);
  }
  const joined = attempt(['甲', '★\u200d★、', '乙'], '丙', 9);
  expect(joined.result).toBeUndefined();
});

test('the paragraph path still refuses a symbol outside CJK text and punctuation', () => {
  const { result, line, natural } = attempt(['甲', '℃、', '乙'], '丙', 9, '', false);
  expect(result).toBeUndefined();
  expect(line.width).toBe(natural);
});

// 24 pt text where every character is one em: 39 characters fill a 936 pt measure.
const EM = 24;
const emMeasurer: TextMeasurer = {
  measure: (text, style) => [...text].length * (style.fontSizePt + style.characterSpacingPt),
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.2, baseline: style.fontSizePt }),
  inkBounds: (text, style) => {
    const em = style.fontSizePt;
    return /^[，。]$/u.test(text)
      ? { left: em * 0.1, right: em * 0.4 }
      : { left: 1, right: em - 1 };
  },
  hasResolvedFont: () => true,
};
function firstLine(text: string, language: string, compression: string) {
  const first = loadFixture({
    text,
    available: 39 * EM,
    language,
    compression,
    measurer: emMeasurer,
    paragraphProperties: '<w:jc w:val="both"/>',
  } as Parameters<typeof loadFixture>[0]).lines[0]!;
  return {
    text: first.spans.map((span) => span.text).join(''),
    width: (character: string) => first.spans.find((span) => span.text === character)?.box.width,
    end: Math.max(...first.spans.map((span) => span.box.x + span.box.width)) - first.box.x,
  };
}

test('kana compress to pull a line-start-prohibited symbol onto a full line at its advance', () => {
  const line = firstLine(
    'あ'.repeat(39) + '℃あいう',
    'ja-JP',
    'compressPunctuationAndJapaneseKana'
  );
  expect(line.text).toBe('あ'.repeat(39) + '℃');
  expect(line.width('℃')).toBe(EM);
  expect(line.end).toBeCloseTo(39 * EM, 6);
});

test('a hanging symbol keeps its whole advance past the margin', () => {
  const text = '漢'.repeat(19) + '，' + '漢'.repeat(19) + '‰漢漢';
  const line = firstLine(text, 'zh-CN', 'compressPunctuation');
  expect(line.text).toBe(text.slice(0, 40));
  expect(line.width('‰')).toBe(EM);
  expect(line.end).toBeCloseTo(40 * EM, 6);
});
