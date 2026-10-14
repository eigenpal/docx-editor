// An exact-height row taller than the page content.
//
// The reference layout keeps such a row at its exact height on a fresh page: it runs past
// the bottom margin and the sheet edge clips it, and the next block starts on the next
// page. The page model is bounded by the content box, so the row fills the rest of the
// band instead, with its content clipped there. Pagination is the same.

import type { SemanticTableRow } from './semantic-table.ts';
import { TablePaginationError } from './semantic-table-layout.ts';

/** The row and band to place for an exact row no band holds, or null for any other row. */
export function clippedExactRow(
  row: SemanticTableRow,
  contentHeight: number,
  cursorY: number
): { readonly row: SemanticTableRow; readonly band: number } | null {
  const band = contentHeight - cursorY;
  if (row.height.rule !== 'exact' || band <= 0) return null;
  return { row: { ...row, height: { rule: 'exact', valuePt: band } }, band: contentHeight };
}

/** The refusal for a keep-together row that no page can hold. */
export function overheightRowError(row: SemanticTableRow): TablePaginationError {
  return new TablePaginationError(
    'table-row-overheight',
    row.height.rule === 'exact'
      ? `Table row ${row.id} has w:trHeight hRule=exact taller than the available page content`
      : `Table row ${row.id} has w:cantSplit and is taller than the available page content`
  );
}
