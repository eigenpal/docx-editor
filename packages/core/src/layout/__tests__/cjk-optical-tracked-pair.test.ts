import { expect, test } from 'bun:test';
import { createCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { compressCjkPieces } from '../cjk-spacing.ts';
import { DEFAULT_CJK_TYPOGRAPHY, type CjkParagraphTypography } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import { layoutDerivedSpacingStyleForEditing } from '../layout-derived-spacing.ts';
import type { PendingLine } from '../pending-line.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

const policy: CjkParagraphTypography = {
  ...DEFAULT_CJK_TYPOGRAPHY,
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
  fontSizePt: 12,
  fontFamily: 'Test Latin',
  fontFamilyEastAsia: 'Test CJK',
  characterSpacingPt: -0.3,
  kerningEnabled: true,
  kerningMinPt: 1,
};

const advance = (text: string) =>
  [...text].reduce((width, char) => width + (/^[\x20-\x7e]$/u.test(char) ? 6 : 12), 0);
const measurer: TextMeasurer = {
  measure: (text, face) => advance(text) + text.length * face.characterSpacingPt,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds(text) {
    if (text === '《' || text === '（') return { left: 8, right: 10 };
    if (text === '》' || text === '）' || text === '，') return { left: 1, right: 4 };
    return { left: 1, right: 11 };
  },
  textOutline: (text) => ({
    path: null,
    ink: { left: 0.5, right: advance(text) - 1, top: -10, bottom: 2 },
  }),
};

function attempt(pair: boolean, word: string) {
  const prefix = pair
    ? ['甲', '，', '丁', '《', '乙', '》', '（', 'AB', '）']
    : ['甲', '，', '丁', '《', '乙', '》', '丙', '（', 'AB', '）'];
  let index = 0;
  const source: FieldAwarePiece[] = [...prefix, word].map((text) => {
    const start = index;
    index += text.length;
    return {
      start,
      end: index,
      text,
      style,
      props: [],
      fontSlot: /^[\x20-\x7e]+$/u.test(text) ? 'ascii' : 'eastAsia',
    };
  });
  const pieces = compressCjkPieces(source, policy, measurer);
  let x = 0;
  const spans: StyleSpanRecord[] = pieces.slice(0, -1).map((piece) => {
    const width = measurer.measure(piece.text, piece.style);
    const span = {
      text: piece.text,
      style: piece.style,
      props: piece.props,
      fontSlot: piece.fontSlot,
      range: { paragraphId: 'p', start: piece.start, end: piece.end },
      box: { x, y: 0, width, height: 16 },
    };
    x += width;
    return span;
  });
  const next = pieces.at(-1)!;
  const line: PendingLine = {
    spans,
    drawings: [],
    start: 0,
    end: next.start,
    width: x,
    height: 16,
    baseline: 12,
    leading: 0,
    trailingSpacing: 0,
  };
  const width = measurer.measure(word, style);
  const available = x + width - 1;
  const fit = createCjkOpticalFitter(pieces, cjkParagraphBreaks(pieces, policy), measurer, {
    hangingPunctuation: false,
    requireLocalQualification: true,
  })(
    line,
    pieces.length - 1,
    word,
    { paragraphId: 'p', start: next.start, end: next.end },
    width,
    x,
    available,
    true
  );
  return { fit, line, width, available };
}

test('a tracked line can fit an ASCII word beside an already compressed punctuation pair', () => {
  const { fit, line, width, available } = attempt(true, 'Q12');
  expect(fit).toBeDefined();
  expect(fit?.width).toBe(width);
  expect(line.width + width).toBeCloseTo(available, 8);
  expect(
    line.spans.map((span) => layoutDerivedSpacingStyleForEditing(span.style).characterSpacingPt)
  ).toEqual(line.spans.map(() => -0.3));
});

test('tracked lines require both a compressed punctuation pair and an ASCII candidate', () => {
  expect(attempt(false, 'Q12').fit).toBeUndefined();
  expect(attempt(true, '丙').fit).toBeUndefined();
});
