import { expect, test } from 'bun:test';
import { loadBody, squareWrapZone } from './float-over-table-harness.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { narrowRectangularWrapSkip } from '../narrow-wrap-clearance.ts';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import { createLineExclusionClearance } from '../line-exclusion-clearance.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { SINGLE_LINE_SPACING } from '../paragraph-style.ts';
import type { PendingLine } from '../pending-line.ts';

const measurer: TextMeasurer = {
  measure: (text) =>
    [...text].filter((character) => !/[\u200e\u200f\u200b\u0301]/u.test(character)).length * 6,
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};

function tableZone(anchorParagraphId: string, left = 0): ExclusionZone {
  return {
    ...squareWrapZone({
      anchorParagraphId,
      top: 0,
      height: 40,
      left,
      width: 172,
      contentWidth: 180,
    }),
    sourceKind: 'table',
  };
}

function layoutPrefix(
  control: string,
  split: boolean,
  glyphWidth = 6,
  table = true,
  zoneWidth = 172
) {
  const source = loadBody(
    `<w:p><w:r><w:t>${control}${split ? '</w:t></w:r><w:r><w:t>' : ''}ABCD EFGH</w:t></w:r></w:p>`
  );
  const paragraph = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zone: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: paragraph.id,
      top: 0,
      height: 40,
      left: 0,
      width: zoneWidth,
      contentWidth: 180,
    }),
    ...(table ? { sourceKind: 'table' } : {}),
  };
  return linesOf(
    layoutSemanticDocument(source, 0, {
      measurer: {
        ...measurer,
        measure: (text, style) => (measurer.measure(text, style) * glyphWidth) / 6,
      },
      geometry: { width: 200, height: 150, margin: { top: 10, left: 10, right: 10, bottom: 10 } },
      inlineDrawingLayout: {
        ownerPartName: '/word/document.xml',
        project: () => null,
        resourceOf: () => {
          throw new Error('This fixture has no drawing resources');
        },
      },
      drawingExclusionZonesByPage: new Map([[0, [zone]]]),
      drawingExclusionPass: 0,
    })
  );
}

for (const control of ['\u200f', '\u200e', '\u200b', '\u0301']) {
  for (const split of [false, true]) {
    test(`zero-width U+${control.codePointAt(0)!.toString(16)} clears the table with split=${split}`, () => {
      const text = `${control}ABCD EFGH`;
      const lines = layoutPrefix(control, split);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.box.y).toBe(40);
      expect(lines[0]!.spans.map((span) => span.text).join('')).toBe(text);
      let offset = 0;
      for (const span of lines[0]!.spans) {
        expect(span.range.start).toBe(offset);
        expect(span.text).toBe(text.slice(span.range.start, span.range.end));
        offset = span.range.end;
      }
      expect(offset).toBe(text.length);
    });
  }
}

test('visible glyphs after zero-width prefixes clear narrow table and drawing passages', () => {
  for (const table of [false, true]) {
    for (const split of [false, true]) {
      for (const control of ['\u200f', '\u200e', '\u200b', '\u0301', '\u200f\u200f']) {
        const lines = layoutPrefix(control, split, 30, table, 160);
        expect(lines.map((line) => line.box.y)).toEqual([40, 54]);
        const spans = lines.flatMap((line) => line.spans);
        const text = `${control}ABCD EFGH`;
        expect(spans.map((span) => span.text).join('')).toBe(text);
        let offset = 0;
        for (const span of spans) {
          expect(span.box.x).toBe(0);
          expect(span.box.x + span.box.width).toBeLessThanOrEqual(180);
          expect(span.range.start).toBe(offset);
          expect(span.text).toBe(text.slice(span.range.start, span.range.end));
          offset = span.range.end;
        }
        expect(offset).toBe(text.length);
      }
    }
  }
});

