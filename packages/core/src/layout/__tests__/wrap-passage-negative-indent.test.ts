// A paragraph with a negative left or right indent keeps that reach beside a float. The float's
// passages stop at the column edges, and a passage that meets a column edge reaches the
// paragraph's own bound instead (17.3.1.12 ind, 20.4.2.17 wrapSquare). A float wholly in the
// margin wraps nothing: the indented text runs on under it.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutContext, load, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

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
