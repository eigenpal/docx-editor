// The repeated header group of a table whose header merges go on into the body rows.
//
// The leading rows with `w:tblHeader` (ECMA-376 Part 1, 17.4.49, `CT_OnOff`) repeat at the top
// of each page the table continues on. A vertical merge (17.4.84 `w:vMerge`, `CT_VMerge`) that
// starts in one of those rows and continues into body rows is one cell, and its text belongs
// to all of the rows it covers. So the group is extended through the last row of each such
// merge: the covered body rows are laid out, kept together, and repeated with the header rows.
//
// Reference renderings agree on every shape tested: the repeated copy holds the covered body
// rows and their text, the extended group moves to the next page whole, and it stays with the
// first row below it. A table that the extended group fills completely moves to the next page
// whole when it does not fit.
//
// Only merges headed in an authored header row extend the group. A merge headed in a covered
// body row that ends below the group keeps the older behavior: its head sizes its own row.

import type { SemanticTableRow } from './semantic-table.ts';
import { resolveVMergeSpans } from './table-vmerge.ts';

/** One extended copy per resolved row, so a resolve that reuses a row reuses its copy too. */
const asHeaderRow = new WeakMap<SemanticTableRow, SemanticTableRow>();

/** `row` marked as a header row, by identity for the same input row. */
function headerCopyOf(row: SemanticTableRow): SemanticTableRow {
  const known = asHeaderRow.get(row);
  if (known) return known;
  const copy = { ...row, isHeader: true };
  asHeaderRow.set(row, copy);
  return copy;
}

/**
 * `rows` with each body row that a merge from the leading header rows covers marked as a
 * header row. Returns `rows` itself when no header merge reaches a body row.
 */
export function withMergedHeaderRows(rows: readonly SemanticTableRow[]): SemanticTableRow[] {
  let headerCount = 0;
  while (headerCount < rows.length && rows[headerCount]!.isHeader) headerCount += 1;
  const firstBody = rows[headerCount];
  // Only a continuation in the first body row can carry a header merge into the body.
  if (headerCount === 0 || !firstBody?.cells.some((cell) => cell.vMergeContinue)) {
    return rows as SemanticTableRow[];
  }
  const spans = resolveVMergeSpans(rows);
  let groupEnd = headerCount;
  for (let index = 0; index < headerCount; index += 1) {
    for (const cell of rows[index]!.cells) {
      const span = spans.get(cell.id);
      if (span !== undefined) groupEnd = Math.max(groupEnd, Math.min(index + span, rows.length));
    }
  }
  if (groupEnd === headerCount) return rows as SemanticTableRow[];
  return rows.map((row, index) =>
    index >= headerCount && index < groupEnd ? headerCopyOf(row) : row
  );
}
