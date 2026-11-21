// The keep and repeat rules one body row of a paginated table answers while it is placed.
//
// Split out of `table-flow-pagination.ts`, which decides where rows go. The answers read the
// paginator's live state through getters: the cursor, the row's measured height, its open
// merge, and how far it has split.

import { bottomToTopTextKeepsRowWhole } from './table-cell-text-direction.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { probeBodyRowStart, probeRowFragmentProgress } from './table-row-progress-probe.ts';
import { ruleRoomPt } from './table-exact-terminal-border.ts';
import { rowMinimumFits } from './table-row-minimum-fit.ts';
import {
  prepareRepeatedHeaderBorderPlan,
  type RepeatedHeaderBorderPlan,
} from './repeated-header-border-metrics.ts';
import type { CellPlaceCursor, TableFlowDeps } from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';

export interface TableRowRuleInput {
  readonly structure: SemanticTableStructure;
  readonly row: SemanticTableRow;
  readonly headerRows: readonly SemanticTableRow[];
  readonly headerGroupHeight: number;
  readonly deps: TableFlowDeps;
  /** `w:cantSplit`, or a header row that keeps whole (`whole-rows`). */
  readonly cantSplit: boolean;
  /** `repeatKeepsWholeRow` applies (before mode 15). */
  readonly repeatKeepsWholeRow: boolean;
  readonly left: () => number;
  readonly top: () => number;
  readonly bottom: () => number;
  /** The whole band of a fresh page below any band the fragment opened under. */
  readonly freshBand: () => number;
  /** The top of the band the fragment opened under, or 0. */
  readonly bandTop: () => number;
  readonly naturalHeight: () => number;
  readonly baselineBodyHeight: () => number;
  readonly vMerge: () => RowVMergeLayoutOptions | undefined;
  readonly isContinuation: () => boolean;
  readonly cursors: () => readonly CellPlaceCursor[];
  /** `headerRowsKeepWithBody` applies (mode 15 and later). */
  readonly laterLayout: boolean;
  /** The deps the row places with where it stands. */
  readonly rowDeps: () => TableFlowDeps;
}

export interface TableRowRules {
  /** A page can hold the whole row. */
  pageHoldsRow(): boolean;
  /** The row moves whole to a page that can hold it when it does not fit below `top`. */
  keepsWholeAt(top: number): boolean;
  /** Repeated header rows stay above the row, which runs past the margin below them. */
  overflowsBelowRepeat(top?: number): boolean;
  /** The row can start below `top`. */
  progressesAt(top: number): boolean;
  /** Repeated header rows stay above a row whose start does not fit below them. */
  startMissesBelowRepeat(top: number): boolean;
  /** The repeated-header border plan for this row, when one applies. */
  prepareRepeat(): RepeatedHeaderBorderPlan | null | undefined;
  /** Repeated header rows may open a page whose body starts at `bodyTop`. */
  admitsRepeatedHeaders(bodyTop: number, clearingFloat?: boolean): boolean;
  /**
   * The row fits a page whole but not below `top` with `closingEdge` under it, and it may not
   * split here: it keeps whole, has an exact height, or cannot start every cell.
   */
  movesWhole(closingEdge: number): boolean;
}

