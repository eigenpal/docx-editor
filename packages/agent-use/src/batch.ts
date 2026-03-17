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
 * defaultAuthor is used when individual items don't specify an author.
 */
export function applyReview(
  body: DocumentBody,
  ops: BatchReviewOptions,
  defaultAuthor = 'AI'
): BatchResult {
  const errors: BatchError[] = [];
  let accepted = 0;
  let rejected = 0;
  let commentsAdded = 0;
  let repliesAdded = 0;
  let proposalsAdded = 0;

  for (const id of ops.accept ?? []) {
    try {
      acceptChange(body, id);
      accepted++;
    } catch (e) {
      errors.push({ operation: 'accept', id, error: (e as Error).message });
    }
  }

  for (const id of ops.reject ?? []) {
    try {
      rejectChange(body, id);
      rejected++;
    } catch (e) {
      errors.push({ operation: 'reject', id, error: (e as Error).message });
    }
  }

  for (const opts of ops.comments ?? []) {
    try {
      addComment(body, { ...opts, author: opts.author ?? defaultAuthor });
      commentsAdded++;
    } catch (e) {
      errors.push({ operation: 'comment', search: opts.search, error: (e as Error).message });
    }
  }

  for (const opts of ops.replies ?? []) {
    try {
      replyTo(body, opts.commentId, { author: opts.author ?? defaultAuthor, text: opts.text });
      repliesAdded++;
    } catch (e) {
      errors.push({ operation: 'reply', id: opts.commentId, error: (e as Error).message });
    }
  }

  for (const opts of ops.proposals ?? []) {
    try {
      proposeReplacement(body, { ...opts, author: opts.author ?? defaultAuthor });
      proposalsAdded++;
    } catch (e) {
      errors.push({ operation: 'proposal', search: opts.search, error: (e as Error).message });
    }
  }

  return { accepted, rejected, commentsAdded, repliesAdded, proposalsAdded, errors };
}
