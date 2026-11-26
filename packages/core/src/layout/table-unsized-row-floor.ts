// The floor of a table row that its merged cells hold.
//
// Detached vertical-merge heads, continuations (`w:vMerge`, `CT_VMerge`, ECMA-376 Part 1,
// 17.4.84), and `btLr` cells (`w:textDirection`, `CT_TextDirection`, 17.4.72) that wait for
// the row height do not size their row. When only such cells hold a row, something else must.

import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { mergedRowFirstCellHeight } from './table-cell-end-mark.ts';
import { cellHidesEndMark } from './table-cell-terminator.ts';
import { waitsForRowHeight } from './table-cell-text-direction.ts';
import { authoredRowMinimumFloorPt, type RowMinimumInsetMap } from './table-row-minimum-insets.ts';

/**
 * A `restart` cell that no row below continues: a merge of one row. Its content flows in its
 * own row, but the row takes the first-cell floor as a row of merge heads does
 * ({@link unsizedRowFloorPt}).
 */
export function isLoneMergeRestart(cell: SemanticTableCell): boolean {
  return cell.restartsVerticalMerge === true && !cell.headsVerticalMerge && !cell.vMergeContinue;
}

/**
 * Whether a lone restart can floor its row above the row's own content: only merge restarts,
 * continuations, and waiting `btLr` cells hold the row, and one restart is lone. A row with
 * an ordinary cell keeps the ordinary rules.
 */
export function loneRestartFloorsRow(row: SemanticTableRow): boolean {
  return (
    row.cells.some(isLoneMergeRestart) &&
    row.cells.every(
      (cell) =>
        cell.vMergeContinue ||
        cell.restartsVerticalMerge === true ||
        cell.headsVerticalMerge === true ||
        waitsForRowHeight(cell)
    )
  );
}

/** How row placement reserves end-of-cell boxes for a row before its cells flow. */
export interface MergedRowSizing {
  /** Continuations and waiting `btLr` cells reserve an end-of-cell box. */
  readonly reservesMarks: boolean;
  /** Each reserved box is the FIRST cell's box (`cellReservedMarkHeights`). */
  readonly firstCellBox: boolean;
  /** The floor can stand above the row's own content, so it applies to a raised row too. */
  readonly floorsContent: boolean;
}

/**
 * The sizing of a row that only continuations and waiting `btLr` cells hold, or that holds a
 * lone `restart` cell.
 *
 * A row of continuations takes its first cell's end-of-cell box, and so does a row of
 * continuations and waiting `btLr` cells, whichever comes first. Every cell needs an end
 * paragraph for that: a cell with none (a head that a merged-text carry emptied, or an
 * invalid empty `w:tc`) keeps the row on the largest box of its cells. With a waiting `btLr`
 * cell and an `atLeast` `w:trHeight` (`CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37), the
 * minimum alone sizes the row, as beside a merge head ({@link unsizedRowFloorPt}).
 */
export function mergedRowSizing(
  row: SemanticTableRow,
  markSizedRow: boolean,
  atLeastHeightPt: number | undefined
): MergedRowSizing {
  const firstCellBox =
    markSizedRow &&
    row.cells.some((cell) => cell.vMergeContinue) &&
    row.cells.every((cell) => cell.blocks.length > 0);
  const minimumAlone =
    firstCellBox && (atLeastHeightPt ?? 0) > 0 && row.cells.some(waitsForRowHeight);
  return {
    reservesMarks: markSizedRow && !minimumAlone,
    firstCellBox: firstCellBox && !minimumAlone,
    floorsContent: loneRestartFloorsRow(row),
  };
}

/** What {@link unsizedRowFloorPt} needs of a row whose cells have laid out. */
export interface UnsizedRowInput {
  readonly flowed: readonly {
    readonly cell: SemanticTableCell;
    readonly width: number;
    readonly insets: {
      readonly top: number;
      readonly right: number;
      readonly bottom: number;
      readonly left: number;
    };
  }[];
  /** True for a head whose content this row does not size: its merge spans later rows. */
  readonly detached: (cell: SemanticTableCell) => boolean;
  /** True when the row's content already raised it: only the first-cell floor can apply. */
  readonly raised: boolean;
  /** True for a `btLr` cell that takes its line length from the row height. */
  readonly waits: (cell: SemanticTableCell) => boolean;
  readonly atLeastHeightPt: number | undefined;
  readonly rowGapPt: number;
  readonly defaultLineHeight: number;
  readonly minimumInsets: RowMinimumInsetMap | undefined;
  readonly deps: TableFlowDeps;
}

/**
 * The height of a row that its merged cells hold, from its top, or 0 for none.
 *
 * A row that only merge heads, continuations, and waiting `btLr` cells hold, with at least one
 * head or continuation, takes its first cell's end paragraph ({@link mergedRowFirstCellHeight}),
 * padded with the row-local clearance as an authored minimum is. A lone `restart` cell
 * ({@link isLoneMergeRestart}) counts as a head: measured beside a detached head, before it,
 * and with another lone restart, the row took the first cell's floor, also above the lone
 * cell's own shorter text. An ordinary cell in the same place left the row to the other
 * rules. An `atLeast` `w:trHeight` applied later can raise the floor, never lower it.
 *
 * With a waiting `btLr` cell in the row, a measured row took the first cell's floor when it
 * had no height, and its 5pt `atLeast` minimum, not that floor, when it had one. So there the
 * minimum alone sizes the row.
 *
 * Any other row that nothing raised keeps one line of the default run style in each cell
 * whose mark shows.
 */
export function unsizedRowFloorPt(input: UnsizedRowInput): number {
  const { flowed, deps } = input;
  let head = false;
  let continuation = false;
  let waiting = false;
  let other = false;
  for (const { cell } of flowed) {
    if (cell.vMergeContinue) continuation = true;
    else if (input.detached(cell) || isLoneMergeRestart(cell)) head = true;
    else if (input.waits(cell)) waiting = true;
    else other = true;
  }
  const first = flowed[0];
  // Without a head, every cell needs an end paragraph (`mergedRowSizing`).
  const merged = head || (continuation && flowed.every((entry) => entry.cell.blocks.length > 0));
  if (merged && !other && first !== undefined) {
    if (waiting && (input.atLeastHeightPt ?? 0) > 0) return 0;
    const { left, right } = first.insets;
    const markPt = mergedRowFirstCellHeight(first.cell, first.width - left - right, deps);
    if (markPt <= 0) return 0;
    return authoredRowMinimumFloorPt(markPt, flowed, input.minimumInsets, input.rowGapPt);
  }
  // The default line is for a row that nothing raised; it never re-floors content.
  if (input.raised) return 0;
  const hides = (cell: SemanticTableCell) => cellHidesEndMark(cell, deps.documentFirstParagraphId);
  if (!flowed.some((entry) => !entry.cell.vMergeContinue && !hides(entry.cell))) return 0;
  let line = 0;
  for (const entry of flowed) {
    if (hides(entry.cell)) continue;
    line = Math.max(line, entry.insets.top + input.defaultLineHeight + entry.insets.bottom);
  }
  return line;
}
