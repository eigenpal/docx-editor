/**
 * @eigenpal/docx-editor-agent-use
 *
 * Agent-friendly API for DOCX document review.
 * Headless — no DOM or React dependencies.
 *
 * @example
 * ```ts
 * import { DocxReviewer } from '@eigenpal/docx-editor-agent-use';
 *
 * const reviewer = await DocxReviewer.fromBuffer(buffer);
 * const content = reviewer.getContent();
 * const changes = reviewer.getChanges();
 *
 * reviewer.addComment({ paragraphIndex: 5, author: 'AI', text: 'Liability cap too low.' });
 * reviewer.proposeReplacement({ paragraphIndex: 5, search: '$50,000', author: 'AI', replaceWith: '$500,000' });
 * reviewer.acceptChange(1);
 *
 * const output = await reviewer.toBuffer();
 * ```
 */

// Main class
export { DocxReviewer } from './DocxReviewer';

// Types
export type {
  ContentBlock,
  HeadingBlock,
  ParagraphBlock,
  TableBlock,
  ListItemBlock,
  GetContentOptions,
  ReviewChange,
  ReviewComment,
  ReviewCommentReply,
  ChangeFilter,
  CommentFilter,
  AddCommentOptions,
  ReplyOptions,
  ProposeReplacementOptions,
  ProposeInsertionOptions,
  ProposeDeletionOptions,
  BatchReviewOptions,
  BatchResult,
  BatchError,
} from './types';

// Errors
export { TextNotFoundError, ChangeNotFoundError, CommentNotFoundError } from './errors';
