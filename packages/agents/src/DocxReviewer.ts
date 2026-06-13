import type { Document, DocumentBody } from '@eigenpal/docx-editor-core/headless';
import { parseDocx } from '@eigenpal/docx-editor-core/headless';
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
  AcceptChangesOptions,
  BatchReviewOptions,
  BatchResult,
} from './types';
import { getContent as getContentImpl, formatContentForLLM } from './content';
import { getChanges as getChangesImpl, getComments as getCommentsImpl } from './discovery';
import {
  addComment as addCommentImpl,
  replyTo as replyToImpl,
  removeComment as removeCommentImpl,
} from './comments';
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

/**
 * Headless DOCX reviewer — parse a file, read/comment/track changes
 * against the document model, write the modified DOCX back out. No DOM,
 * no editor instance. Pair with `createReviewerBridge()` to drive the
 * built-in agent tools against a file on disk.
 *
 * @example
 * ```ts
 * const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
 * reviewer.addComment(5, 'Fix this paragraph.');
 * reviewer.replace(5, '$50k', '$500k');
 * const output = await reviewer.toBuffer();
 * ```
 *
 * @public
 */
export class DocxReviewer {
  private doc: Document;
  /** Default author for comments and tracked changes. Set once, used everywhere. */
  readonly author: string;

  /**
   * Create a reviewer from a parsed Document.
   * @param document - Parsed Document from the core package
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

  /**
   * Get all tracked changes in the document. Pass `includeFootnotes` /
   * `includeEndnotes` in the filter to also report changes inside note bodies
   * (each such change carries `noteId` / `noteType`).
   *
   * The reported `id` is the raw `w:id`, which is unique only within its part
   * (document.xml / footnotes.xml / endnotes.xml) — it is NOT namespaced across
   * parts, so the same `id` can appear on a body change and a note change. Use
   * `noteType` / `noteId` to disambiguate.
   *
   * A returned change with `noteId`/`noteType` set can be accepted or rejected
   * by passing the whole {@link ReviewChange} back to {@link acceptChange} /
   * {@link rejectChange} (which resolves it inside its footnote/endnote), or in
   * bulk via {@link acceptAll} / {@link rejectAll} with the matching `include*`
   * option; the result persists on {@link toBuffer}.
   */
  getChanges(filter?: ChangeFilter): ReviewChange[] {
    return getChangesImpl(this.body, filter, {
      footnotes: this.doc.package.footnotes,
      endnotes: this.doc.package.endnotes,
    });
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

  /**
   * Remove a comment by ID. Removing a top-level comment also removes its
   * replies and the anchored range markers. Removing a reply only removes
   * that reply.
   * @param commentId - ID of the comment to remove
   */
  removeComment(commentId: number): void {
    removeCommentImpl(this.body, commentId);
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

  /**
   * Accept a tracked change. Pass a revision id to accept a change in the
   * document body, or pass a {@link ReviewChange} from {@link getChanges} to
   * accept it wherever it lives — a change carrying `noteId`/`noteType` is
   * resolved inside that footnote/endnote and persists on {@link toBuffer}.
   *
   * A bare numeric id targets the body only: a `w:id` is unique only within its
   * part, so the same id can appear on a body change and a note change. To
   * resolve a note change pass the whole {@link ReviewChange} (its
   * `noteId`/`noteType` locate it); a bare id resolves to the body change, if any.
   */
  acceptChange(target: number | ReviewChange): void {
    acceptChangeImpl(this.body, target, this.changeNotes());
  }

  /** Reject a tracked change. See {@link acceptChange} for body-vs-note targeting. */
  rejectChange(target: number | ReviewChange): void {
    rejectChangeImpl(this.body, target, this.changeNotes());
  }

  /**
   * Accept all tracked changes in the body. Pass `{ includeFootnotes,
   * includeEndnotes }` to also accept changes inside note bodies. Returns count.
   */
  acceptAll(opts?: AcceptChangesOptions): number {
    return acceptAllImpl(this.body, opts, this.changeNotes());
  }

  /** Reject all tracked changes. See {@link acceptAll} for the note opt-in. */
  rejectAll(opts?: AcceptChangesOptions): number {
    return rejectAllImpl(this.body, opts, this.changeNotes());
  }

  /** The package's note stores, passed to change ops so note changes resolve. */
  private changeNotes() {
    return { footnotes: this.doc.package.footnotes, endnotes: this.doc.package.endnotes };
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
    const { repackDocx } = await import('@eigenpal/docx-editor-core/headless');
    return repackDocx(this.doc);
  }
}
