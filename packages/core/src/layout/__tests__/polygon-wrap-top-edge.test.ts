// A line whose top sits just above a tight-wrapped object, and whose band reaches into it,
// wraps around the object like the lines below it (20.4.2.19 wrapTight, 20.4.2.18
// wrapThrough). Measured against Word: a label line that starts 0.8pt above a tight-wrapped
// box sits beside the box, as it does for square wrapping.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutContext, load, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';
import { mergeAvailableIntervalsAtY } from '../drawing-exclusion.ts';
import { squareWrapZone } from './float-over-table-harness.ts';

const PT = 12700;
const TIGHT =
  '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/>' +
  '<wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/>' +
  '<wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>';

/** A 144pt by 72pt picture at the column's left, `offset` points below its paragraph's top. */
function firstLine(wrap: string, offset: number) {
  const xml = squareAnchorAtLeft({ text: 'word '.repeat(40) })
    .replace(/<wp:wrapSquare[^>]*\/>/, wrap)
    .replace(
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset>',
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${offset * PT}</wp:posOffset>`
    );
  const part = load(xml);
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const page = layout.pages[0]!;
  return { picture: page.anchoredDrawings![0]!, line: paragraphFragmentsOf(page)[0]!.lines[0]! };
}

describe('a line that reaches into the top of a polygon-wrapped object', () => {
  for (const [name, wrap] of [
    ['tight', TIGHT],
    ['through', TIGHT.replaceAll('wrapTight', 'wrapThrough')],
  ] as const) {
    test(`${name} wrapping moves the line's text beside the object`, () => {
      // The 14pt line starts 10pt above the picture, so its lower 4pt overlap it.
      const { picture, line } = firstLine(wrap, 10);
      expect(picture.y).toBeCloseTo(10, 6);
      expect(line.spans[0]!.box.x).toBeGreaterThanOrEqual(picture.x + picture.width);
    });
  }

  test('a line that ends above the object keeps the full width', () => {
    const { line } = firstLine(TIGHT, 14);
    expect(line.spans[0]!.box.x).toBe(0);
  });

  test('square wrapping already moves that line', () => {
    const { picture, line } = firstLine('<wp:wrapSquare wrapText="bothSides"/>', 10);
    expect(line.spans[0]!.box.x).toBeGreaterThanOrEqual(picture.x + picture.width);
  });

  test('top and bottom wrapping keeps its own rule for a line that starts above the object', () => {
    // Only polygon wrapping probes from the top edge; a top and bottom band is unchanged.
    const square = squareWrapZone({
      anchorParagraphId: 'p',
      top: 100,
      height: 84,
      left: 0,
      width: 120,
      contentWidth: 400,
    });
    const band = { ...square, input: { ...square.input, mode: 'topAndBottom' as const } };
    expect(mergeAvailableIntervalsAtY(95.001, [band], 0, 400, 14)).toEqual([
      { start: 0, end: 400 },
    ]);
  });
});
