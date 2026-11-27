// The header group extends through the last row of a merge from a header row (17.4.49
// `w:tblHeader`, 17.4.84 `w:vMerge`). See `table-header-merged-rows.ts`.

import { describe, expect, test } from 'bun:test';
import type { SemanticTableRow } from '../semantic-table.ts';
import { withMergedHeaderRows } from '../table-header-merged-rows.ts';

/** A row of one-column cells: `r` restarts a merge, `c` continues it, `-` is a plain cell. */
function rows(shape: readonly string[], headers: number): SemanticTableRow[] {
  return shape.map(
    (cells, rowIndex) =>
      ({
        id: `row${rowIndex}`,
        isHeader: rowIndex < headers,
        cells: [...cells].map((kind, column) => ({
          id: `cell${rowIndex}-${column}`,
          gridColumn: column,
          vMergeContinue: kind === 'c',
        })),
      }) as unknown as SemanticTableRow
  );
}

const headerFlags = (list: readonly SemanticTableRow[]) => list.map((row) => row.isHeader);

describe('withMergedHeaderRows', () => {
  test('marks the body rows a header merge covers', () => {
    const extended = withMergedHeaderRows(rows(['r-', 'c-', 'c-', '--'], 1));
    expect(headerFlags(extended)).toEqual([true, true, true, false]);
  });

  test('takes the longest merge from any header row', () => {
    const extended = withMergedHeaderRows(rows(['r-', 'cr', 'cc', '-c', '--'], 2));
    expect(headerFlags(extended)).toEqual([true, true, true, true, false]);
  });

  test('keeps the rows when no header merge reaches the body', () => {
    const inside = rows(['r-', 'c-', '--', 'r-', 'c-'], 2);
    expect(withMergedHeaderRows(inside)).toBe(inside);
    const noHeader = rows(['r-', 'c-', '--'], 0);
    expect(withMergedHeaderRows(noHeader)).toBe(noHeader);
  });

  test('ignores a merge headed in a covered body row', () => {
    // Column 1 starts in row 1, which the column-0 merge covers, and ends in row 3.
    const extended = withMergedHeaderRows(rows(['r-', 'cr', '-c', '-c', '--'], 1));
    expect(headerFlags(extended)).toEqual([true, true, false, false, false]);
  });

  test('returns the same row objects for the same input rows', () => {
    const input = rows(['r-', 'c-', '--'], 1);
    const first = withMergedHeaderRows(input);
    const second = withMergedHeaderRows(input);
    expect(second[1]).toBe(first[1]!);
    expect(second[0]).toBe(input[0]!);
    expect(second[2]).toBe(input[2]!);
    expect(input[1]!.isHeader).toBe(false);
  });
});
