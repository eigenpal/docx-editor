/**
 * applyReview() — batch review operations in a single call.
 */

import type { DocumentBody } from '@eigenpal/docx-core/headless';
import type { BatchReviewOptions, BatchResult, BatchError } from './types';
import { acceptChange, rejectChange, proposeReplacement } from './changes';
import { addComment, replyTo } from './comments';

/**
 * Apply multiple review operations in a single call.
 * Order: accept/reject → comments → replies → proposals.
 * Individual failures are collected, not thrown.
 */
export function applyReview(body: DocumentBody, ops: BatchReviewOptions): BatchResult {
  const errors: BatchError[] = [];
  let accepted = 0;
  let rejected = 0;
  let commentsAdded = 0;
  let repliesAdded = 0;
  let proposalsAdded = 0;

  // Accept
  for (const id of ops.accept ?? []) {
    try {
      acceptChange(body, id);
      accepted++;
    } catch (e) {
      errors.push({ operation: 'accept', id, error: (e as Error).message });
    }
  }

  // Reject
  for (const id of ops.reject ?? []) {
    try {
      rejectChange(body, id);
      rejected++;
    } catch (e) {
      errors.push({ operation: 'reject', id, error: (e as Error).message });
    }
  }

  // Comments
  for (const opts of ops.comments ?? []) {
    try {
      addComment(body, opts);
      commentsAdded++;
    } catch (e) {
      errors.push({ operation: 'comment', search: opts.search, error: (e as Error).message });
    }
  }

  // Replies
  for (const opts of ops.replies ?? []) {
    try {
      replyTo(body, opts.commentId, { author: opts.author, text: opts.text });
      repliesAdded++;
    } catch (e) {
      errors.push({ operation: 'reply', id: opts.commentId, error: (e as Error).message });
    }
  }

  // Proposals
  for (const opts of ops.proposals ?? []) {
    try {
      proposeReplacement(body, opts);
      proposalsAdded++;
    } catch (e) {
      errors.push({ operation: 'proposal', search: opts.search, error: (e as Error).message });
    }
  }

  return { accepted, rejected, commentsAdded, repliesAdded, proposalsAdded, errors };
}
