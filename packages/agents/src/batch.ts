/**
 * applyReview() — batch review operations in a single call.
 */

import type { DocumentBody } from '@eigenpal/docx-editor-core/headless';
import type { BatchReviewOptions, BatchResult, BatchError } from './types';
import type { ChangeNotes } from './discovery';
import { acceptChange, rejectChange, proposeReplacement } from './changes';
import { getChanges } from './discovery';
import { ChangeNotFoundError } from './errors';
import { addComment, replyTo } from './comments';

/**
 * Apply multiple review operations in a single call.
 * Order: accept/reject → comments → replies → proposals.
 * Individual failures are collected, not thrown.
 * defaultAuthor is used when individual items don't specify an author.
 *
 * `accept`/`reject` ids are resolved in the document **body** only. Passing the
 * `notes` stores does NOT enable in-note targeting (the batch ids are numeric);
 * it only sharpens the error message — a body-miss on an id that actually lives
 * in a footnote/endnote is reported as note-specific instead of a bare
 * "not found", so the caller knows the id exists but isn't body-mutable here.
 */
export function applyReview(
  body: DocumentBody,
  ops: BatchReviewOptions,
  defaultAuthor = 'AI',
  notes?: ChangeNotes
): BatchResult {
  const errors: BatchError[] = [];
  let accepted = 0;
  let rejected = 0;
  let commentsAdded = 0;
  let repliesAdded = 0;
  let proposalsAdded = 0;

  // Built lazily on the first body-miss: maps a note-resident change id to the
  // kind of note it lives in. Only constructed when `notes` is supplied AND an
  // accept/reject actually fails, so the happy path pays nothing.
  let noteChangeKinds: Map<number, 'footnote' | 'endnote'> | null = null;
  const explain = (id: number, e: Error): string => {
    if (!notes || !(e instanceof ChangeNotFoundError)) return e.message;
    if (noteChangeKinds === null) {
      noteChangeKinds = new Map();
      for (const c of getChanges(body, { includeFootnotes: true, includeEndnotes: true }, notes)) {
        if (c.noteType) noteChangeKinds.set(c.id, c.noteType);
      }
    }
    const kind = noteChangeKinds.get(id);
    return kind
      ? `Tracked change id=${id} is inside a ${kind}; applyReview resolves document-body changes only. Accept/reject in-note changes through the note-targeting accept/reject API.`
      : e.message;
  };

  for (const id of ops.accept ?? []) {
    try {
      acceptChange(body, id);
      accepted++;
    } catch (e) {
      errors.push({ operation: 'accept', id, error: explain(id, e as Error) });
    }
  }

  for (const id of ops.reject ?? []) {
    try {
      rejectChange(body, id);
      rejected++;
    } catch (e) {
      errors.push({ operation: 'reject', id, error: explain(id, e as Error) });
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
