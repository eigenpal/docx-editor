// The last word on "merged content stays inside its cell": a geometric trim over blocks that
// are already placed, so it cannot be wrong about where the box is.
//
// A merged head flows against the PAGE, because its span's real extent is not known until
// every row of the span has been placed. Where the paginator then has to cut the span short
// to recover — a `w:cantSplit` covered row that will not fit, or a fragment that placed
// nothing — the box its rows actually made can end above content the head already flowed.

import { describe, expect, test } from 'bun:test';
import { blocksClippedTo } from '../table-cell-geometry.ts';
import type { BlockFragmentRecord } from '../semantic-records.ts';

function line(y: number, height: number) {
  return {
    id: `l${y}`,
    range: { start: 0, end: 0 },
    spans: [],
    box: { x: 0, y, width: 10, height },
  };
}

function paragraph(y: number, lineHeights: readonly number[]): BlockFragmentRecord {
  let cursor = y;
  const lines = lineHeights.map((height) => {
    const record = line(cursor, height);
    cursor += height;
    return record;
  });
  return {
    kind: 'paragraph',
    paragraphId: `p${y}`,
    lines,
    box: { x: 0, y, width: 10, height: cursor - y },
  } as unknown as BlockFragmentRecord;
}

function nested(y: number, height: number): BlockFragmentRecord {
  return {
    kind: 'table',
    tableId: `t${y}`,
    fragmentIndex: 0,
    rows: [],
    box: { x: 0, y, width: 10, height },
  } as unknown as BlockFragmentRecord;
}

describe('blocksClippedTo', () => {
  test('returns the same array when nothing crosses the line', () => {
    const blocks = [paragraph(0, [10, 10]), paragraph(20, [10])];
    expect(blocksClippedTo(blocks, 30)).toBe(blocks);
    expect(blocksClippedTo(blocks, 1000)).toBe(blocks);
  });

  test('keeps the lines that fit and drops the ones below', () => {
    const trimmed = blocksClippedTo([paragraph(0, [10, 10, 10])], 20);
    expect(trimmed).toHaveLength(1);
    const kept = trimmed[0]!;
    expect(kept.kind).toBe('paragraph');
    expect(kept.kind === 'paragraph' ? kept.lines.length : 0).toBe(2);
    expect(kept.box.height).toBe(20);
  });

  test('drops a block that starts at or below the line', () => {
    expect(blocksClippedTo([paragraph(0, [10]), paragraph(10, [10])], 10)).toHaveLength(1);
  });

  test('a nested table goes whole or not at all: it cannot be cut here', () => {
    // Cutting one would mean laying it out again, which this pass is far past.
    expect(blocksClippedTo([nested(0, 30)], 20)).toHaveLength(0);
    expect(blocksClippedTo([nested(0, 30)], 30)).toHaveLength(1);
  });

  test('a paragraph with no line above the cut is dropped rather than left empty', () => {
    expect(blocksClippedTo([paragraph(0, [30])], 10)).toHaveLength(0);
  });
});
