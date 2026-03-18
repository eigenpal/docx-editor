/**
 * DocxReviewer — Word-like API for AI document review.
 *
 * @example
 * ```ts
 * const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
 * const text = reviewer.getContentAsText();
 * reviewer.addComment(5, 'Fix this paragraph.');
 * reviewer.replace(5, '$50k', '$500k');
 * const output = await reviewer.toBuffer();
 * ```
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
  /** Default author for comments and tracked changes. Set once, used everywhere. */
  readonly author: string;

  /**
   * Create a reviewer from a parsed Document.
   * @param document - Parsed Document from @eigenpal/docx-core
   * @param author - Default author name for comments and changes. (default: 'AI')
   * @param originalBuffer - Original DOCX buffer, needed for toBuffer()
   */
  constructor(document: Document, author = 'AI', originalBuffer?: ArrayBuffer) {
    // Strip originalBuffer before cloning to avoid deep-copying potentially large ArrayBuffer
    const savedBuffer = originalBuffer ?? document.originalBuffer;
    const { originalBuffer: _discard, ...rest } = document;
    this.doc = structuredClone(rest) as Document;
    if (savedBuffer) this.doc.originalBuffer = savedBuffer;
    this.author = author;
  }

  /**
   * Create a reviewer from a DOCX file buffer.
   * @param buffer - ArrayBuffer of the DOCX file
   * @param author - Default author name for comments and changes. (default: 'AI')
   */
  static async fromBuffer(buffer: ArrayBuffer, author = 'AI'): Promise<DocxReviewer> {
    const doc = await parseDocx(buffer, { preloadFonts: false });
    return new DocxReviewer(doc, author, buffer);
  }

  private get body(): DocumentBody {
    return this.doc.package.document;
  }

  private resolveAuthor(author?: string): string {
    return author ?? this.author;
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  /** Get document content as structured blocks (headings, paragraphs, tables, lists). */
  getContent(options?: GetContentOptions): ContentBlock[] {
    return getContentImpl(this.body, options);
  }

  /**
   * Get document content as plain text for LLM prompts.
   * Each paragraph is prefixed with its index: `[0] text`, `[1] text`, etc.
   * Table cells include position: `[5] (table, row 1, col 2) cell text`.
   * Avoids JSON quote-escaping issues — LLMs can copy text verbatim.
   */
  getContentAsText(options?: GetContentOptions): string {
    return formatContentForLLM(getContentImpl(this.body, options));
  }

  // ==========================================================================
  // DISCOVER
  // ==========================================================================

  /** Get all tracked changes in the document. */
  getChanges(filter?: ChangeFilter): ReviewChange[] {
    return getChangesImpl(this.body, filter);
  }

  /** Get all comments with their replies. */
  getComments(filter?: CommentFilter): ReviewComment[] {
    return getCommentsImpl(this.body, filter);
  }

  // ==========================================================================
  // COMMENT
  // ==========================================================================

  /**
   * Add a comment on a paragraph.
   * @param paragraphIndex - Index of the paragraph to comment on
   * @param text - Comment text
   * @returns The new comment ID
   */
  addComment(paragraphIndex: number, text: string): number;
  /**
   * Add a comment with full options (custom author, anchored to specific text).
   * @param options - Comment options
   * @returns The new comment ID
   */
  addComment(options: AddCommentOptions): number;
  addComment(indexOrOptions: number | AddCommentOptions, text?: string): number {
    const opts =
      typeof indexOrOptions === 'number'
        ? { paragraphIndex: indexOrOptions, text: text!, author: this.author }
        : { ...indexOrOptions, author: this.resolveAuthor(indexOrOptions.author) };
    return addCommentImpl(this.body, opts);
  }

  /**
   * Reply to an existing comment.
   * @param commentId - ID of the comment to reply to
   * @param text - Reply text
   * @returns The new reply comment ID
   */
  replyTo(commentId: number, text: string): number;
  /** Reply to an existing comment with full options. */
  replyTo(commentId: number, options: ReplyOptions): number;
  replyTo(commentId: number, textOrOptions: string | ReplyOptions): number {
    const opts =
      typeof textOrOptions === 'string'
        ? { text: textOrOptions, author: this.author }
        : { ...textOrOptions, author: this.resolveAuthor(textOrOptions.author) };
    return replyToImpl(this.body, commentId, opts);
  }

  // ==========================================================================
  // PROPOSE CHANGES
  // ==========================================================================

  /**
   * Replace text in a paragraph. Creates a tracked change (deletion + insertion).
   * @param paragraphIndex - Index of the paragraph
   * @param search - Short phrase to find within the paragraph
   * @param replaceWith - Replacement text
   */
  replace(paragraphIndex: number, search: string, replaceWith: string): void;
  /** Replace text with full options. */
  replace(options: ProposeReplacementOptions): void;
  replace(
    indexOrOptions: number | ProposeReplacementOptions,
    search?: string,
    replaceWith?: string
  ): void {
    const opts =
      typeof indexOrOptions === 'number'
        ? {
            paragraphIndex: indexOrOptions,
            search: search!,
            replaceWith: replaceWith!,
            author: this.author,
          }
        : { ...indexOrOptions, author: this.resolveAuthor(indexOrOptions.author) };
    proposeReplacementImpl(this.body, opts);
  }

  /** @deprecated Use replace() instead. */
  proposeReplacement(options: ProposeReplacementOptions): void {
    this.replace(options);
  }

  /** Insert text as a tracked change. */
  proposeInsertion(options: ProposeInsertionOptions): void {
    proposeInsertionImpl(this.body, {
      ...options,
      author: this.resolveAuthor(options.author),
    });
  }

  /** Delete text as a tracked change. */
  proposeDeletion(options: ProposeDeletionOptions): void {
    proposeDeletionImpl(this.body, {
      ...options,
      author: this.resolveAuthor(options.author),
    });
  }

  // ==========================================================================
  // RESOLVE
  // ==========================================================================

  /** Accept a tracked change by its revision ID. */
  acceptChange(id: number): void {
    acceptChangeImpl(this.body, id);
  }

  /** Reject a tracked change by its revision ID. */
  rejectChange(id: number): void {
    rejectChangeImpl(this.body, id);
  }

  /** Accept all tracked changes. Returns count accepted. */
  acceptAll(): number {
    return acceptAllImpl(this.body);
  }

  /** Reject all tracked changes. Returns count rejected. */
  rejectAll(): number {
    return rejectAllImpl(this.body);
  }

  // ==========================================================================
  // BATCH
  // ==========================================================================

  /**
   * Apply multiple review operations in one call.
   * Uses the reviewer's default author. Individual failures are collected, not thrown.
   */
  applyReview(ops: BatchReviewOptions): BatchResult {
    return applyReviewImpl(this.body, ops, this.author);
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  /** Get the modified Document model. */
  toDocument(): Document {
    return this.doc;
  }

  /** Serialize back to a DOCX buffer. Requires the original buffer. */
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
