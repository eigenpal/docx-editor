/**
 * @eigenpal/docx-editor-agents
 *
 * Word-like API for AI document review.
 *
 * @example
 * ```ts
 * const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');
 *
 * // Read
 * const text = reviewer.getContentAsText();
 *
 * // Comment on a paragraph
 * reviewer.addComment(5, 'Liability cap seems too low.');
 *
 * // Replace text (creates tracked change)
 * reviewer.replace(5, '$50k', '$500k');
 *
 * // Or batch from LLM JSON response
 * reviewer.applyReview({
 *   comments: [{ paragraphIndex: 5, text: 'Too low.' }],
 *   proposals: [{ paragraphIndex: 5, search: '$50k', replaceWith: '$500k' }],
 * });
 *
 * const output = await reviewer.toBuffer();
 * ```
 */

export { DocxReviewer } from './DocxReviewer';

export type {
  // Content
  ContentBlock,
  GetContentOptions,
  // Discovery
  ReviewChange,
  ReviewComment,
  // Batch (main LLM interface)
  BatchReviewOptions,
  BatchResult,
  BatchError,
} from './types';

export { TextNotFoundError, ChangeNotFoundError, CommentNotFoundError } from './errors';
