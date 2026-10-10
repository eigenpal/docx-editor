import { measureRowHeight, type TableFlowDeps } from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableRowFragmentRecord } from './semantic-records.ts';

/** Enough vertical room to lay a positioned table as one visual object on its anchor sheet. */
export const POSITIONED_TABLE_LAYOUT_BOTTOM_PT = Number.MAX_SAFE_INTEGER / 1024;

/** A row fragment whose rest continues on the next page: the head of a split row. */
export function splitHead(record: TableRowFragmentRecord): TableRowFragmentRecord {
  return { ...record, hasContinuation: true };
}

/** One row's natural height where the table stands now. The table origin can move. */
export function createRowHeightProbe(
  structure: SemanticTableStructure,
  left: () => number,
  cursorY: () => number,
  currentDeps: () => TableFlowDeps
): (row: SemanticTableRow, top?: number, deps?: TableFlowDeps) => number {
  return (row, top = cursorY(), deps) =>
    measureRowHeight(
      row,
      structure.columnWidthsPt,
      left(),
      0,
      deps ?? currentDeps(),
      structure.cellSpacingPt,
      undefined,
      currentDeps().pageExclusionZones?.().length ? top : undefined
    );
}
