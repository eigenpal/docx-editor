// The CONSERVATIVE local review patch: how a one-paragraph local edit updates the
// review queue without re-deriving it from the whole story.
//
// Split out of `tree-session.ts`, which owns the cache and calls these; the rules
// themselves are pure over the queue and read no session state. The bar is deliberately
// high — every predicate here answers "is the fast path still TRUE", and the fallback is
// the full derivation, which is always correct. A patch that keeps a stale card, or drops
// a live one, is worse than a slower keystroke.

import {
  reviewItemKey,
  reviewItemPositionRank,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';
import {
  findNode,
  parentNodeOf,
  collectRevisionSites,
  linkRevisionReplies,
  type OoxmlPackage,
  type OoxmlPart,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';

/** What the queue cache carries that the fast-path decision has to compare against. */
export interface LocalReviewPatchCache {
  readonly bodyRevision: number;
  readonly packageRevision: number;
  readonly commentsPart: OoxmlPart | undefined;
  readonly commentsExtendedPart: OoxmlPart | undefined;
  /** The package the queue was derived or patched from. */
  readonly pkg: OoxmlPackage;
}

/**
 * Turning a paragraph into a list item first writes its list definition here, outside the
 * edit's own transaction. The review queue never reads this part.
 */
const NUMBERING_PART = '/word/numbering.xml';

/**
 * Whether every package input of the queue except the edited story is the same object as
 * before: every part but `storyPartName` and the numbering part, and the relationships and
 * content types that resolve headers, footers, notes, and comments.
 */
function reviewInputsUnchanged(
  before: OoxmlPackage,
  after: OoxmlPackage,
  storyPartName: string
): boolean {
  if (
    before.relationships !== after.relationships ||
    before.contentTypes !== after.contentTypes ||
    before.parts.size !== after.parts.size
  ) {
    return false;
  }
  for (const [name, part] of after.parts) {
    if (name === storyPartName || name === NUMBERING_PART) continue;
    if (before.parts.get(name) !== part) return false;
  }
  return true;
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

/** The inputs a carried queue depends on, at the time of `change`. */
export interface ReviewPatchInputs {
  readonly part: OoxmlPart;
  readonly commentsPart: OoxmlPart | undefined;
  readonly commentsExtendedPart: OoxmlPart | undefined;
  readonly currentPackageRevision: number;
  readonly currentPackage: OoxmlPackage;
  readonly changePackage: OoxmlPackage | null;
}

/** Whether `change` is one body commit after `cache`, with every other queue input unchanged. */
function onlyBodyChanged(
  change: TreeModelChange,
  cache: LocalReviewPatchCache,
  inputs: ReviewPatchInputs
): boolean {
  if (change.fromRevision !== cache.bodyRevision) return false;
  // Body text-local edits bump package revision by exactly one. A header/footer or package
  // write can move package revision without moving the body revision — patching against a
  // queue derived before that would keep stale furniture cards by reference. A list
  // definition written just before the edit moves it too; that write is allowed only when
  // the edit was the last write and every other input is the same object.
  if (
    inputs.currentPackageRevision !== cache.packageRevision + 1 &&
    (inputs.changePackage !== inputs.currentPackage ||
      !reviewInputsUnchanged(cache.pkg, inputs.currentPackage, inputs.part.name))
  ) {
    return false;
  }
  if (change.story !== undefined && change.story.kind !== 'body') return false;
  if (change.impact === 'global') return false;
  return (
    cache.commentsPart === inputs.commentsPart &&
    cache.commentsExtendedPart === inputs.commentsExtendedPart
  );
}

/** Whether the paragraph before `paragraphId` holds a paragraph-mark revision. */
function previousHoldsMarkRevision(part: OoxmlPart, paragraphId: string): boolean {
  const owner = parentNodeOf(part, paragraphId);
  if (!owner) return false;
  const index = owner.children.findIndex((child) => child.id === paragraphId);
  const previous = owner.children[index - 1];
  return (
    previous?.kind === 'paragraph' &&
    collectRevisionSites({ ...part, root: previous }).some((site) => site.paragraphMark)
  );
}

/**
 * Whether a paragraph split or join leaves the cached queue exactly as it is.
 *
 * Enter and a join move no review markup when neither paragraph holds any and no card starts
 * or ends in them: every card keeps its paragraphs and offsets. A tracked split writes a
 * paragraph-mark revision into the first paragraph, so it fails this check.
 */
export function reviewQueueKeptByStructure(
  change: TreeModelChange,
  cache: LocalReviewPatchCache,
  items: readonly ReviewItem[],
  inputs: ReviewPatchInputs
): boolean {
  if (!onlyBodyChanged(change, cache, inputs)) return false;
  if (change.splitJoin.length !== 1) return false;
  const entry = change.splitJoin[0]!;
  let involved: readonly string[];
  let survivors: readonly string[];
  if ('split' in entry) {
    if (change.deleted.length > 0) return false;
    if (change.created.length !== 1 || change.created[0] !== entry.split.tail) return false;
    involved = survivors = [entry.split.from, entry.split.tail];
  } else {
    if (change.created.length > 0) return false;
    if (change.deleted.length !== 1 || change.deleted[0] !== entry.join.removed) return false;
    involved = [entry.join.kept, entry.join.removed];
    survivors = [entry.join.kept];
  }
  for (const id of survivors) {
    const paragraph = findNode(inputs.part, id);
    if (!paragraph || paragraph.kind !== 'paragraph') return false;
    if (collectRevisionSites({ ...inputs.part, root: paragraph }).length > 0) return false;
  }
  if (previousHoldsMarkRevision(inputs.part, survivors[0]!)) return false;
  const touches = (paragraphId: string | undefined) =>
    paragraphId !== undefined && involved.includes(paragraphId);
  for (const item of items) {
    const ranges = item.kind === 'revision' ? item.ranges : item.range ? [item.range] : [];
    for (const range of ranges) {
      if (touches(range.start.paragraphId) || touches(range.end.paragraphId)) return false;
    }
  }
  return true;
}

/** The one paragraph a patch may rebuild, or null to fall back to the full derivation. */
export function localReviewPatchParagraphId(
  change: TreeModelChange,
  cache: LocalReviewPatchCache,
  items: readonly ReviewItem[],
  inputs: ReviewPatchInputs
): string | null {
  if (!onlyBodyChanged(change, cache, inputs)) return null;
  if (change.dirty.length !== 1) return null;
  if (change.created.length > 0 || change.deleted.length > 0 || change.splitJoin.length > 0) {
    return null;
  }
  const { part } = inputs;
  const paragraphId = change.dirty[0]!;
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  if (change.impact !== 'text-local') {
    // A property or list edit can add a formatting change that folds into a neighbor's card.
    // Only a paragraph left with no revision markup at all is sure to need no card of its own.
    if (collectRevisionSites({ ...part, root: paragraph }).length > 0) return null;
    // A list edit moves the flow, and a paragraph in a table has row and cell markup outside
    // it. Only a paragraph directly in the body has nothing above it to hold a card.
    if (
      change.impact === 'flow-structural' &&
      parentNodeOf(part, paragraphId)?.localName !== 'body'
    ) {
      return null;
    }
  }

  // A local edit can CREATE a cross-paragraph group. The cached queue cannot prove
  // that boundary safe: before typing after Enter, only the preceding mark exists.
  if (previousHoldsMarkRevision(part, paragraphId)) return null;

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
