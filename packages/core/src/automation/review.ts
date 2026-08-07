// Comments and tracked changes, as the protocol answers them.
//
// NOTHING IS DERIVED HERE. Both are read by `review-reads.ts` in the store lane — the same
// derivation the review rail draws its cards from — and this file only projects those items into
// the protocol's vocabulary: which comment is a reply to which, what Word calls a kind of change,
// and which decisions this engine can actually make. A second derivation would be a second answer
// to "what does this document hold", and the two would part company at the first document neither
// author had in mind.
//
// WHAT IS LEFT OUT IS LEFT OUT ON PURPOSE. A structural revision — a row, a cell, a section, the
// table grid — is one the engine refuses to accept or reject. It is not answered as a decision,
// because an object whose only operations are refusals is worse than an absence: a caller
// iterating changes would stall on it forever, and no amount of reading tells them why.

import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
  type CommentThreadState,
} from '../store/store/comment-reads.ts';
import {
  commentBodyText,
  commentItemsOf,
  revisionItemsOf,
  type ReviewCommentItem,
  type ReviewRange,
  type ReviewRevisionItem,
} from '../store/store/review-reads.ts';
import { commentPartNameOf, commentsExtendedPartNameOf } from '../store/store/comment-writes.ts';
import type { AutomationStoryReads } from './reads.ts';
import type { AutomationStoryId } from './stories.ts';

/**
 * Word's own name for a kind of change.
 *
 * A mapping rather than a passthrough, because the two vocabularies were written for different
 * purposes: the engine classifies by what it has to DO to resolve a change, Word by what the
 * change is. Where they disagree the Word name is the one a caller programs against.
 */
const REVISION_TYPES = {
  insert: 'Insert',
  delete: 'Delete',
  replace: 'Replace',
  moveFrom: 'MovedFrom',
  moveTo: 'MovedTo',
  /** `w:rPrChange` / `w:pPrChange`: the words are unchanged, their formatting is not. */
  format: 'Property',
  /** `w:pPr/w:rPr/w:ins|w:del` — a paragraph mark proposed or struck. */
  paragraphMark: 'ParagraphProperty',
} as const;

export type AutomationRevisionType = (typeof REVISION_TYPES)[keyof typeof REVISION_TYPES];

/**
 * Whether other stories live in this story's part.
 *
 * `footnotes.xml` holds every footnote in the document, so four notes are four stories in one part;
 * a header, a footer and the main document each own theirs outright. The distinction matters for
 * exactly one question — what to do with a review item the part holds but nothing in it locates —
 * and getting it wrong is how a note ends up reviewing its neighbour.
 */
function sharesItsPart(story: AutomationStoryId): boolean {
  return story.kind === 'note';
}

/**
 * Whether an item anchored at these ranges is the addressed story's.
 *
 * MEMBERSHIP, not the part: the store lane reads a PART, which is the right unit for it — the review
 * rail draws one pane per story it is given. This lane is asked about one story, and answering with
 * the part's items put note two's tracked insertion in note one's list, from which a handle was
 * minted that accepted a change in a story the caller never addressed.
 *
 * An item nothing locates (a revision on markup that is not inside a paragraph) belongs to the story
 * that owns the part, and to no note: with nothing to place it by, claiming it for one of four notes
 * would be a guess, and claiming it for all four would report one change as four.
 */
function inStory(reads: AutomationStoryReads, ranges: readonly ReviewRange[]): boolean {
  if (ranges.length === 0) return !sharesItsPart(reads.story);
  return ranges.every((range) => reads.has(range.start.paragraphId));
}

/** One pending decision, as the protocol answers it. */
export interface AutomationRevisionRead {
  readonly id: string;
  readonly type: AutomationRevisionType;
  readonly author: string;
  /** ISO-8601 as the file wrote it, or empty when it wrote none. */
  readonly date: string;
  readonly item: ReviewRevisionItem;
}

/** Every tracked-change item that belongs to one story, including unsupported structural ones. */
export function revisionItemsInStory(reads: AutomationStoryReads): readonly ReviewRevisionItem[] {
  return Object.freeze(revisionItemsOf(reads.part).filter((item) => inStory(reads, item.ranges)));
}

/** Atomic ops for a story collection, or `null` when any item cannot be resolved safely. */
export function revisionDecisionOps(
  reads: AutomationStoryReads,
  accept: boolean
): readonly TreeDocOp[] | null {
  const items = revisionItemsInStory(reads);
  if (items.some((item) => item.readOnly || item.revisionKind === 'structural')) return null;
  return items.flatMap((item) =>
    item.addresses.map((revision) =>
      accept ? { op: 'acceptRevision', revision } : { op: 'rejectRevision', revision }
    )
  );
}

