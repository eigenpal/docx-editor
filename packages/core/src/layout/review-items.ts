// The review surface's model: what a sidebar lists, and which item the caret is in.
//
// Derived, never stored. A card that outlived the range it described would point at whatever
// text moved into those offsets, which is the specific failure comment anchors exist to avoid.
//
// Everything a surface needs to position a card comes from LAYOUT RECORDS — the spans already
// carry their revision attribution, and anchors are ranges in the same offset space. Measuring
// painted DOM to find a card's y would put the sidebar a repaint behind the document.

import type { CommentAnchor, CommentRecord, CommentThreadState } from './comment-anchors.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import type { SemanticLayout, StyleSpanRecord } from './semantic-records.ts';
import { paragraphFragmentsOf } from './semantic-records.ts';

/** A position in the document, in the model offset space. */
export interface ReviewPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/** A half-open range the item covers, plus the story it lives in. */
export interface ReviewRange {
  readonly partName: string;
  readonly start: ReviewPosition;
  readonly end: ReviewPosition;
}

/**
 * One card on the review surface.
 *
 * Revisions and comments are one list because they are one queue of decisions for the reader,
 * and because a comment anchored over a revision belongs WITH that revision rather than in a
 * separate column that scrolls independently.
 */
export type ReviewItem =
  | {
      readonly kind: 'revision';
      readonly id: string;
      readonly revision: RevisionAttribution;
      readonly range: ReviewRange;
      /** Text the revision covers, for the card's summary. */
      readonly text: string;
      /** True when the engine cannot accept or reject this kind; the card is read-only. */
      readonly readOnly: boolean;
    }
  | {
      readonly kind: 'comment';
      readonly id: string;
      readonly comment: CommentRecord;
      readonly range: ReviewRange;
      readonly resolved: boolean;
      /** Comment id of the parent in the thread, absent for a top-level comment. */
      readonly parentId?: string;
      /** True when the file gave this comment no usable range. */
      readonly orphaned: boolean;
    };

/**
 * A stable id for one card, used as the active-item key.
 *
 * Prefixed by kind because a comment id and a revision id are both small integers from
 * different spaces, and `4` would otherwise name two different cards.
 */
export function reviewItemId(item: ReviewItem): string {
  return item.kind === 'comment' ? `comment-${item.id}` : `revision-${item.id}`;
}

function positionBefore(
  a: ReviewPosition,
  b: ReviewPosition,
  order: ReadonlyMap<string, number>
): boolean {
  const pa = order.get(a.paragraphId) ?? Number.MAX_SAFE_INTEGER;
  const pb = order.get(b.paragraphId) ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa < pb;
  return a.offset < b.offset;
}

/** Paragraph node id → document position, so items sort the way a reader reads them. */
export function paragraphOrderOf(layout: SemanticLayout): Map<string, number> {
  const order = new Map<string, number>();
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      if (!order.has(fragment.paragraphId)) order.set(fragment.paragraphId, order.size);
    }
  }
  return order;
}

/**
 * Revision cards derived from the laid-out spans.
 *
 * Adjacent spans carrying the same revision coalesce into one card: a revision is one decision,
 * and one card per word-broken span would list a sentence-long insertion a dozen times.
 *
 * Only the INNERMOST attribution names the card. An insertion inside a deletion is the inner
 * author's pending decision; the outer deletion gets its own card from its own spans.
 */
export function revisionItemsOf(
  layout: SemanticLayout,
  partName: string,
  isReadOnly: (revision: RevisionAttribution) => boolean = () => false
): ReviewItem[] {
  const items: ReviewItem[] = [];
  let current: { revision: RevisionAttribution; range: ReviewRange; text: string } | null = null;

  const flush = (): void => {
    if (!current) return;
    items.push({
      kind: 'revision',
      id: `${current.revision.kind}-${current.revision.id}-${current.revision.author}-${current.revision.date ?? ''}`,
      revision: current.revision,
      range: current.range,
      text: current.text,
      readOnly: isReadOnly(current.revision),
    });
    current = null;
  };

  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        for (const span of line.spans) {
          const attribution = innermostOf(span);
          if (attribution === null) {
            flush();
            continue;
          }
          if (current && sameAttribution(current.revision, attribution)) {
            current = {
              revision: current.revision,
              range: {
                partName,
                start: current.range.start,
                end: { paragraphId: span.range.paragraphId, offset: span.range.end },
              },
              text: current.text + span.text,
            };
            continue;
          }
          flush();
          current = {
            revision: attribution,
            range: {
              partName,
              start: { paragraphId: span.range.paragraphId, offset: span.range.start },
              end: { paragraphId: span.range.paragraphId, offset: span.range.end },
            },
            text: span.text,
          };
        }
      }
    }
  }
  flush();
  return items;
}

