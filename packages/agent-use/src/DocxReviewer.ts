/**
 * DocxReviewer — main class for agent-friendly document review.
 *
 * 14-method API: read, discover, comment, propose, resolve, batch, export.
 */

import type { Document, DocumentBody } from '@eigenpal/docx-core/headless';
import { parseDocx } from '@eigenpal/docx-core/headless';
import type {
  ContentBlock,
  GetContentOptions,
  ReviewChange,
  ReviewComment,
  ChangeFilter,
  CommentFilter,
  AddCommentOptions,
  ReplyOptions,
  ProposeReplacementOptions,
  ProposeInsertionOptions,
  ProposeDeletionOptions,
  BatchReviewOptions,
  BatchResult,
} from './types';
import { getContent as getContentImpl, formatContentForLLM } from './content';
import { getChanges as getChangesImpl, getComments as getCommentsImpl } from './discovery';
import { addComment as addCommentImpl, replyTo as replyToImpl } from './comments';
import {
  acceptChange as acceptChangeImpl,
  rejectChange as rejectChangeImpl,
  acceptAll as acceptAllImpl,
  rejectAll as rejectAllImpl,
  proposeReplacement as proposeReplacementImpl,
  proposeInsertion as proposeInsertionImpl,
  proposeDeletion as proposeDeletionImpl,
} from './changes';
import { applyReview as applyReviewImpl } from './batch';

export class DocxReviewer {
  private doc: Document;

  /**
   * Create a reviewer from a parsed Document.
   * The document is deep-cloned — the original is never modified.
   *
   * @param document - Parsed Document from @eigenpal/docx-core
   * @param originalBuffer - Original DOCX buffer, needed for toBuffer()
   */
  constructor(document: Document, originalBuffer?: ArrayBuffer) {
    // Deep clone so we don't mutate the caller's document
    this.doc = structuredClone(document);
    // Preserve original buffer for repacking (structuredClone can't clone ArrayBuffer correctly in all envs)
    if (originalBuffer) {
      this.doc.originalBuffer = originalBuffer;
    } else if (document.originalBuffer) {
      this.doc.originalBuffer = document.originalBuffer;
    }
  }

  /**
   * Create a reviewer from a DOCX buffer.
   */
  static async fromBuffer(buffer: ArrayBuffer): Promise<DocxReviewer> {
    const doc = await parseDocx(buffer);
    return new DocxReviewer(doc, buffer);
  }

  private get body(): DocumentBody {
    return this.doc.package.document;
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  /**
   * Get document content as structured blocks for LLM consumption.
   * Supports chunked reading via fromIndex/toIndex.
   * Tracked changes and comments are annotated inline by default.
   */
  getContent(options?: GetContentOptions): ContentBlock[] {
    return getContentImpl(this.body, options);
  }

  /**
   * Get document content as plain text for LLM prompts.
   * Avoids JSON quote-escaping issues — LLMs can copy text verbatim.
   * Each paragraph is prefixed with its index: [0] text, [1] text, etc.
   */
  getContentAsText(options?: GetContentOptions): string {
    return formatContentForLLM(getContentImpl(this.body, options));
  }

  // ==========================================================================
  // DISCOVER
  // ==========================================================================

  /**
   * Get all tracked changes, optionally filtered.
   */
  getChanges(filter?: ChangeFilter): ReviewChange[] {
    return getChangesImpl(this.body, filter);
  }

  /**
   * Get all comments with replies, optionally filtered.
   */
  getComments(filter?: CommentFilter): ReviewComment[] {
    return getCommentsImpl(this.body, filter);
  }

  // ==========================================================================
  // COMMENT
  // ==========================================================================

  /**
   * Add a comment anchored to a paragraph (or specific text within it).
   * Returns the new comment ID.
   */
  addComment(options: AddCommentOptions): number {
    return addCommentImpl(this.body, options);
  }

  /**
   * Reply to an existing comment. Returns the reply comment ID.
   */
  replyTo(commentId: number, options: ReplyOptions): number {
    return replyToImpl(this.body, commentId, options);
  }

  // ==========================================================================
  // PROPOSE CHANGES
  // ==========================================================================

  /**
   * Propose a text replacement as tracked changes (deletion + insertion).
   */
  proposeReplacement(options: ProposeReplacementOptions): void {
    proposeReplacementImpl(this.body, options);
  }

  /**
   * Propose an insertion as a tracked change.
   */
  proposeInsertion(options: ProposeInsertionOptions): void {
    proposeInsertionImpl(this.body, options);
  }

  /**
   * Propose a deletion as a tracked change.
   */
  proposeDeletion(options: ProposeDeletionOptions): void {
    proposeDeletionImpl(this.body, options);
  }

  // ==========================================================================
  // RESOLVE
  // ==========================================================================

  /**
   * Accept a tracked change by revision ID.
   */
  acceptChange(id: number): void {
    acceptChangeImpl(this.body, id);
  }

  /**
   * Reject a tracked change by revision ID.
   */
  rejectChange(id: number): void {
    rejectChangeImpl(this.body, id);
  }

  /**
   * Accept all tracked changes. Returns count of changes accepted.
   */
  acceptAll(): number {
    return acceptAllImpl(this.body);
  }

  /**
   * Reject all tracked changes. Returns count of changes rejected.
   */
  rejectAll(): number {
    return rejectAllImpl(this.body);
  }

  // ==========================================================================
  // BATCH
  // ==========================================================================

  /**
   * Apply multiple review operations in a single call.
   * Individual failures are collected in errors, not thrown.
   */
  applyReview(ops: BatchReviewOptions): BatchResult {
    return applyReviewImpl(this.body, ops);
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  /**
   * Get the modified Document model.
   */
  toDocument(): Document {
    return this.doc;
  }

  /**
   * Serialize and repack as a DOCX buffer.
   * Requires originalBuffer to have been provided at construction.
   */
  async toBuffer(): Promise<ArrayBuffer> {
    if (!this.doc.originalBuffer) {
      throw new Error(
        'Cannot create buffer: no original DOCX buffer was provided. ' +
          'Use DocxReviewer.fromBuffer() or pass originalBuffer to the constructor.'
      );
    }
    const { repackDocx } = await import('@eigenpal/docx-core/headless');
    return repackDocx(this.doc);
  }
}
