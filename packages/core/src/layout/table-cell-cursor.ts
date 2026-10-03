import type { HeldCellBreak } from './cell-continuation-lines.ts';
import type { SemanticTableRow } from './semantic-table.ts';

/**
 * Per-cell progress through a row that may span pages. Indices are into the authored
 * cell.blocks list and the paragraph's broken lines — never DOM geometry.
 */
export interface CellPlaceCursor {
  readonly blockIndex: number;
  readonly lineIndex: number;
  /** Resume by model position when the next page changes line wrapping. */
  readonly startOffset?: number;
  /** The continued paragraph's line break, which the next page indexes instead of re-breaking. */
  readonly heldBreak?: HeldCellBreak;
  /** Row-boundary continuation of the nested table at blockIndex. */
  readonly nestedTable?: { readonly nextRowIndex: number; readonly fragmentIndex: number };
  readonly previousSpaceAfter: number;
  readonly paragraphFragmentIndex: number;
  /**
   * Did the block before `blockIndex` actually PUT a table on the page?
   *
   * Carried rather than re-derived, because the only thing left to re-derive it from is the
   * source node's kind — and a `w:tbl` past the nesting ceiling, or one with no `w:tr` at
   * all, is a table that emits nothing. Reading the kind on a continuation would let the
   * terminator collapse behind a table that never appeared on that page.
   */
  readonly precededByEmittedTable: boolean;
}

export function initialCellCursors(row: SemanticTableRow): CellPlaceCursor[] {
  return row.cells.map(initialCellCursor);
}

export function initialCellCursor(): CellPlaceCursor {
  return {
    blockIndex: 0,
    lineIndex: 0,
    previousSpaceAfter: 0,
    paragraphFragmentIndex: 0,
    precededByEmittedTable: false,
  };
}
