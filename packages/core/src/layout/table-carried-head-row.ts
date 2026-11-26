// The zero-height head-row continuation that holds merged text carried past a head-row page
// break (`table-vmerge-boundary.ts`).
//
// When a vertical merge's text moves whole past a break after its head row, each fragment of
// the row that carries the text is published below a zero-height continuation of the head
// row. Its head cell copy holds the text and spans the carrying row. For selection, commands,
// hit testing and export that record is the head row's own. For readers that reason about
// one row's flow on a page (footnote bands), it is not a row of its own: the head row is
// complete on the earlier page, and the carried text breaks together with the row below it.

import type { TableRowFragmentRecord } from './semantic-records.ts';

/** Whether `row` is a zero-height head-row continuation above a carrying row. */
export function isCarriedHeadRow(row: TableRowFragmentRecord): boolean {
  return row.isContinuation === true && row.box.height <= 0;
}

/**
 * The carrying row as one row of content: each inert continuation slot takes the head cell
 * copy from `carried`, the zero-height records directly above it, as a cell of this row alone.
 * Merges that start in different rows each carry their text in their own record, so several
 * can stack above one row. `row` itself when no record holds a head cell copy.
 */
export function withCarriedHeads(
  carried: readonly TableRowFragmentRecord[],
  row: TableRowFragmentRecord
): TableRowFragmentRecord {
  const heads = carried
    .filter(isCarriedHeadRow)
    .flatMap((record) => record.cells.filter((cell) => cell.blocks.length > 0));
  if (heads.length === 0) return row;
  return {
    ...row,
    cells: row.cells.map((cell) => {
      if (!cell.vMergeContinue) return cell;
      const head = heads.find((candidate) => candidate.gridColumn === cell.gridColumn);
      return head ? { ...head, rowSpan: 1, box: cell.box } : cell;
    }),
  };
}