test('valid zero widths clear only relevant table passages', () => {
  const table = tableZone('p');
  const drawing = { ...table, sourceKind: undefined };
  expect(narrowRectangularWrapSkip(0, 14, [table], 0, 180, 0)).toBe(40);
  expect(narrowRectangularWrapSkip(0, 14, [table], 0, 180, 6)).toBe(40);
  expect(narrowRectangularWrapSkip(0, 14, [drawing], 0, 180, 0)).toBe(0);
  expect(narrowRectangularWrapSkip(0, 14, [tableZone('p', 190)], 0, 180, 0)).toBe(0);
  expect(narrowRectangularWrapSkip(-20, 14, [table], 0, 180, 0)).toBe(0);
  expect(narrowRectangularWrapSkip(40, 14, [table], 0, 180, 0)).toBe(0);
});

test('invalid glyph widths cannot trigger table clearance', () => {
  for (const width of [-1, NaN, Infinity, -Infinity, 181]) {
    expect(narrowRectangularWrapSkip(0, 14, [tableZone('p')], 0, 180, width)).toBe(0);
  }
});

test('a taller zero-width prefix contributes its complete line band to clearance', () => {
  const source = loadBody(
    '<w:p><w:r><w:rPr><w:sz w:val="100"/></w:rPr><w:t>\u200f</w:t></w:r><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>AB</w:t></w:r></w:p>'
  );
  const paragraph = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zone: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: paragraph.id,
      top: 40,
      height: 40,
      left: 0,
      width: 160,
      contentWidth: 180,
    }),
    sourceKind: 'table',
  };
  const lines = linesOf(
    layoutSemanticDocument(source, 0, {
      measurer: {
        measure: (text, style) => measurer.measure(text, style) * 5,
        lineMetrics: (style) => ({ height: style.fontSizePt, baseline: style.fontSizePt * 0.8 }),
      },
      geometry: { width: 200, height: 200, margin: { top: 10, left: 10, right: 10, bottom: 10 } },
      inlineDrawingLayout: {
        ownerPartName: '/word/document.xml',
        project: () => null,
        resourceOf: () => {
          throw new Error('No drawings');
        },
      },
      drawingExclusionZonesByPage: new Map([[0, [zone]]]),
      drawingExclusionPass: 0,
    })
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]!.box.y).toBe(80);
  expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('\u200fAB');
  expect(lines[0]!.spans.every((span) => span.box.x === 0)).toBe(true);
});

test('checking repeated zero-width runs keeps linear work and an empty-zone fast path', () => {
  const line: PendingLine = {
    spans: [],
    drawings: [],
    start: 0,
    end: 0,
    width: 0,
    height: 14,
    baseline: 11,
    leading: 0,
    trailingSpacing: 0,
  };
  let reads = 0;
  let zones: readonly ExclusionZone[] = [tableZone('p', 190)];
  const clearance = createLineExclusionClearance({
    line: () => line,
    top: () => 0,
    zones: () => zones,
    left: () => 0,
    right: 180,
    emptyStyle: DEFAULT_RUN_STYLE,
    measurer,
    lineSpacing: SINGLE_LINE_SPACING,
  });
  for (let index = 0; index < 1000; index++) {
    line.spans.push({
      text: '\u200f',
      props: [],
      style: DEFAULT_RUN_STYLE,
      range: { paragraphId: 'p', start: index, end: index + 1 },
      box: {
        x: 0,
        y: 0,
        height: 14,
        get width() {
          reads++;
          return 0;
        },
      },
    });
    clearance.applyNarrowWrapSkipIfNeeded('\u200f', DEFAULT_RUN_STYLE);
  }
  expect(reads).toBeGreaterThanOrEqual(1000);
  expect(reads).toBeLessThanOrEqual(3000);
  zones = [];
  reads = 0;
  clearance.applyNarrowWrapSkipIfNeeded('A', DEFAULT_RUN_STYLE);
  expect(reads).toBe(0);
});
