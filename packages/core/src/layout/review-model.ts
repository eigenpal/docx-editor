// Where a review card belongs beside the page.
//
// The QUEUE itself is derived in the store lane (`review-reads.ts`): it is a property of the
// canonical tree, and every lane — the rail, an automation host — has to read one derivation of
// it or a reviewer's remark ends up listed by one surface and missing from another. What stays
// here is the half that genuinely needs a layout: which page a card sits on, and how far down.
// Everything else is re-exported so a caller keeps one import.

import {
  firstReviewRange,
  reviewItemRanges,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewPosition,
  type ReviewRange,
} from '@docx-editor.dev/core-contract/store';

export {
  collectReviewItems,
  commentBodyText,
  commentInitials,
  commentItemsOf,
  firstReviewRange,
  paragraphOrderOfPart,
  reviewItemKey,
  reviewItemRanges,
  revisionItemsOf,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewModelInput,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
  type ReviewRevisionKind,
} from '@docx-editor.dev/core-contract/store';

/** Width of one range in document-order units, for the innermost-wins tie-break. */
function rangeWidth(range: ReviewRange, order: ReadonlyMap<string, number>): number {
  const start = order.get(range.start.paragraphId);
  const end = order.get(range.end.paragraphId);
  if (start === undefined || end === undefined) return Number.MAX_SAFE_INTEGER;
  // A real distance, not a sentinel: a cross-paragraph range used to score MAX_SAFE_INTEGER,
  // which lost every comparison, so placing the caret in a multi-paragraph insertion activated
  // nothing at all.
  return (end - start) * 1_000_000 + (range.end.offset - range.start.offset);
}

function rangeCovers(
  range: ReviewRange,
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): boolean {
  const target = order.get(position.paragraphId);
  const start = order.get(range.start.paragraphId);
  const end = order.get(range.end.paragraphId);
  if (target === undefined || start === undefined || end === undefined) return false;
  if (target < start || target > end) return false;
  // BOTH boundaries count. A caret resting at the end of a range is visually on that range's
  // last character; requiring it to be strictly inside makes the last character feel dead.
  if (target === start && position.offset < range.start.offset) return false;
  if (target === end && position.offset > range.end.offset) return false;
  return true;
}

/**
 * The narrowest range of this item that covers the position, or null.
 *
 * EVERY range is asked, not just the first. Sites sharing a triple coalesce into one card, so a
 * revision that touches two paragraphs carries two ranges — checking only the first left the
 * caret in the second paragraph activating nothing.
 */
function coveringWidth(
  item: ReviewItem,
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): number | null {
  let best: number | null = null;
  for (const range of reviewItemRanges(item)) {
    if (!rangeCovers(range, position, order)) continue;
    const width = rangeWidth(range, order);
    if (best === null || width < best) best = width;
  }
  return best;
}

/**
 * Every item covering a position, innermost first.
 *
 * Returning the whole stack rather than one winner is what lets a surface offer cycling, a
 * stacked card, or a "1 of 3" affordance. A comment wrapping a revision used to be unreachable
 * because only the tightest range was ever returned.
 */
