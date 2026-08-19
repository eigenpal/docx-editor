// The per-paragraph line index and the deleted-range projection derived from it.
//
// Extracted from semantic-interaction.ts, which owns the caret stops, hit regions and
// navigation built ON these: everything here is a pure read of one immutable layout,
// memoized per revision, with no knowledge of stops or selections.

import { lineSegments } from './line-segments.ts';
import type { LineRecord, SemanticLayout } from './semantic-records.ts';
import { paragraphFragmentsOf } from './semantic-records.ts';
import type { SemanticPosition } from './semantic-interaction.ts';

/**
 * Lines grouped by the paragraph they render, with the page each sits on.
 *
 * Memoized PER LAYOUT — a published layout is immutable, so the grouping is computed once
 * per revision instead of once per read. The reads this serves — caret geometry, span
 * lookup for a selection, text reconstruction — are all "the lines of ONE paragraph", and
 * answering them by scanning every line of every page made each one O(document); the
 * toolbar asks after every commit, so the scans multiplied per keystroke.
 */
export interface PlacedLine {
  readonly line: LineRecord;
  readonly pageIndex: number;
}

const paragraphLinesCache = new WeakMap<SemanticLayout, Map<string, PlacedLine[]>>();

export function paragraphLinesIndex(layout: SemanticLayout): Map<string, PlacedLine[]> {
  const cached = paragraphLinesCache.get(layout);
  if (cached) return cached;
  const index = new Map<string, PlacedLine[]>();
  /**
   * Under every paragraph the line carries, not just the one it names.
   *
   * A merged line belongs to two paragraphs, and a caret walking either of them has to find
   * it. An ordinary line has one segment and lands in exactly the one bucket it always did.
   */
  const indexLine = (line: LineRecord, pageIndex: number): void => {
    for (const segment of lineSegments(line)) {
      const placed = { line, pageIndex };
      const entry = index.get(segment.paragraphId);
      if (entry) entry.push(placed);
      else index.set(segment.paragraphId, [placed]);
    }
  };
  const indexFragments = (
    fragments: readonly import('./semantic-records.ts').BlockFragmentRecord[],
    pageIndex: number
  ): void => {
    const visit = (
      blocks: readonly import('./semantic-records.ts').BlockFragmentRecord[]
    ): void => {
      for (const block of blocks) {
        if (block.kind === 'paragraph') {
          for (const line of block.lines) indexLine(line, pageIndex);
          continue;
        }
        for (const row of block.rows) {
          if (row.isHeaderRepeat) continue;
          for (const cell of row.cells) visit(cell.blocks);
        }
      }
    };
    visit(fragments);
  };
  for (const page of layout.pages) {
    // Body first — primary story for caret stops built elsewhere via paragraphFragmentsOf.
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) indexLine(line, page.index);
    }
    // Furniture paragraphs share this index so formatting / paragraphTextFromLayout can
    // resolve an open header/footer selection. documentOrder and caretStops stay body-only.
    if (page.header) indexFragments(page.header.fragments, page.index);
    if (page.footer) indexFragments(page.footer.fragments, page.index);
    // Note stories (footnotes/endnotes) — same formatting lane as furniture; not body order.
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) indexFragments(note.fragments, page.index);
    }
  }
  paragraphLinesCache.set(layout, index);
  return index;
}

/**
 * A paragraph's deleted model ranges, coalesced across every line that carries them.
 *
 * `LineRecord.deletedRanges` is CLIPPED to each line, so a deletion that wraps publishes one
 * slice per line and every wrap boundary looks like a range edge. Read per line, those false
 * edges became caret stops in the middle of struck text — navigable, and worse, typable:
 * a keystroke there landed inside the `w:del`. Merging adjacent and overlapping slices
 * restores the deletion's true extent, so only its real boundaries survive as caret targets.
 *
 * Memoized per layout: a published layout is immutable, and the stop builder asks once per
 * line of the paragraph.
 */
const paragraphDeletedRangesCache = new WeakMap<
  SemanticLayout,
  Map<string, readonly { start: number; end: number }[]>
>();

export function paragraphDeletedRanges(
  layout: SemanticLayout,
  paragraphId: string
): readonly { start: number; end: number }[] {
  let byParagraph = paragraphDeletedRangesCache.get(layout);
  if (!byParagraph) {
    byParagraph = new Map();
    paragraphDeletedRangesCache.set(layout, byParagraph);
  }
  const cached = byParagraph.get(paragraphId);
  if (cached) return cached;
  const collected: { start: number; end: number }[] = [];
  for (const { line } of paragraphLinesIndex(layout).get(paragraphId) ?? []) {
    // A merged line indexes under both members but expresses `deletedRanges` in the offsets
    // of the paragraph it NAMES (merged-paragraph-ranges.ts); the other member's are dropped.
    if (line.range.paragraphId !== paragraphId) continue;
    for (const range of line.deletedRanges ?? []) {
      collected.push({ start: range.start, end: range.end });
    }
  }
  collected.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of collected) {
    const last = merged[merged.length - 1];
    // `<=` merges the wrap slices AND identical copies — a shared header/footer part paints
    // its lines once per page, so the same slice arrives once per sheet.
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  byParagraph.set(paragraphId, merged);
  return merged;
}

/**
 * True when this offset sits strictly INSIDE deleted content.
 *
 * The boundaries are kept: the position immediately before a deletion and the one immediately
 * after it are both real places to put a caret, and dropping them would make the deletion
 * unreachable — including for the accept or reject that resolves it.
 */
export function insideDeletedContent(
  ranges: readonly { start: number; end: number }[],
  offset: number
): boolean {
  for (const range of ranges) {
    if (offset > range.start && offset < range.end) return true;
  }
  return false;
}

/**
 * A word-boundary target that landed inside deleted content resolves to the region's edge in
 * the direction of travel — the same "step over, never into" answer the stop list gives a
 * plain arrow. Left as-is, the word walk handed back an interior offset and the surface's
 * collapsed-caret snap bounced it straight back to where it started: a permanently dead key.
 */
export function skipDeletedRegion(
  ranges: readonly { start: number; end: number }[],
  offset: number,
  direction: -1 | 1
): number {
  for (const range of ranges) {
    if (offset > range.start && offset < range.end) {
      return direction === 1 ? range.end : range.start;
    }
  }
  return offset;
}

/**
 * Where a collapsed caret may actually rest: never strictly inside deleted content.
 *
 * A gesture can resolve to such an offset — the browser reports the struck character a click
 * landed on — but no caret stop owns it. A caret adopted there is a dead one: every arrow
 * asks the stop list where it is and gets no answer, and an edit committed there writes
 * characters INSIDE the deletion, text that exists in neither the original nor the proposal.
 * Snapped to the START of the deleted region, which is a real stop, and which
 * keeps a click anywhere on struck text activating the deletion's own review card (a range
 * grips its start boundary as firmly as its interior — see review-support's `rangeGrip`).
 *
 * RANGE endpoints are not this function's business: a drag may legitimately cover deleted
 * text, so callers snap only collapsed selections.
 */
export function snapCaretOutOfDeletion(
  layout: SemanticLayout,
  position: SemanticPosition
): SemanticPosition {
  for (const range of paragraphDeletedRanges(layout, position.paragraphId)) {
    if (position.offset > range.start && position.offset < range.end) {
      return { paragraphId: position.paragraphId, offset: range.start };
    }
  }
  return position;
}
