// The CONSERVATIVE local review patch: how a one-paragraph text-local edit updates the
// review queue without re-deriving it from the whole story.
//
// Split out of `tree-session.ts`, which owns the cache and calls these; the rules
// themselves are pure over the queue and read no session state. The bar is deliberately
// high — every predicate here answers "is the fast path still TRUE", and the fallback is
// the full derivation, which is always correct. A patch that keeps a stale card, or drops
// a live one, is worse than a slower keystroke.

import {
  linkRevisionReplies,
  reviewItemKey,
  reviewItemPositionRank,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../layout/review-support.ts';
import { findNode, type OoxmlPart, type TreeModelChange } from '@docx-editor.dev/core/store';

/** What the queue cache carries that the fast-path decision has to compare against. */
export interface LocalReviewPatchCache {
  readonly bodyRevision: number;
  readonly packageRevision: number;
  readonly commentsPart: OoxmlPart | undefined;
  readonly commentsExtendedPart: OoxmlPart | undefined;
}

function itemStartParagraphRank(
  item: ReviewItem,
  order: ReadonlyMap<string, number>
): number | null {
  const range = item.kind === 'revision' ? (item.ranges[0] ?? null) : item.range;
  if (!range) return null;
  const rank = order.get(range.start.paragraphId);
  return rank === undefined ? null : rank;
}

export function canApplyLocalReviewPatch(
  cached: readonly ReviewItem[],
  localRevisions: readonly ReviewRevisionItem[],
  dirtyParagraphId: string
): boolean {
  for (const local of localRevisions) {
    if (local.ranges.length === 0) return false;
  }
  const keptRangelessKeys = new Set<string>();
  for (const item of cached) {
    if (item.kind !== 'revision' || item.ranges.length > 0) continue;
    if (isRevisionWhollyInParagraph(item, dirtyParagraphId)) continue;
    keptRangelessKeys.add(reviewItemKey(item));
  }
  for (const local of localRevisions) {
    if (keptRangelessKeys.has(reviewItemKey(local))) return false;
  }
  return true;
}

export function patchLocalReviewItems(
  cached: readonly ReviewItem[],
  paragraphOrder: ReadonlyMap<string, number>,
  dirtyParagraphId: string,
  localRevisions: readonly ReviewRevisionItem[]
): ReviewItem[] {
  const dirtyRank = paragraphOrder.get(dirtyParagraphId);
  if (dirtyRank === undefined) return [...cached];

  const patched: ReviewItem[] = [];
  let insertAt: number | null = null;

  for (const item of cached) {
    if (item.kind === 'revision' && isRevisionWhollyInParagraph(item, dirtyParagraphId)) {
      if (insertAt === null) insertAt = patched.length;
      continue;
    }
    if (insertAt === null) {
      const rank = itemStartParagraphRank(item, paragraphOrder);
      if (rank !== null && rank > dirtyRank) insertAt = patched.length;
    }
    patched.push(item);
  }

  if (insertAt === null) insertAt = patched.length;
  if (localRevisions.length > 0) {
    const orderedLocalRevisions =
      localRevisions.length < 2
        ? [...localRevisions]
        : [...localRevisions].sort(
            (a, b) =>
              reviewItemPositionRank(a, paragraphOrder) - reviewItemPositionRank(b, paragraphOrder)
          );
    patched.splice(insertAt, 0, ...orderedLocalRevisions);
  }
  // RE-LINKED, because the local revisions were derived from one paragraph and carry no
  // replies. Splicing them in as-is dropped the link between a tracked change and the comment
  // answering it, so a keystroke in that paragraph tore the reply out into a card of its own —
  // and the next full re-derive put it back. The pass is over the patched list and costs
  // nothing when no comment answers a change.
  return linkRevisionReplies(patched);
}

function isRevisionWhollyInParagraph(item: ReviewRevisionItem, paragraphId: string): boolean {
  return (
    item.ranges.length > 0 &&
    item.ranges.every(
      (range) => range.start.paragraphId === paragraphId && range.end.paragraphId === paragraphId
    )
  );
}

function commentTouchesParagraph(item: ReviewCommentItem, paragraphId: string): boolean {
  if (!item.range) return false;
  return item.range.start.paragraphId === paragraphId || item.range.end.paragraphId === paragraphId;
}

/**
 * True for a revision ANCHORED to this paragraph whose markup lives outside it.
 *
 * A tracked ROW is the case: `w:trPr/w:ins` and the `w:cellIns` beside it sit on the row and
 * its cells, and the site index anchors all of them to the row's FIRST paragraph so the card
 * has somewhere to point. The patch replaces every cached revision "wholly inside" the dirty
 * paragraph with what a walk of that paragraph's SUBTREE finds — which holds none of those
 * markers. So typing in that first cell dropped the row's card while the row stayed painted
 * as a proposal: a change on screen with nothing left to accept it by.
 */
function revisionAnchoredOutsideParagraph(item: ReviewRevisionItem, paragraphId: string): boolean {
  return (
    item.revisionKind === 'structural' &&
    item.ranges.some(
      (range) => range.start.paragraphId === paragraphId || range.end.paragraphId === paragraphId
    )
  );
}

function revisionCrossesParagraphBoundary(item: ReviewRevisionItem, paragraphId: string): boolean {
  if (item.ranges.length === 0) return false;
  const touches = item.ranges.some(
    (range) => range.start.paragraphId === paragraphId || range.end.paragraphId === paragraphId
  );
  if (!touches) return false;
  return !item.ranges.every(
    (range) => range.start.paragraphId === paragraphId && range.end.paragraphId === paragraphId
  );
}

/** The one paragraph a patch may rebuild, or null to fall back to the full derivation. */
export function localReviewPatchParagraphId(
  change: TreeModelChange,
  cache: LocalReviewPatchCache,
  items: readonly ReviewItem[],
  part: OoxmlPart,
  commentsPart: OoxmlPart | undefined,
  commentsExtendedPart: OoxmlPart | undefined,
  currentPackageRevision: number
): string | null {
  if (change.fromRevision !== cache.bodyRevision) return null;
  // Body text-local edits bump package revision by exactly one. A header/footer or package
  // write can move package revision without moving the body revision — patching against a
  // queue derived before that would keep stale furniture cards by reference.
  if (currentPackageRevision !== cache.packageRevision + 1) return null;
  if (change.story !== undefined && change.story.kind !== 'body') return null;
  if (change.impact !== 'text-local') return null;
  if (change.dirty.length !== 1) return null;
  if (change.created.length > 0 || change.deleted.length > 0 || change.splitJoin.length > 0) {
    return null;
  }
  if (cache.commentsPart !== commentsPart || cache.commentsExtendedPart !== commentsExtendedPart) {
    return null;
  }
  const paragraphId = change.dirty[0]!;
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;

  for (const item of items) {
    if (item.kind === 'comment') {
      if (commentTouchesParagraph(item, paragraphId)) return null;
      continue;
    }
    // A custom node's item is refreshed by the FULL derivation only; a local revision
    // patch on its paragraph could go stale, so refuse the fast path when one touches it.
    if (item.kind === 'custom') {
      if (item.range?.start.paragraphId === paragraphId) return null;
      continue;
    }
    // Full derivation, not the fast path: the paragraph walk cannot see this item's markup,
    // so patching would delete a decision the document still holds.
    if (revisionAnchoredOutsideParagraph(item, paragraphId)) return null;
    if (revisionCrossesParagraphBoundary(item, paragraphId)) return null;
  }
  return paragraphId;
}