export function reviewItemsAt(
  items: readonly ReviewItem[],
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem[] {
  const covering: { item: ReviewItem; width: number }[] = [];
  for (const item of items) {
    const width = coveringWidth(item, position, order);
    if (width !== null) covering.push({ item, width });
  }
  return covering
    .sort((a, b) => {
      if (a.width !== b.width) return a.width - b.width;
      // At equal width a comment outranks a revision: it is a question waiting on the reader,
      // while the revision is also reachable from the toolbar.
      if (a.item.kind !== b.item.kind) return a.item.kind === 'comment' ? -1 : 1;
      return 0;
    })
    .map((entry) => entry.item);
}

/**
 * The item the caret is in, or null.
 *
 * A resolved comment never activates: a settled thread must not reopen itself as the reviewer
 * types near it.
 *
 * A REPLY resolves to the thread it belongs to. A reply is anchored over its parent's range,
 * so both cover the caret — and the reply, being newer, wins the innermost test. It is not a
 * card of its own (it renders inside its parent's), so the thread would have gone active with
 * nothing on screen showing it: the reply box vanished from a comment the moment somebody
 * replied to it.
 */
export function activeReviewItem(
  items: readonly ReviewItem[],
  position: ReviewPosition,
  order: ReadonlyMap<string, number>
): ReviewItem | null {
  const covering = reviewItemsAt(items, position, order).filter(
    (item) => !(item.kind === 'comment' && item.resolved)
  );
  const found = covering[0];
  if (!found) return null;
  return found.kind === 'comment' ? threadRootOf(items, found) : found;
}

/** Walk a reply up to the comment that heads its thread. Guarded against a cyclic file. */
function threadRootOf(items: readonly ReviewItem[], comment: ReviewCommentItem): ReviewItem {
  const byId = new Map<string, ReviewCommentItem>();
  for (const item of items) if (item.kind === 'comment') byId.set(item.id, item);
  const seen = new Set<string>([comment.id]);
  let current = comment;
  while (current.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

/**
 * Where a card belongs beside the page, from LAYOUT RECORDS.
 *
 * The one question the tree cannot answer, and the one a surface must not answer for itself:
 * measuring painted DOM puts the sidebar a repaint behind the document and breaks outright
 * while pagination is in flight.
 *
 * Returns null when the item has no resolvable range, or when its paragraph is not in this
 * layout — a comment anchored in a header belongs to a story the body layout never saw.
 */
/** Where one paragraph sits, resolved once so a card is an O(1) lookup. */
export interface ReviewParagraphAnchor {
  readonly pageIndex: number;
  /** Sheet-absolute y of the page's content box. */
  readonly contentY: number;
  /** The fragment's own y, measured from that content box. */
  readonly fragmentY: number;
  readonly lines?: readonly {
    readonly range: { readonly end: number };
    readonly box: { readonly y: number };
  }[];
}

/**
 * Paragraph id to its place on the page, in ONE pass over the layout.
 *
 * Built once per layout and reused by every card. The straightforward version — scan the
 * pages until the paragraph turns up, per card — is a full-document walk per card, and a
 * contract with two hundred comments walked the document two hundred times every time the
 * caret moved. Toggling the pane was visibly slow for exactly that reason.
 */
export function reviewAnchorIndex<
  TPage extends { readonly index: number; readonly contentBox: { readonly y: number } },
>(
  layout: { readonly pages: readonly TPage[] },
  paragraphFragments: (page: TPage) => readonly {
    readonly paragraphId: string;
    readonly box: { readonly y: number };
    readonly lines?: readonly {
      readonly range: { readonly end: number };
      readonly box: { readonly y: number };
    }[];
  }[]
): Map<string, ReviewParagraphAnchor> {
  const index = new Map<string, ReviewParagraphAnchor>();
  for (const page of layout.pages) {
    for (const fragment of paragraphFragments(page)) {
      // FIRST fragment wins: a paragraph split across a page break is anchored where it
      // starts, which is where its comment marker was written.
      if (index.has(fragment.paragraphId)) continue;
      index.set(fragment.paragraphId, {
        pageIndex: page.index,
        contentY: page.contentBox.y,
        fragmentY: fragment.box.y,
        ...(fragment.lines ? { lines: fragment.lines } : {}),
      });
    }
  }
  return index;
}

/**
 * Where a card belongs beside the page, from LAYOUT RECORDS.
 *
 * The one question the tree cannot answer, and the one a surface must not answer for itself:
 * measuring painted DOM puts the sidebar a repaint behind the document and breaks outright
 * while pagination is in flight.
 *
 * Returns null when the item has no resolvable range, or when its paragraph is not in this
 * layout — a comment anchored in a header belongs to a story the body layout never saw.
 */
export function reviewItemGeometry(
  item: ReviewItem,
  index: ReadonlyMap<string, ReviewParagraphAnchor>
): { readonly pageIndex: number; readonly y: number } | null {
  const range = firstReviewRange(item);
  if (!range) return null;
  const anchor = index.get(range.start.paragraphId);
  if (!anchor) return null;
  // TWO coordinate spaces meet here. A fragment's box is relative to the page CONTENT box;
  // a page's content box is absolute in the sheet stack. Using the fragment's own y alone
  // put every card from page two onwards at the top of the rail, all of them claiming to
  // annotate the first inch of the document.
  //
  // The LINE the range starts on, not the paragraph's top: a comment on the last line of a
  // twelve-line paragraph belongs beside that line, which is where Word puts it.
  const line = anchor.lines?.find((entry) => range.start.offset < entry.range.end);
  return {
    pageIndex: anchor.pageIndex,
    y: anchor.contentY + (line ? line.box.y : anchor.fragmentY),
  };
}
