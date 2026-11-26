// The carrying row as one row of content for footnote bands (`table-carried-head-row.ts`).
// Merges that start in different rows (`w:vMerge`, `CT_VMerge`, ECMA-376 Part 1, 17.4.84) each
// carry their text in their own zero-height head-row continuation, so two can stack above one
// row. Every one of them gives its head cell copy to the row below.

import { expect, test } from 'bun:test';
import { withCarriedHeads } from '../table-carried-head-row.ts';
import type { TableRowFragmentRecord } from '../semantic-records.ts';

interface CellShape {
  readonly id: string;
  readonly gridColumn: number;
  readonly text?: string;
  readonly continues?: boolean;
}

/** A row record with only the fields `withCarriedHeads` reads. */
function row(id: string, height: number, cells: readonly CellShape[]): TableRowFragmentRecord {
  return {
    id,
    isContinuation: height === 0,
    box: { x: 0, y: 100, width: 300, height },
    cells: cells.map((cell) => ({
      id: cell.id,
      gridColumn: cell.gridColumn,
      vMergeContinue: cell.continues === true,
      rowSpan: 1,
      box: { x: cell.gridColumn * 100, y: 100, width: 100, height: height || 50 },
      blocks: cell.text ? [{ kind: 'paragraph', text: cell.text }] : [],
    })),
  } as unknown as TableRowFragmentRecord;
}

test('every carried head row above a row gives its head cell copy to that row', () => {
  // Column 2 merges from row 0 and column 1 merges from row 1. Both continue into row 2.
  const fromRow0 = row('r0', 0, [
    { id: 'a', gridColumn: 0 },
    { id: 'b', gridColumn: 1 },
    { id: 'c', gridColumn: 2, text: 'LONG' },
  ]);
  const fromRow1 = row('r1', 0, [
    { id: 'd', gridColumn: 0 },
    { id: 'e', gridColumn: 1, text: 'STAIR' },
    { id: 'f', gridColumn: 2, continues: true },
  ]);
  const carrying = row('r2', 50, [
    { id: 'g', gridColumn: 0, text: 'K2' },
    { id: 'h', gridColumn: 1, continues: true },
    { id: 'i', gridColumn: 2, continues: true },
  ]);
  const merged = withCarriedHeads([fromRow0, fromRow1], carrying);
  expect(merged.cells.map((cell) => cell.id)).toEqual(['g', 'e', 'c']);
  for (const cell of merged.cells) expect(cell.box.height).toBe(50);
  expect(withCarriedHeads([], carrying)).toBe(carrying);
});