export function tableRowRules(input: TableRowRuleInput): TableRowRules {
  const { structure, row, deps } = input;
  // `w:cantSplit` keeps a row whole only when a page can hold it. The full band counts,
  // because a note reserve yields to a kept row. A wrapping float still reduces that band.
  // A taller row starts on a fresh page and then splits like an ordinary row.
  const pageHoldsRow = (): boolean => input.naturalHeight() <= input.freshBand() + 0.001;
  // `btLr` text takes its line length from the whole row, so such a row also moves whole to
  // a page that can hold it when its authored minimum does not fit the room below `top`
  // (`bottomToTopTextKeepsRowWhole`).
  const keepsWholeAt = (top: number): boolean =>
    input.cantSplit ||
    bottomToTopTextKeepsRowWhole(
      row,
      input.bottom() - top,
      (cell) =>
        deps.cellContentInsets?.get(cell.id) ??
        cellContentInsets(cell, structure.cellSpacingPt === 0),
      deps.cellMinimumContentInsets
    );
  // Before mode 15, repeated header rows stay above a row that cannot split, fits a fresh
  // page, and does not fit below them. The row then stays whole there and runs past the margin.
  const overflowsBelowRepeat = (top = input.top()): boolean =>
    input.repeatKeepsWholeRow &&
    pageHoldsRow() &&
    (row.height.rule === 'exact' || keepsWholeAt(top));
  const progressesAt = (top: number): boolean =>
    probeBodyRowStart(
      structure,
      row,
      input.left(),
      top,
      input.bottom(),
      input.isContinuation(),
      deps,
      input.cursors()
    );
  // Before mode 15, repeated header rows also stay above a row that can split when the first
  // line of a cell, or the first row of a nested table that opens one, does not fit below them.
  // The row then stays whole there, past the margin or the page edge. A continued row keeps
  // the repeat the same way when its next line or nested row does not fit, and its rest
  // stays on that page. Cells ignore widow control in these modes (`tableParagraphWidowControl`).
  const startMissesBelowRepeat = (top: number): boolean =>
    input.repeatKeepsWholeRow &&
    input.naturalHeight() > input.bottom() - top + 0.001 &&
    input.vMerge() === undefined &&
    row.height.rule !== 'exact' &&
    !keepsWholeAt(top) &&
    !progressesAt(top);
  // A plan refuses a body row that does not fit below the repeat. A row that overflows
  // there instead takes the ordinary repeat path.
  const prepareRepeat = (): RepeatedHeaderBorderPlan | null | undefined => {
    if (input.isContinuation()) return undefined;
    const plan = prepareRepeatedHeaderBorderPlan(
      structure,
      input.headerRows,
      row,
      input.left(),
      input.top(),
      input.bottom(),
      input.headerGroupHeight,
      input.baselineBodyHeight(),
      deps
    );
    const below = input.top() + input.headerGroupHeight;
    return plan === null && (overflowsBelowRepeat() || startMissesBelowRepeat(below))
      ? undefined
      : plan;
  };
  /**
   * Repeating headers is admissible only when this exact row state can progress below them.
   * Explicitly atomic rows must fit whole; auto/atLeast and continued rows use the same bounded
   * placer as the commit path, but behind a side-effect-free probe. The callback receives the
   * real post-header top after any column advance.
   */
  const admitsRepeatedHeaders = (bodyTop: number, clearingFloat = false): boolean => {
    const remaining = input.bottom() - bodyTop;
    if (remaining <= 0.001) return false;
    const continued = input.isContinuation();
    // Clearance first offers the row the float-free band. Only the optional repeat
    // must leave the authored minimum intact within that fresh band.
    if (
      !continued &&
      !clearingFloat &&
      input.laterLayout &&
      !rowMinimumFits(row, input.rowDeps(), structure.cellSpacingPt, input.freshBand(), remaining)
    )
      return false;
    // The unsplit commit path consumes a complete row regardless of `fitted`: an empty row's
    // authored box is structural progress even though it places no text. Mirror that path before
    // asking the bounded probe, whose `fitted` flag deliberately means content progress.
    if (!continued && input.naturalHeight() <= remaining + 0.001) return true;
    if (
      !continued &&
      (row.height.rule === 'exact' || (!clearingFloat && keepsWholeAt(bodyTop) && pageHoldsRow()))
    ) {
      // Before mode 15 the repeat stays, and the row runs past the margin below it.
      return !clearingFloat && overflowsBelowRepeat(bodyTop);
    }
    // The header is optional: the probe asks whether the paragraph can honor its widow rule
    // below it. If not, omit the repeat and offer the full page.
    return progressesAt(bodyTop) || (!clearingFloat && startMissesBelowRepeat(bodyTop));
  };
  const movesWhole = (closingEdge: number): boolean => {
    const top = input.top();
    const bottom = input.bottom();
    const height = input.naturalHeight();
    return (
      height <= bottom + 0.001 &&
      top + height + closingEdge + ruleRoomPt(row, deps, input.rowDeps) > bottom + 0.001 &&
      top > input.bandTop() &&
      (keepsWholeAt(top) ||
        row.height.rule === 'exact' ||
        !probeRowFragmentProgress(
          row,
          structure.columnWidthsPt,
          input.left(),
          top,
          bottom - closingEdge,
          false,
          0,
          input.rowDeps(),
          input.cursors(),
          structure.cellSpacingPt,
          { requireEveryCell: true }
        ))
    );
  };
  return {
    movesWhole,
    admitsRepeatedHeaders,
    pageHoldsRow,
    keepsWholeAt,
    overflowsBelowRepeat,
    progressesAt,
    startMissesBelowRepeat,
    prepareRepeat,
  };
}
