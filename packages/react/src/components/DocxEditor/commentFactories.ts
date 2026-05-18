import type { Comment } from '@eigenpal/docx-editor-core/types/content';

/**
 * Module-private counter for new comment + tracked-change IDs.
 *
 * Comments and tracked changes (revisions) share a single OOXML ID space —
 * a duplicate ID between the two corrupts the round-trip. The counter is
 * bumped above the existing max on document load (see
 * `bumpNextCommentIdAbove`).
 */
let nextCommentId = 1;

/** Sentinel ID for a comment that hasn't been persisted yet (anchored to selection). */
export const PENDING_COMMENT_ID = -1;

/** Stable empty Map used as the initial anchor-positions state. */
export const EMPTY_ANCHOR_POSITIONS = new Map<string, number>();

/** Allocate the next ID and advance the counter. */
export function getNextCommentId(): number {
  return nextCommentId++;
}

/**
 * On document load, bump the counter above the highest ID found in the
 * loaded comments and tracked-change marks so subsequent allocations don't
 * collide with already-present IDs.
 */
export function bumpNextCommentIdAbove(maxId: number): void {
  if (maxId >= nextCommentId) nextCommentId = maxId + 1;
}

export function createComment(text: string, authorName: string, parentId?: number): Comment {
  return {
    id: getNextCommentId(),
    author: authorName,
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        formatting: {},
        content: [{ type: 'run', formatting: {}, content: [{ type: 'text', text }] }],
      },
    ],
    ...(parentId !== undefined && { parentId }),
  };
}
