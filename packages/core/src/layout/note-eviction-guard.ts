// The keep-whole eviction guard of the footnote reserve pass: when a note that does not fit
// below its reference moves the reference forward instead of splitting.

import type { NoteReferenceLineBand } from './note-fragment-geometry.ts';
import type { NoteStoryLayout } from './note-layout.ts';
import { MIN_FOOTNOTE_BODY_BAND_PT } from './note-reserves.ts';
import { splitNoteFragments } from './note-splitting.ts';
import { rowContinuesOn } from './note-table-reference-band.ts';
import type { PageRecord } from './semantic-records.ts';

/**
 * Note lines a split head must place below a reference for the reference to stay while its
 * note continues. With fewer, the reference moves to the next page with its note. Applies
 * to table rows and to the second line of an opening orphan pair.
 */
export const SPLIT_NOTE_MIN_LINES = 2;

/** {@link SPLIT_NOTE_MIN_LINES} for a table row reference. */
export const TABLE_ROW_SPLIT_NOTE_MIN_LINES = SPLIT_NOTE_MIN_LINES;

export interface EvictionGuardContext {
  /** The reserve pass's carry-independent note column ({@link noteColumnBudgetPt}). */
  readonly keepWholeBudget: number;
  /** Top of the page's topmost body content ({@link firstBodyContentTopPt}). */
  readonly firstContentTop: number;
  /** The whole note column below the separator, for the split's retreat rule. */
  readonly fullNoteColumn: number;
  readonly evictionAllowed?: boolean;
  readonly allowOrphanDeferral?: boolean;
  /** The page after this one, which shows whether a row ending this page continues there. */
  readonly nextPage?: PageRecord;
}

/**
 * Whether the reserve must reach `band.top` so the reference moves to the next page with
 * its whole note, instead of the note splitting below the reference.
 *
 * A note that cannot fit whole below its reference line, but could fit below it on the
 * NEXT page, does not split. The reference's LINE moves to the next page instead, so the
 * reserve must reach the line's TOP. The next reflow pass finds the reference there and
 * lays the note whole beside it. Splitting remains for the shapes the move cannot help:
 * - a note that does not fit the destination either, measured with the line's own BLOCK
 *   opening the next page (`band.bottom - band.blockTop` of content above the line),
 *   because a `w:keepLines` paragraph moves whole and a fixed column budget would re-evict
 *   there every round, minting a chain of near-blank pages;
 * - a reference in the page's TOPMOST body line, where pushing only re-creates the same
 *   shape (a section-opening paragraph keeps its `w:spacing w:before` at page top, so a
 *   fixed band threshold would re-fire there);
 * - a line inside the minimum body band, whose eviction reserve the
 *   {@link MIN_FOOTNOTE_BODY_BAND_PT} cap would clip into not evicting at all;
 * - a table row that ends the page and continues on the next one: moving that split head
 *   moves the whole row, and at its destination the rest of the row fills the band again;
 * - a table row reference whose note would place at least
 *   {@link TABLE_ROW_SPLIT_NOTE_MIN_LINES} lines below it: the row stays and the note
 *   continues on the next page;
 * - in the orphan-pair phase, a reference on the second line of an opening pair whose note
 *   would place at least {@link SPLIT_NOTE_MIN_LINES} lines below it: the pair stays and the
 *   note continues. With fewer lines the pair moves with its note, so no note starts on a
 *   later page than its reference.
 * Multi-column sections are a known approximation: an eviction for a column-1 reference
 * also shortens column 2; refs above the eviction point still reserve, and the loop
 * otherwise degrades to the envelope/exhaustion exit.
 */
export function evictsReferenceLine(
  band: NoteReferenceLineBand,
  laid: NoteStoryLayout,
  room: number,
  context: EvictionGuardContext
): boolean {
  return (
    band.evictable &&
    context.evictionAllowed !== false &&
    !(
      context.allowOrphanDeferral &&
      band.preserveOrphanLine &&
      splitNoteHead(laid, room, context.fullNoteColumn).lines >= SPLIT_NOTE_MIN_LINES
    ) &&
    laid.flowHeight > room + 0.001 &&
    laid.flowHeight <= context.keepWholeBudget - (band.bottom - band.blockTop) + 0.001 &&
    band.top > context.firstContentTop + 0.001 &&
    band.top >= MIN_FOOTNOTE_BODY_BAND_PT &&
    !(band.endsPageRowId !== undefined && rowContinuesOn(context.nextPage, band.endsPageRowId)) &&
    !(band.tableRow === true && splitNoteKeepsTableRow(laid, room, context.fullNoteColumn))
  );
}

/**
 * Whether splitting `laid` into `room` leaves at least
 * {@link TABLE_ROW_SPLIT_NOTE_MIN_LINES} note lines on the reference page. The split itself
 * decides, so a note paragraph's widow control counts exactly as the attach pass applies it.
 */
export function splitNoteKeepsTableRow(
  laid: NoteStoryLayout,
  room: number,
  fullNoteColumn: number
): boolean {
  return splitNoteHead(laid, room, fullNoteColumn).lines >= TABLE_ROW_SPLIT_NOTE_MIN_LINES;
}

/** Lines and height of the head a split of `laid` into `room` places. */
export function splitNoteHead(
  laid: NoteStoryLayout,
  room: number,
  fullNoteColumn: number
): { readonly lines: number; readonly height: number } {
  const split = splitNoteFragments(laid, Math.max(0, room), { fullContentHeight: fullNoteColumn });
  let lines = 0;
  for (const block of split.head) lines += block.kind === 'paragraph' ? block.lines.length : 1;
  return { lines, height: split.headHeight };
}
