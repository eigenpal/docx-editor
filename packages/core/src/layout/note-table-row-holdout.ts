// The hold-out for a table row that a footnote reserve moved to the next page.

import { bodyCursorBottomPt } from './note-fragment-geometry.ts';
import { layoutNoteCached } from './note-layout.ts';
import type { HoldOutArgs, HoldOutRef } from './note-reserve-holdout.ts';
import {
  HELD_RESERVE_TOLERANCE_PT,
  noteColumnBudgetPt,
  RESERVE_BOUNDARY_BACKOFF_PT,
} from './note-reserves.ts';
import { splitNoteHead, TABLE_ROW_SPLIT_NOTE_MIN_LINES } from './note-eviction-guard.ts';
import {
  rowKeepsWithNext,
  rowOwnsReference,
  stacksInOneColumn,
  tableReferenceRowBand,
  type TableReferenceRowBand,
} from './note-table-reference-band.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import type { PageRecord, TableFragmentRecord } from './semantic-records.ts';

/**
 * Reserve (pt) `bodyPage` must keep so the table row that opens `nextPage` stays there.
 *
 * The row counterpart of the paragraph hold-out ({@link holdOutReserveNeed}). A row moves
 * whole to the next page in two ways: the reserve evicts it because its note would place
 * fewer than two lines below the reference ({@link evictsReferenceLine}), or its note fits
 * whole below the reference line and the row cannot continue below that line (`w:cantSplit`,
 * an exact height), so the body pass moves it with its note. Once it has moved, the source
 * page no longer sees its reference, the note stack alone under-claims, and the next round
 * pulls the row back. When the row cannot return with its notes, the source page claims its
 * remaining slack so the move reproduces itself.
 *
 * Zero, so the row may return, unless every part of that move holds: both pages stack in one
 * column; the source page ends with the same table, whose last row is a body row that does
 * not keep with the next; the next page opens with that table's continuation, and its
 * first body row is whole (not the rest of a split row) and carries a page-bottom
 * reference in a proven row band. Rows ahead of the reference row return on their own, so
 * a later reference row holds nothing. A slack that cannot seat the row down to its first
 * reference line needs no reserve to keep the row out. A note the eviction guard would
 * split anyway (taller than the note column minus the header rows and the row above its
 * reference) does not count.
 *
 * The return replays the eviction guard with the row below the source page's body. A row
 * that can continue below its reference line returns at least down to that line, and it
 * stays unless a note would evict it again. A row that places whole returns only when it
 * fits beside the source page's notes, and it stays only when its own notes fit too. The
 * fragments cannot tell the two kinds apart, so where the answers differ the body pass's
 * answer decides, as in the paragraph hold-out: a source page that was offered room down
 * to the reference line and still ended above the row holds a row that places whole, and
 * a page already held at this value keeps the hold.
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
  const pulled: { readonly ref: HoldOutRef; readonly band: TableReferenceRowBand }[] = [];
  for (const ref of candidates) {
    if (!rowOwnsReference(row, ref)) continue;
    const band = tableReferenceRowBand(nextPage, table, ref);
    if (band === null || band === 'table' || band.row !== row) return 0;
    pulled.push({ ref, band });
  }
  if (pulled.length === 0) return 0;

  const contentHeight = bodyPage.contentBox.height;
  const bodyBottom = bodyCursorBottomPt(bodyPage);
  const slack = contentHeight - bodyBottom;
  // The row's content down to its first reference line: the least of it that can return
  // with a reference. A slack below that needs no reserve to keep the row out, and
  // publishing one for every naturally full page would churn the reserve fingerprints.
  let seat = Number.POSITIVE_INFINITY;
  for (const { band } of pulled) seat = Math.min(seat, band.bottom - row.box.y);
  if (slack < seat - 0.001) return 0;

  const columnBudget = noteColumnBudgetPt(contentHeight, args.plainSeparatorHeight);
  const fullNoteColumn = Math.max(0, contentHeight - args.plainSeparatorHeight);
  const area = args.existingAreaHeight > 0 ? args.existingAreaHeight : args.plainSeparatorHeight;
  let stacked = 0;
  let evicts = false;
  for (const { ref, band } of pulled) {
    const laid = layoutNoteCached(
      args.footnotesPart,
      ref.noteId,
      bodyPage.contentBox.width,
      args.opts,
      args.noteLayoutCache
    );
    if (!laid) continue;
    if (laid.flowHeight > columnBudget - (band.bottom - band.blockTop) + 0.001) continue;
    // The guard's room on return: below the reference line, under the source page's notes.
    const room = Math.max(
      0,
      contentHeight - (bodyBottom + band.bottom - row.box.y) - area - stacked
    );
    if (laid.flowHeight <= room + 0.001) {
      stacked += laid.flowHeight;
      continue;
    }
    const head = splitNoteHead(laid, room, fullNoteColumn);
    if (head.lines < TABLE_ROW_SPLIT_NOTE_MIN_LINES) {
      evicts = true;
      break;
    }
    stacked += head.height;
  }
  if (!evicts && stacked <= 0) return 0;

  // Backed off like the eviction reserve, so the body budget lands inside the row.
  const hold = Math.max(0, slack - RESERVE_BOUNDARY_BACKOFF_PT);
  // A row that returns down to its reference line stays unless a note evicts it again.
  const splitAnswer = evicts ? hold : 0;
  // A row that returns only whole needs room beside the source page's notes first; then
  // it stays unless a note evicts it or its notes push it out again.
  const wholeAnswer =
    bodyBottom + row.box.height + area > contentHeight + 0.001
      ? 0
      : evicts || bodyBottom + row.box.height + area + stacked > contentHeight + 0.001
        ? hold
        : 0;
  if (splitAnswer === wholeAnswer) return splitAnswer;
  const { usedReservePt } = args;
  if (usedReservePt === undefined) return 0;
  if (Math.abs(usedReservePt - hold) <= HELD_RESERVE_TOLERANCE_PT) return hold;
  // Offered room down to the reference line, the body pass still ended above the row: the
  // row places whole.
  const offeredGap = Math.max(0, contentHeight - usedReservePt - bodyBottom);
  return seat <= offeredGap + 0.001 ? wholeAnswer : splitAnswer;
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
