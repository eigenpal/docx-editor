// A line whose top sits just above a tight-wrapped object, and whose band reaches into it,
// wraps around the object like the lines below it (20.4.2.19 wrapTight, 20.4.2.18
// wrapThrough). A label line that starts 0.8pt above a tight-wrapped box sits beside the
// box, as it does for square wrapping. Every line clears the contour (20.4.2.16
// wrapPolygon) across its whole band, not only at one scanline.

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
      // The line starts 10pt above the picture, so its lower part overlaps it.
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

/** A tight wrap whose contour runs through `points`, in the 21600-unit polygon square. */
function tightContour(points: readonly (readonly [number, number])[]): string {
  const [first, ...rest] = points;
  return (
    `<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="1"><wp:start x="${first![0]}" y="${first![1]}"/>` +
    rest.map(([x, y]) => `<wp:lineTo x="${x}" y="${y}"/>`).join('') +
    '</wp:wrapPolygon></wp:wrapTight>'
  );
}

/** Whether no text on the line overlaps the open interval from `from` to `to`. */
function clearOf(line: ReturnType<typeof firstLine>['line'], from: number, to: number): boolean {
  return line.spans.every(
    (span) => span.box.x + span.box.width <= from + 1e-6 || span.box.x >= to - 1e-6
  );
}

describe('a line band clears the contour across its whole height', () => {
  // A diamond on the 144pt by 72pt picture: apex (72, 0), sides (0, 36) and (144, 36).
  const DIAMOND = tightContour([
    [10800, 0],
    [21600, 10800],
    [10800, 21600],
    [0, 10800],
    [10800, 0],
  ]);

  /** The diamond's span at the line foot: it widens by 2pt on each side per point below the apex. */
  function diamondAtFoot(offset: number): {
    line: ReturnType<typeof firstLine>['line'];
    from: number;
    to: number;
  } {
    const { picture, line } = firstLine(DIAMOND, offset);
    const depth = Math.min(36, line.box.y + line.box.height - picture.y) - 0.02;
    return { line, from: 72 - 2 * depth, to: 72 + 2 * depth };
  }

  test('a line that reaches into a pointed top clears the contour at the line foot', () => {
    // The first line starts 10pt above the apex, which is the only part a top probe sees.
    const { line, from, to } = diamondAtFoot(10);
    expect(to - from).toBeGreaterThan(4);
    expect(line.spans.length).toBeGreaterThan(0);
    expect(clearOf(line, from, to)).toBe(true);
  });

  test('a line inside the contour clears its widest part in the band', () => {
    // The first line starts at the apex; the diamond is widest at the line foot.
    const { line, from, to } = diamondAtFoot(0);
    expect(to - from).toBeGreaterThan(40);
    expect(line.spans.length).toBeGreaterThan(0);
    expect(clearOf(line, from, to)).toBe(true);
  });

  test('a contour that starts below the picture top still wraps the line that reaches it', () => {
    // The polygon starts 7.2pt below the picture top, inside the first line.
    const inset = tightContour([
      [0, 2160],
      [0, 21600],
      [21600, 21600],
      [21600, 2160],
      [0, 2160],
    ]);
    const { picture, line } = firstLine(inset, 0);
    expect(line.spans[0]!.box.x).toBeGreaterThanOrEqual(picture.x + picture.width);
  });
});

describe('a line whose top meets the foot of a polygon wrap', () => {
  /** The first-line spans of the line that starts at `bottom`, with the contour ending there. */
  function lineAtFoot(wrap: string, footFraction: number) {
    const tops = paragraphFragmentsOf(
      layoutSemanticDocument(load(squareAnchorAtLeft({ text: 'word '.repeat(40) })), 1, {
        measurer: createFixedMeasurer(6, 14),
      }).pages[0]!
    )[0]!.lines.map((line) => line.box.y);
    // The contour ends `footFraction` down the 72pt picture, exactly at the third line's top.
    const offset = tops[2]! - 72 * footFraction;
    const xml = squareAnchorAtLeft({ text: 'word '.repeat(40) })
      .replace(/<wp:wrapSquare[^>]*\/>/, wrap)
      .replace(
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset>',
        `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(offset * PT)}</wp:posOffset>`
      );
    const part = load(xml);
    const page = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: layoutContext(part),
    }).pages[0]!;
    const line = paragraphFragmentsOf(page)[0]!.lines.find(
      (candidate) => Math.abs(candidate.box.y - tops[2]!) < 0.5
    )!;
    return { picture: page.anchoredDrawings![0]!, line };
  }

  test('wraps beside the object when the contour reaches its bottom edge', () => {
    for (const wrap of [TIGHT, TIGHT.replaceAll('wrapTight', 'wrapThrough')]) {
      const { picture, line } = lineAtFoot(wrap, 1);
      expect(line.spans[0]!.box.x).toBeGreaterThanOrEqual(picture.x + picture.width);
    }
  });

  test('stays full width when the contour ends above the bottom edge', () => {
    const inset = tightContour([
      [0, 0],
      [0, 16200],
      [21600, 16200],
      [21600, 0],
      [0, 0],
    ]);
    expect(lineAtFoot(inset, 0.75).line.spans[0]!.box.x).toBe(0);
  });

  test('stays full width beside a square wrap', () => {
    const { line } = lineAtFoot('<wp:wrapSquare wrapText="bothSides"/>', 1);
    expect(line.spans[0]!.box.x).toBe(0);
  });
});
