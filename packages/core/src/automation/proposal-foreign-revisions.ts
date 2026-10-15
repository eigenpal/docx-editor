// Tracked edits beside or inside another author's pending TEXT revision.
//
// The store already writes these as nested revisions: a strike over another author's
// inserted words becomes a deletion inside their insertion, and new words go beside struck
// text, never into it. Each author's decision stays separate, so accepting or rejecting one
// leaves the other pending. Structural, paragraph mark, formatting, and move revisions keep
// refusing, and so does a strike that would cover nothing but already struck text.
import { findNode } from '../store/package/ooxml-edit.ts';
import type { ReviewRevisionItem } from '../store/store/review-items.ts';
import { trackedInsertionLanding } from '../store/store/tree-op-tracked-adjacency.ts';
import type { AutomationStoryReads } from './reads.ts';

interface Span {
  readonly start: number;
  readonly end: number;
}

/** The item's ranges clipped to one paragraph, each flagged when it is struck text. */
function rangesIn(
  story: AutomationStoryReads,
  item: ReviewRevisionItem,
  paragraphId: string
): (Span & { readonly struck: boolean })[] {
  const index = story.indexOf(paragraphId);
  const out: (Span & { readonly struck: boolean })[] = [];
  item.ranges.forEach((range, position) => {
    const first = story.indexOf(range.start.paragraphId);
    const last = story.indexOf(range.end.paragraphId);
    if (first < 0 || last < 0 || index < first || index > last) return;
    const struck =
      item.revisionKind === 'delete' ||
      item.revisionKind === 'moveFrom' ||
      (item.revisionKind === 'replace' && position < (item.replacedRangeCount ?? Infinity));
    out.push({
      start: index === first ? range.start.offset : 0,
      end: index === last ? range.end.offset : Infinity,
      struck,
    });
  });
  return out;
}

/** True when part of `[start, end)` is not struck by any pending revision. */
function coversLiveText(
  story: AutomationStoryReads,
  items: readonly ReviewRevisionItem[],
  paragraphId: string,
  start: number,
  end: number
): boolean {
  const struck = items
    .flatMap((item) => rangesIn(story, item, paragraphId).filter((range) => range.struck))
    .sort((a, b) => a.start - b.start);
  let cursor = start;
  for (const range of struck) {
    if (range.start > cursor) break;
    cursor = Math.max(cursor, range.end);
    if (cursor >= end) return false;
  }
  return cursor < end;
}

/**
 * Whether a tracked edit of `[start, end)` may touch or overlap `item`, which belongs to
 * another author.
 *
 * Their inserted text, including the inserted half of a replacement, admits any edit. Their
 * struck text admits an insertion inside or at its edge, which the store places after or
 * beside the deletion, and a strike that also covers live text.
 */
export function admitsForeignTextRevision(
  story: AutomationStoryReads,
  items: readonly ReviewRevisionItem[],
  item: ReviewRevisionItem,
  paragraphId: string,
  start: number,
  end: number
): boolean {
  if (item.revisionKind === 'insert') return true;
  if (item.revisionKind !== 'delete' && item.revisionKind !== 'replace') return false;
  const struckContact = rangesIn(story, item, paragraphId).some(
    (range) => range.struck && start <= range.end && end >= range.start
  );
  if (!struckContact || start === end) return true;
  return coversLiveText(story, items, paragraphId, start, end);
}

/**
 * Where tracked words aimed at `aim` land, from the store's own placement rule.
 *
 * `struck` is the range the same transaction strikes, or null for an insertion that strikes
 * nothing. An insertion moves only out of a deletion that strictly contains its aim. A
 * replacement also lands after a deletion its strike joins.
 */
export function trackedLandingOffset(
  story: AutomationStoryReads,
  paragraphId: string,
  struck: Span | null,
  aim: number,
  revision: { readonly author: string; readonly date: string }
): number {
  const paragraph = findNode(story.part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return aim;
  const { past, landing } = trackedInsertionLanding(
    paragraph,
    struck ?? { start: aim, end: aim },
    aim,
    revision.author,
    revision.date
  );
  return struck && struck.end > struck.start ? landing : past;
}
