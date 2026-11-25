// The floor of a table row that none of its cells has raised.
//
// Detached vertical-merge heads, continuations (`w:vMerge`, `CT_VMerge`, ECMA-376 Part 1,
// 17.4.84), and `btLr` cells that wait for the row height do not size their row. When only
// such cells hold a row, something else must.

import type { SemanticTableCell } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { mergedRowFirstCellHeight } from './table-cell-end-mark.ts';
import { cellHidesEndMark } from './table-cell-terminator.ts';
import { authoredRowMinimumFloorPt, type RowMinimumInsetMap } from './table-row-minimum-insets.ts';

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
  /** True for a `btLr` cell that takes its line length from the row height. */
  readonly waits: (cell: SemanticTableCell) => boolean;
  readonly atLeastHeightPt: number | undefined;
  readonly rowGapPt: number;
  readonly defaultLineHeight: number;
  readonly minimumInsets: RowMinimumInsetMap | undefined;
  readonly deps: TableFlowDeps;
}

/**
 * The height of a row that nothing raised, from its top, or 0 for none.
 *
 * A row that only merge heads, continuations, and waiting `btLr` cells hold, with at least one
 * head, takes its first cell's end paragraph ({@link mergedRowFirstCellHeight}), padded with
 * the row-local clearance as an authored minimum is. An `atLeast` `w:trHeight` (`CT_Height`,
 * 17.4.80; `ST_HeightRule`, 17.18.37) applied later can raise it, never lower it. With a
 * waiting `btLr` cell beside the head, a measured row took the head's end line when it had no
 * height, and its 5pt `atLeast` minimum, not that line, when it had one. So there the minimum
 * alone sizes the row.
 *
 * Any other row that nothing raised keeps one line of the default run style in each cell
 * whose mark shows.
 */
export function unsizedRowFloorPt(input: UnsizedRowInput): number {
  const { flowed, deps } = input;
  let head = false;
  let waiting = false;
  let other = false;
  for (const { cell } of flowed) {
    if (cell.vMergeContinue) continue;
    if (input.detached(cell)) head = true;
    else if (input.waits(cell)) waiting = true;
    else other = true;
  }
  const first = flowed[0];
  if (head && !other && first !== undefined) {
    if (waiting && (input.atLeastHeightPt ?? 0) > 0) return 0;
    const { left, right } = first.insets;
    const markPt = mergedRowFirstCellHeight(first.cell, first.width - left - right, deps);
    if (markPt <= 0) return 0;
    return authoredRowMinimumFloorPt(markPt, flowed, input.minimumInsets, input.rowGapPt);
  }
  const hides = (cell: SemanticTableCell) => cellHidesEndMark(cell, deps.documentFirstParagraphId);
  if (!flowed.some((entry) => !entry.cell.vMergeContinue && !hides(entry.cell))) return 0;
  let line = 0;
  for (const entry of flowed) {
    if (hides(entry.cell)) continue;
    line = Math.max(line, entry.insets.top + input.defaultLineHeight + entry.insets.bottom);
  }
  return line;
}
