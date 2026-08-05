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
  type ReviewRevisionItem,
} from '../store/store/review-reads.ts';
import {
  commentPartNameOf,
  commentsExtendedPartNameOf,
} from '../store/store/comment-writes.ts';
import type { AutomationStoryReads } from './reads.ts';

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

/** One pending decision, as the protocol answers it. */
export interface AutomationRevisionRead {
  readonly id: string;
  readonly type: AutomationRevisionType;
  readonly author: string;
  /** ISO-8601 as the file wrote it, or empty when it wrote none. */
  readonly date: string;
  readonly item: ReviewRevisionItem;
}

/**
 * The decisions of one story, in document order.
 *
 * Filtered to the ones the engine can resolve: `readOnly` is the store lane's own answer to
 * "would accept and reject refuse this", so the filter cannot drift from what the ops do.
 */
export function revisionReads(reads: AutomationStoryReads): readonly AutomationRevisionRead[] {
  const found: AutomationRevisionRead[] = [];
  for (const item of revisionItemsOf(reads.part)) {
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
  const items = commentItemsOf(records, commentAnchorsOfStory(reads.part), threadState);
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
