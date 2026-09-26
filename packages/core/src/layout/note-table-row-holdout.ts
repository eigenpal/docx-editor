// The hold-out for a table row that a footnote reserve moved to the next page.

import { bodyCursorBottomPt } from './note-fragment-geometry.ts';
import { layoutNoteCached } from './note-layout.ts';
import type { HoldOutArgs, HoldOutRef } from './note-reserve-holdout.ts';
import { noteColumnBudgetPt, RESERVE_BOUNDARY_BACKOFF_PT } from './note-reserves.ts';
import {
  rowKeepsWithNext,
  rowOwnsReference,
  stacksInOneColumn,
  tableReferenceRowBand,
} from './note-table-reference-band.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import type { PageRecord, TableFragmentRecord } from './semantic-records.ts';

/**
 * Reserve (pt) `bodyPage` must keep so the table row that opens `nextPage` stays there.
 *
 * The row counterpart of the paragraph hold-out ({@link holdOutReserveNeed}). A reserve
 * evicts a table row whose note cannot fit below it ({@link tableReferenceRowBand}), and the
 * row moves whole. Once it has moved, the source page no longer sees its reference, the
 * note stack alone under-claims, and the next round pulls the row back. When the row
 * cannot return with its notes, the source page claims its remaining slack so the move
 * reproduces itself.
 *
 * Zero, so the row may return, unless every part of that move holds: both pages stack in one
 * column; the source page ends with the same table, whose last row is a body row that does
 * not keep with the next; the next page opens with that table's continuation, and its
 * first body row is whole (not the rest of a split row) and carries a page-bottom
 * reference in a proven row band. Rows ahead of the reference row return on their own, so
 * a later reference row holds nothing. A note the eviction guard would split anyway (taller
 * than the note column minus the header rows and the row above its reference) does not
 * count. The row returns when it fits whole with its notes below the source page's body.
 */
export function tableRowHoldOutNeed(
  args: HoldOutArgs,
  bodyPage: PageRecord,
  nextPage: PageRecord,
  table: TableFragmentRecord,
  candidates: readonly HoldOutRef[]
): number {
  if (table.fragmentIndex === 0) return 0;
  if (!stacksInOneColumn(bodyPage) || !stacksInOneColumn(nextPage)) return 0;
  const tail = lastInFlowFragment(bodyPage);
  if (tail?.kind !== 'table' || tail.tableId !== table.tableId) return 0;
  const above = tail.rows[tail.rows.length - 1];
  if (!above || above.isHeaderRepeat || above.isHeaderRow || rowKeepsWithNext(above)) return 0;
  const row = table.rows.find((candidate) => !candidate.isHeaderRepeat);
  if (!row || row.isContinuation) return 0;
  const pulled = candidates.filter((ref) => rowOwnsReference(row, ref));
  if (pulled.length === 0) return 0;

  const contentHeight = bodyPage.contentBox.height;
  const columnBudget = noteColumnBudgetPt(contentHeight, args.plainSeparatorHeight);
  let pulledNotesHeight = 0;
  for (const ref of pulled) {
    const band = tableReferenceRowBand(nextPage, table, ref);
    if (band === null || band === 'table' || band.row !== row) return 0;
    const laid = layoutNoteCached(
      args.footnotesPart,
      ref.noteId,
      bodyPage.contentBox.width,
      args.opts,
      args.noteLayoutCache
    );
    if (!laid) continue;
    if (laid.flowHeight > columnBudget - (band.bottom - band.blockTop) + 0.001) continue;
    pulledNotesHeight += laid.flowHeight;
  }
  if (pulledNotesHeight <= 0) return 0;

  const area =
    (args.existingAreaHeight > 0 ? args.existingAreaHeight : args.plainSeparatorHeight) +
    pulledNotesHeight;
  const bodyBottom = bodyCursorBottomPt(bodyPage);
  if (bodyBottom + row.box.height + area <= contentHeight + 0.001) return 0;
  // Backed off like the eviction reserve, so the body budget lands inside the row.
  return Math.max(0, contentHeight - bodyBottom - RESERVE_BOUNDARY_BACKOFF_PT);
}

function lastInFlowFragment(page: PageRecord): PageRecord['fragments'][number] | undefined {
  for (let index = page.fragments.length - 1; index >= 0; index -= 1) {
    const fragment = page.fragments[index]!;
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    return fragment;
  }
  return undefined;
}
