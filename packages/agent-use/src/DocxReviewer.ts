/**
 * DocxReviewer — Word-like API for AI document review.
 *
 * Usage:
 *   const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
 *   const text = reviewer.getContentAsText();
 *   reviewer.addComment(5, 'Fix this paragraph.');
 *   reviewer.replace(5, '$50k', '$500k');
 *   const output = await reviewer.toBuffer();
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
  readonly author: string;

  constructor(document: Document, author = 'AI', originalBuffer?: ArrayBuffer) {
    this.doc = structuredClone(document);
    this.author = author;
    if (originalBuffer) {
      this.doc.originalBuffer = originalBuffer;
    } else if (document.originalBuffer) {
      this.doc.originalBuffer = document.originalBuffer;
    }
  }

  static async fromBuffer(buffer: ArrayBuffer, author = 'AI'): Promise<DocxReviewer> {
    const doc = await parseDocx(buffer);
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

  getContent(options?: GetContentOptions): ContentBlock[] {
    return getContentImpl(this.body, options);
  }

  /** Plain text for LLM prompts. Each paragraph prefixed with [index]. */
  getContentAsText(options?: GetContentOptions): string {
    return formatContentForLLM(getContentImpl(this.body, options));
  }

  // ==========================================================================
  // DISCOVER
  // ==========================================================================

  getChanges(filter?: ChangeFilter): ReviewChange[] {
    return getChangesImpl(this.body, filter);
  }

  getComments(filter?: CommentFilter): ReviewComment[] {
    return getCommentsImpl(this.body, filter);
  }

  // ==========================================================================
  // COMMENT — like Word: paragraph.addComment("text")
  // ==========================================================================

  /** Add a comment on a paragraph. */
  addComment(paragraphIndex: number, text: string): number;
  /** Add a comment with full options. */
  addComment(options: AddCommentOptions): number;
  addComment(indexOrOptions: number | AddCommentOptions, text?: string): number {
    const opts =
      typeof indexOrOptions === 'number'
        ? { paragraphIndex: indexOrOptions, text: text!, author: this.author }
        : { ...indexOrOptions, author: this.resolveAuthor(indexOrOptions.author) };
    return addCommentImpl(this.body, opts as AddCommentOptions & { author: string });
  }

  replyTo(commentId: number, text: string): number;
  replyTo(commentId: number, options: ReplyOptions): number;
  replyTo(commentId: number, textOrOptions: string | ReplyOptions): number {
    const opts =
      typeof textOrOptions === 'string'
        ? { text: textOrOptions, author: this.author }
        : { ...textOrOptions, author: this.resolveAuthor(textOrOptions.author) };
    return replyToImpl(this.body, commentId, opts as ReplyOptions & { author: string });
  }

  // ==========================================================================
  // PROPOSE CHANGES — like Word: range.find("old").replace("new")
  // ==========================================================================

  /** Replace text in a paragraph (creates tracked change). */
  replace(paragraphIndex: number, search: string, replaceWith: string): void;
  /** Replace with full options. */
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
    proposeReplacementImpl(this.body, opts as ProposeReplacementOptions & { author: string });
  }

  /** @deprecated Use replace() instead. */
  proposeReplacement(options: ProposeReplacementOptions): void {
    this.replace(options);
  }

  proposeInsertion(options: ProposeInsertionOptions): void {
    proposeInsertionImpl(this.body, {
      ...options,
      author: this.resolveAuthor(options.author),
    } as ProposeInsertionOptions & { author: string });
  }

  proposeDeletion(options: ProposeDeletionOptions): void {
    proposeDeletionImpl(this.body, {
      ...options,
      author: this.resolveAuthor(options.author),
    } as ProposeDeletionOptions & { author: string });
  }

  // ==========================================================================
  // RESOLVE
  // ==========================================================================

  acceptChange(id: number): void {
    acceptChangeImpl(this.body, id);
  }

  rejectChange(id: number): void {
    rejectChangeImpl(this.body, id);
  }

  acceptAll(): number {
    return acceptAllImpl(this.body);
  }

  rejectAll(): number {
    return rejectAllImpl(this.body);
  }

  // ==========================================================================
  // BATCH — apply LLM response in one call
  // ==========================================================================

  applyReview(ops: BatchReviewOptions): BatchResult {
    return applyReviewImpl(this.body, ops, this.author);
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  toDocument(): Document {
    return this.doc;
  }

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
