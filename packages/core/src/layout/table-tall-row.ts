// A table row and the footnote reserve of the page it is offered.
//
// A row that cannot split and is taller than the page band:
//
// Before mode 15 such a row stays whole on a fresh page and runs past the bottom margin
// (`tallRowStaysWhole`). It does not start on a page that a footnote continued from an earlier
// page reaches: that page keeps only the continued note and any content placed before the row,
// and the row starts on the next page. The notes pass marks such a page with a footnote reserve
// (`overRowAreaPt` in `note-overflow-row.ts`), so the row yields to any reserve at the top of
// its band.

import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { bottomToTopTextKeepsRowWhole } from './table-cell-text-direction.ts';
import { cellContentInsets } from './table-cell-geometry.ts';

/** What decides whether a tall row stays whole where it is offered. */
export interface TallRowPlacement {
  /** The mode keeps a tall row whole (`tallRowStaysWhole`). */
  readonly staysWholeRule: boolean;
  /** The table breaks across pages at all. */
  readonly breaksPages: boolean;
  /** A pinned break decides where the row splits. */
  readonly pinnedBreak: boolean;
  /** The row is part of a vertical merge. */
  readonly merged: boolean;
  /** Top of the band the row is offered, below any repeated header rows. */
  readonly bandTop: number;
  /** Wrapping objects on the page. */
  readonly exclusionZones: number;
}

/** Whether a row taller than the page stays whole on its page and runs past the margin. */
export function staysWholeAt(row: SemanticTableRow, at: TallRowPlacement): boolean {
  return (
    at.staysWholeRule &&
    at.breaksPages &&
    !at.pinnedBreak &&
    !at.merged &&
    at.bandTop === 0 &&
    at.exclusionZones === 0 &&
    row.cells.every((cell) => cell.blocks.every((block) => block.kind === 'paragraph'))
  );
}

/**
 * Pages one row may leave to continued footnotes before it stays where it is. A continuation
 * takes at least one page each time, so a real note never reaches it; the bound keeps a reserve
 * that the notes pass leaves in place from moving the row for ever.
 */
const MAX_NOTE_CONTINUATION_YIELDS = 64;

/**
 * Whether a whole tall row at the top of its band leaves the page to a footnote continued from
 * an earlier page. The row's own notes never reserve room on its page, so any reserve there
 * belongs to a continuation.
 */
export function yieldsToNoteContinuation(
  belowBandTop: number,
  reservedBand: number,
  fullBand: number,
  yieldsSoFar: number
): boolean {
  return (
    yieldsSoFar < MAX_NOTE_CONTINUATION_YIELDS &&
    belowBandTop <= 0.001 &&
    reservedBand < fullBand - 0.001
  );
}

/**
 * Whether a footnote reserve leaves the page at the top of the table less than one line of
 * body room. A splittable row is not rejected only because that empty reserved band was its
 * first offer: it moves once to the next page and tries again under that page's band.
 */
export function noteReserveLeavesNoLine(
  cursorY: number,
  reservedBand: number,
  fullBand: number
): boolean {
  return cursorY <= 0.001 && fullBand > reservedBand + 0.001;
}

/**
 * Whether a row moves whole to a page that can hold it: `w:cantSplit`, or `btLr` text, which
 * takes its line length from the whole row, when its authored minimum does not fit `room`
 * (`bottomToTopTextKeepsRowWhole`).
 */
export function rowKeepsWholeAt(
  row: SemanticTableRow,
  room: number,
  structure: SemanticTableStructure,
  deps: TableFlowDeps
): boolean {
  return (
    row.cantSplit ||
    bottomToTopTextKeepsRowWhole(
      row,
      room,
      (cell) =>
        deps.cellContentInsets?.get(cell.id) ??
        cellContentInsets(cell, structure.cellSpacingPt === 0),
      deps.cellMinimumContentInsets
    )
  );
}
