// The content border and row minimum passes of a structure read, run again only around the
// rows a row edit changed (`table-row-range.ts`).

import type { SemanticTableRow } from './semantic-table.ts';
import type { TableBorderBox } from './table-borders.ts';
import { withTableContentBorders } from './table-content-borders.ts';
import {
  rowMinimumContentInsetsApply,
  stampRowMinimumContentInsets,
} from './table-row-minimum-insets.ts';
import { rowWindowPass } from './table-row-range.ts';
import { tableRowReuseEnabled } from './table-structure-rows.ts';

const contentBorders = rowWindowPass();
const rowMinimums = rowWindowPass();

/** The visual rows with their content borders, and row minimums where the table pairs them. */
export function windowedContentRows(
  owner: object,
  visualRows: readonly SemanticTableRow[],
  tableBorders: TableBorderBox,
  columns: number,
  collapsed: boolean
): readonly SemanticTableRow[] {
  const params = JSON.stringify([tableBorders, columns, collapsed]);
  const contentRows = contentBorders.run(owner, [visualRows], params, (start, end) =>
    withTableContentBorders(visualRows.slice(start, end), tableBorders, columns, collapsed)
  );
  if (!rowMinimumContentInsetsApply(visualRows)) return contentRows;
  return rowMinimums.run(owner, [contentRows, visualRows], params, (start, end) =>
    stampRowMinimumContentInsets(
      contentRows.slice(start, end),
      visualRows.slice(start, end),
      tableBorders,
      columns,
      collapsed
    )
  );
}

const aligned = new WeakMap<SemanticTableRow, SemanticTableRow>();

/** `row` with every cell aligned as a legacy table aligns its content, one copy per row. */
export function withLegacyContentAlignment(row: SemanticTableRow): SemanticTableRow {
  const known = tableRowReuseEnabled() ? aligned.get(row) : undefined;
  if (known) return known;
  const result = {
    ...row,
    cells: row.cells.map((cell) => ({ ...cell, legacyContentAlignment: true as const })),
  };
  if (tableRowReuseEnabled()) aligned.set(row, result);
  return result;
}