/**
 * The decisions of one story, in document order.
 *
 * Filtered to the ones the engine can resolve: `readOnly` is the store lane's own answer to
 * "would accept and reject refuse this", so the filter cannot drift from what the ops do.
 */
export function revisionReads(reads: AutomationStoryReads): readonly AutomationRevisionRead[] {
  const found: AutomationRevisionRead[] = [];
  for (const item of revisionItemsInStory(reads)) {
    if (item.readOnly || item.revisionKind === 'structural') continue;
    const type = REVISION_TYPES[item.revisionKind as keyof typeof REVISION_TYPES];
    if (type === undefined) continue;
    found.push(
      Object.freeze({
        id: item.id,
        type,
        author: item.author,
        date: item.date ?? '',
        item,
      })
    );
  }
  return Object.freeze(found);
}

/** One story's comments, with the thread each is part of. */
export interface AutomationCommentReads {
  readonly items: readonly ReviewCommentItem[];
  /** Top-level comments, in document order. A reply is reached through the one it answers. */
  readonly roots: readonly ReviewCommentItem[];
  byId(commentId: string): ReviewCommentItem | null;
  /** Plain text of a comment's body — the run walk, done once, in the store lane. */
  textOf(commentId: string): string;
}

/**
 * Whether the comment at the top of this one's thread is anchored in the story being read.
 *
 * A REPLY has no markers: `addComment` writes the entry and the `w15:paraIdParent` link and leaves
 * the range to the comment it answers, which is also how Word writes one. So a reply's story is its
 * thread's story, and a thread whose head is anchored somewhere else — another note, the body — is
 * not this story's however many replies it has.
 *
 * The index is the CALLER's, built once for the whole derivation. Building it here read like a
 * detail and was a denial of service: a `comments.xml` is XML inside a zip anyone can hand a
 * server, and an index rebuilt per comment made the cost of reading one square with its size.
 */
function rootIsAnchored(
  item: ReviewCommentItem,
  byId: ReadonlyMap<string, ReviewCommentItem>
): boolean {
  let walk: ReviewCommentItem | undefined = item;
  // Bounded: `commentItemsOf` has already broken any cycle the file described, and the cap is here
  // so a future reader of that guarantee cannot turn a file into a hang.
  for (let depth = 0; walk !== undefined && depth <= 64; depth += 1) {
    if (walk.parentId === undefined) return walk.range !== null;
    walk = byId.get(walk.parentId);
  }
  return false;
}

const NO_COMMENTS: AutomationCommentReads = Object.freeze({
  items: Object.freeze([]),
  roots: Object.freeze([]),
  byId: () => null,
  textOf: () => '',
});

/**
 * The comments anchored in one story.
 *
 * The parts are resolved through the RELATIONSHIP the story declares, never by their conventional
 * names: a document may point `comments.xml` anywhere, and a reader hardcoding the path while the
 * writer follows the relationship is how a comment gets written and never read back.
 */
export function commentReads(
  pkg: OoxmlPackage,
  reads: AutomationStoryReads
): AutomationCommentReads {
  const commentsPart: OoxmlPart | undefined = pkg.parts.get(
    commentPartNameOf(pkg, reads.part.name)
  );
  if (!commentsPart) return NO_COMMENTS;
  const extended = pkg.parts.get(commentsExtendedPartNameOf(pkg, reads.part.name));
  const records = commentsOfPart(commentsPart);
  const threadState: ReadonlyMap<string, CommentThreadState> = extended
    ? threadStateOfPart(extended)
    : new Map<string, CommentThreadState>();
  // THE ANCHORS OF THIS STORY, not of its part. Threading is still computed over every comment the
  // part declares, because a reply carries no markers of its own — it is reached through the comment
  // it answers, and that comment is the one whose anchor decides which story the thread is in.
  const anchors = commentAnchorsOfStory(reads.part).filter((anchor) =>
    reads.has(anchor.start.paragraphId)
  );
  const threaded = commentItemsOf(records, anchors, threadState);
  const threadedById = new Map(threaded.map((item) => [item.id, item]));
  const items = threaded.filter((item) => rootIsAnchored(item, threadedById));
  const byId = new Map(items.map((item) => [item.id, item]));
  return Object.freeze({
    items: Object.freeze(items),
    roots: Object.freeze(items.filter((item) => item.parentId === undefined)),
    byId: (commentId: string) => byId.get(commentId) ?? null,
    textOf: (commentId: string) => {
      const item = byId.get(commentId);
      return item ? commentBodyText(item.comment) : '';
    },
  });
}