function innermostOf(span: StyleSpanRecord): RevisionAttribution | null {
  const revisions = span.revisions;
  if (revisions === undefined || revisions.length === 0) return null;
  return revisions[revisions.length - 1] ?? null;
}

function sameAttribution(a: RevisionAttribution, b: RevisionAttribution): boolean {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.author === b.author &&
    (a.date ?? null) === (b.date ?? null)
  );
}

/** Comment cards, threaded where the file says so and flat where it does not. */
export function commentItemsOf(
  comments: readonly CommentRecord[],
  anchors: readonly CommentAnchor[],
  threadState: ReadonlyMap<string, CommentThreadState>
): ReviewItem[] {
  const anchorById = new Map(anchors.map((anchor) => [anchor.commentId, anchor]));
  const commentByParaId = new Map<string, CommentRecord>();
  for (const comment of comments) {
    if (comment.paraId !== undefined) commentByParaId.set(comment.paraId.toUpperCase(), comment);
  }

  const items: ReviewItem[] = [];
  for (const comment of comments) {
    const anchor = anchorById.get(comment.id);
    const state = comment.paraId ? threadState.get(comment.paraId.toUpperCase()) : undefined;
    const parent =
      state?.parentParaId !== undefined ? commentByParaId.get(state.parentParaId) : undefined;
    // A comment with no range markers at all is listed and marked orphaned rather than hidden.
    const range: ReviewRange = anchor
      ? { partName: anchor.partName, start: anchor.start, end: anchor.end }
      : {
          partName: '',
          start: { paragraphId: '', offset: 0 },
          end: { paragraphId: '', offset: 0 },
        };
    items.push({
      kind: 'comment',
      id: comment.id,
      comment,
      range,
      resolved: state?.done ?? false,
      ...(parent === undefined ? {} : { parentId: parent.id }),
      orphaned: anchor === undefined || anchor.orphaned,
    });
  }
  return items;
}

/** Order a mixed list the way a reader meets it: by document position, then by kind. */
export function sortReviewItems(
  items: readonly ReviewItem[],
  order: ReadonlyMap<string, number>
): ReviewItem[] {
  return [...items].sort((a, b) => {
    if (positionBefore(a.range.start, b.range.start, order)) return -1;
    if (positionBefore(b.range.start, a.range.start, order)) return 1;
    return 0;
  });
}

/** How wide the range an item covers is, so nesting can prefer the tighter one. */
function spanOf(item: ReviewItem, order: ReadonlyMap<string, number>): number {
  const startParagraph = order.get(item.range.start.paragraphId) ?? 0;
  const endParagraph = order.get(item.range.end.paragraphId) ?? startParagraph;
  if (startParagraph !== endParagraph) return Number.MAX_SAFE_INTEGER;
  return item.range.end.offset - item.range.start.offset;
}

/**
 * Whether a position falls inside an item's range, counting BOTH boundaries.
 *
 * The caret is a position between characters, so a caret resting at the end of a commented
 * range is visually on that range's last character and must activate it. Requiring the caret
 * to be strictly inside makes the last character of every comment feel dead.
 */
function covers(
  item: ReviewItem,
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): boolean {
  const target = order.get(position.paragraphId);
  const start = order.get(item.range.start.paragraphId);
  const end = order.get(item.range.end.paragraphId);
  if (target === undefined || start === undefined || end === undefined) return false;
  if (target < start || target > end) return false;
  if (target === start && position.offset < item.range.start.offset) return false;
  if (target === end && position.offset > item.range.end.offset) return false;
  return true;
}

/**
 * The item the caret is in, or null.
 *
 * Rules, in order:
 *
 *  1. A RESOLVED comment never activates. A reviewer typing near a settled thread should not
 *     reopen it, and a resolved card claiming the caret would hide the live one underneath.
 *  2. The INNERMOST range wins when ranges nest, because that is the one the reader means.
 *  3. A comment outranks a revision at equal width, since the comment is a question waiting
 *     on the reader while the revision is a decision they can also reach from the toolbar.
 *
 * Derived from the selection against layout ranges, so a caret arriving by click, by keyboard,
 * or by next-change navigation activates identically.
 */
export function activeReviewItem(
  items: readonly ReviewItem[],
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem | null {
  let best: ReviewItem | null = null;
  let bestSpan = Number.MAX_SAFE_INTEGER;
  for (const item of items) {
    if (item.kind === 'comment' && item.resolved) continue;
    if (item.kind === 'comment' && item.orphaned) continue;
    if (!covers(item, position, order)) continue;
    const width = spanOf(item, order);
    if (width < bestSpan || (width === bestSpan && item.kind === 'comment')) {
      best = item;
      bestSpan = width;
    }
  }
  return best;
}
