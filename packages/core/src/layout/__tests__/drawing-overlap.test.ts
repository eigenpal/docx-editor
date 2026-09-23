import { describe, expect, test } from 'bun:test';
import { anchorPairInParagraph, layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { resolveOverlapDisplacement } from '../drawing-overlap.ts';

const measurer = createFixedMeasurer(6, 14);

/** The two pictures as laid out, in source order. */
function pair(options: Parameters<typeof anchorPairInParagraph>[0]) {
  const part = load(anchorPairInParagraph(options));
  const page = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  }).pages[0]!;
  const drawings = [...(page.anchoredDrawings ?? [])].sort(
    (left, right) => (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0)
  );
  expect(drawings).toHaveLength(2);
  return { first: drawings[0]!, second: drawings[1]! };
}

const TEXT = 'word '.repeat(80);
const SIZE = { width: 158, height: 50, text: TEXT } as const;

// Word 16.113 moves a picture that may not overlap SIDEWAYS at its authored height: flush
// right of the picture it hits when that fits in the content box, else flush left. Only
// when neither side fits does it move down.
describe('allowOverlap="0" displacement', () => {
  test('moves the later picture flush right of the one it hits', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '0',
      first: { x: 22, y: 0 },
      second: { x: 94, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x + first.width, 3);
    expect(second.y).toBeCloseTo(first.y + 22, 3);
  });

  test('goes right even when the later picture was authored to the left', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '0',
      first: { x: 108, y: 0 },
      second: { x: 36, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x + first.width, 3);
  });

  test('goes left when the right side has no room', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '0',
      first: { x: 230, y: 0 },
      second: { x: 288, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x - second.width, 3);
    expect(second.y).toBeCloseTo(first.y + 22, 3);
  });

  test('moves down only when neither side fits', () => {
    const { first, second } = pair({
      width: 252,
      height: 50,
      text: TEXT,
      allowOverlap: '0',
      first: { x: 100, y: 0 },
      second: { x: 150, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x + 50, 3);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  });

  test('allowOverlap="1" leaves both where they were authored', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '1',
      first: { x: 22, y: 0 },
      second: { x: 94, y: 22 },
    });
    expect(second.x).toBeCloseTo(first.x + 72, 3);
  });

  test('a picture deferred to the next page carries its authored x, not the sideways move', () => {
    const { first, second } = pair({
      ...SIZE,
      allowOverlap: '1',
      first: { x: 22, y: 0 },
      second: { x: 94, y: 22 },
    });
    const later = Object.freeze({ ...second, allowOverlap: false });
    const resolved = resolveOverlapDisplacement([first, later], {
      contentHeight: later.y + later.height - 1,
      contentWidth: 468,
    });
    expect(resolved.deferred).toHaveLength(1);
    expect(resolved.deferred[0]!.x).toBeCloseTo(second.x, 3);
  });
});
