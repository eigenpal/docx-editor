// A paragraph with a negative left or right indent keeps that reach beside a float. The float's
// passages stop at the column edges, and a passage that meets a column edge reaches the
// paragraph's own bound instead (17.3.1.12 ind, 20.4.2.17 wrapSquare). A float wholly in the
// margin wraps nothing: the indented text runs on under it. The same holds in a table cell or a
// header, where the indent places the text past the story's content box.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import {
  layoutContext,
  load,
  squareAnchorAtLeft,
  squareAnchorInCell,
} from './anchored-drawing-test-fixtures.ts';
import { wrapBreakSpace } from '../wrap-break-space.ts';

const PT = 12700;
/** The column's right edge, and the paragraph's right bound with `w:right="-851"`. */
const COLUMN_RIGHT = 468;
const PARAGRAPH_RIGHT = COLUMN_RIGHT + 42.55;

/** A square-wrapped picture `width` by 72pt, `x` points into the column, beside indented text. */
function linesBeside(x: number, indent: string, width = 144) {
  const xml = squareAnchorAtLeft({ text: 'word '.repeat(60) })
    .replaceAll('cx="1828800"', `cx="${width * PT}"`)
    .replace(
      '<wp:posOffset>0</wp:posOffset></wp:positionH>',
      `<wp:posOffset>${x * PT}</wp:posOffset></wp:positionH>`
    )
    .replace('<w:p><w:r><w:drawing>', `<w:p><w:pPr><w:ind ${indent}/></w:pPr><w:r><w:drawing>`);
  const part = load(xml);
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const page = layout.pages[0]!;
  const picture = page.anchoredDrawings![0]!;
  const lines = paragraphFragmentsOf(page)[0]!.lines;
  return { picture, lines };
}

const overlaps = (
  span: { readonly box: { readonly x: number; readonly width: number } },
  picture: { readonly x: number; readonly width: number }
) => span.box.x < picture.x + picture.width && span.box.x + span.box.width > picture.x;

const spansOf = (line: { readonly spans: readonly { readonly box: { readonly x: number } }[] }) =>
  line.spans.map((span) => span.box.x);

describe('a negative indent beside a float', () => {
  test('a negative left indent starts the passage left of the float in the margin', () => {
    const { picture, lines } = linesBeside(100, 'w:left="-851"');
    const first = spansOf(lines[0]!);
    expect(first[0]).toBeCloseTo(-42.55, 6);
    // The passage still stops at the float; the text resumes after it.
    expect(first.some((x) => x >= picture.x + picture.width)).toBe(true);
    expect(first.every((x) => x < picture.x || x >= picture.x + picture.width)).toBe(true);
  });

  test('a paragraph inside the column keeps the column passages', () => {
    const { lines } = linesBeside(100, 'w:left="0"');
    expect(spansOf(lines[0]!)[0]).toBe(0);
  });

  test('a float wholly in the margin leaves the indented text running under it', () => {
    const { picture, lines } = linesBeside(-40, 'w:left="-851"', 30);
    expect(picture.x).toBeCloseTo(-40, 6);
    expect(spansOf(lines[0]!)[0]).toBeCloseTo(-42.55, 6);
    expect(lines[0]!.spans.some((span) => overlaps(span, picture))).toBe(true);
  });

  test('a negative right indent ends the passage right of the float in the margin', () => {
    const { picture, lines } = linesBeside(300, 'w:right="-851"');
    const ends = lines[0]!.spans.map((span) => span.box.x + span.box.width);
    expect(lines[0]!.spans.some((span) => span.box.x >= picture.x + picture.width)).toBe(true);
    expect(Math.max(...ends)).toBeGreaterThan(COLUMN_RIGHT);
    expect(Math.max(...ends)).toBeLessThanOrEqual(PARAGRAPH_RIGHT + 0.000_001);
    expect(lines[0]!.spans.some((span) => overlaps(span, picture))).toBe(false);
  });

  test('a float wholly in the right margin leaves the indented text running under it', () => {
    const { picture, lines } = linesBeside(480, 'w:right="-851"', 20);
    const ends = lines[0]!.spans.map((span) => span.box.x + span.box.width);
    expect(Math.max(...ends)).toBeGreaterThan(COLUMN_RIGHT);
    expect(lines[0]!.spans.some((span) => overlaps(span, picture))).toBe(true);
  });
});

/** The cell, the picture 100pt into it, and the first lines of an indented cell paragraph. */
function cellLinesBeside(indent: string) {
  const xml = squareAnchorInCell({ text: 'word '.repeat(80), layoutInCell: '1', tableIndent: 1440 })
    .replace(
      '<wp:posOffset>0</wp:posOffset></wp:positionH>',
      `<wp:posOffset>${100 * PT}</wp:posOffset></wp:positionH>`
    )
    .replace('<w:p><w:r><w:drawing>', `<w:p><w:pPr><w:ind ${indent}/></w:pPr><w:r><w:drawing>`);
  const part = load(xml);
  const page = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  }).pages[0]!;
  const table = page.fragments.find((fragment) => fragment.kind === 'table');
  if (table?.kind !== 'table') throw new Error('table expected');
  const block = table.rows[0]!.cells[0]!.blocks[0]!;
  if (block.kind !== 'paragraph') throw new Error('paragraph expected');
  const picture = page.anchoredDrawings![0]!;
  return { picture, first: lineExtent(block.lines[0]!), lines: block.lines };
}

/** The left and right ends of a line's text. */
function lineExtent(line: {
  readonly spans: readonly { readonly box: { readonly x: number; readonly width: number } }[];
}) {
  const starts = line.spans.map((span) => span.box.x);
  const ends = line.spans.map((span) => span.box.x + span.box.width);
  return { left: Math.min(...starts), right: Math.max(...ends) };
}

describe('a negative indent beside a float in a table cell', () => {
  const control = cellLinesBeside('w:left="0"');

  test('a negative left indent starts the passage left of the float past the cell edge', () => {
    const { picture, first, lines } = cellLinesBeside('w:left="-851"');
    expect(first.left).toBeCloseTo(control.first.left - 42.55, 6);
    expect(first.right).toBeGreaterThan(picture.x + picture.width);
    expect(lines[0]!.spans.some((span) => overlaps(span, picture))).toBe(false);
  });

  test('a negative right indent ends the passage right of the float past the cell edge', () => {
    const { picture, first, lines } = cellLinesBeside('w:right="-851"');
    expect(first.left).toBeCloseTo(control.first.left, 6);
    expect(first.right).toBeGreaterThan(control.first.right + 6);
    expect(lines[0]!.spans.some((span) => overlaps(span, picture))).toBe(false);
  });
});

describe('the break space of a paragraph past its story box', () => {
  test('reaches the text of a negative indent or a hanging first line', () => {
    const edges = { firstLineOffset: -10, contentLeft: 0, wrapRight: 100 };
    const space = wrapBreakSpace(false, -20, 140, edges);
    expect(space.left).toBe(-30);
    expect(space.right).toBe(120);
  });

  test('keeps the story box for a paragraph inside it', () => {
    const space = wrapBreakSpace(false, 10, 80, {
      firstLineOffset: 0,
      contentLeft: 0,
      wrapRight: 90,
    });
    expect(space.left).toBe(0);
    expect(space.right).toBe(90);
  });
});
