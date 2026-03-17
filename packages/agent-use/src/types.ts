/**
 * Types for @eigenpal/docx-editor-agents
 */

// ============================================================================
// CONTENT BLOCKS — what getContent() returns
// ============================================================================

export interface HeadingBlock {
  type: 'heading';
  index: number;
  level: number;
  text: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  index: number;
  text: string;
}

export interface TableBlock {
  type: 'table';
  index: number;
  rows: string[][];
}

export interface ListItemBlock {
  type: 'list-item';
  index: number;
  text: string;
  listLevel: number;
  listType: 'bullet' | 'number';
}

export type ContentBlock = HeadingBlock | ParagraphBlock | TableBlock | ListItemBlock;

export interface GetContentOptions {
  /** Start index (inclusive). Omit to start from beginning. */
  fromIndex?: number;
  /** End index (inclusive). Omit to read to end. */
  toIndex?: number;
  /** Annotate tracked changes inline as [+text+]{by:author} / [-text-]{by:author}. Default: true */
  includeTrackedChanges?: boolean;
  /** Annotate comments inline as [comment:id]text[/comment]. Default: true */
  includeCommentAnchors?: boolean;
}

// ============================================================================
// DISCOVERY — what getChanges() / getComments() return
// ============================================================================

export interface ReviewChange {
  /** OOXML revision ID */
  id: number;
  type: 'insertion' | 'deletion' | 'moveFrom' | 'moveTo';
  author: string;
  date: string | null;
  /** The affected text content */
  text: string;
  /** Full paragraph plain text for context */
  context: string;
  /** Index of the containing paragraph */
  paragraphIndex: number;
}

export interface ReviewCommentReply {
  id: number;
  author: string;
  date: string | null;
  text: string;
}

export interface ReviewComment {
  id: number;
  author: string;
  date: string | null;
  /** Comment body as plain text */
  text: string;
  /** Document text the comment is attached to */
  anchoredText: string;
  /** Index of the paragraph containing the anchor */
  paragraphIndex: number;
  replies: ReviewCommentReply[];
  done: boolean;
}

export interface ChangeFilter {
  author?: string;
  type?: 'insertion' | 'deletion' | 'moveFrom' | 'moveTo';
}

export interface CommentFilter {
  author?: string;
  done?: boolean;
}

// ============================================================================
// ACTION OPTIONS
// ============================================================================

export interface AddCommentOptions {
  paragraphIndex: number;
  author: string;
  text: string;
  /** Optional: anchor to specific text within the paragraph. Omit to anchor whole paragraph. */
  search?: string;
}

export interface ReplyOptions {
  author: string;
  text: string;
}

export interface ProposeReplacementOptions {
  paragraphIndex: number;
  search: string;
  author: string;
  replaceWith: string;
}

export interface ProposeInsertionOptions {
  paragraphIndex: number;
  author: string;
  insertText: string;
  /** Insert before or after. Default: 'after' */
  position?: 'before' | 'after';
  /** Optional: insert adjacent to this text within the paragraph */
  search?: string;
}

export interface ProposeDeletionOptions {
  paragraphIndex: number;
  search: string;
  author: string;
}

// ============================================================================
// BATCH
// ============================================================================

export interface BatchReviewOptions {
  accept?: number[];
  reject?: number[];
  comments?: AddCommentOptions[];
  replies?: (ReplyOptions & { commentId: number })[];
  proposals?: ProposeReplacementOptions[];
}

export interface BatchError {
  operation: string;
  id?: number;
  search?: string;
  error: string;
}

export interface BatchResult {
  accepted: number;
  rejected: number;
  commentsAdded: number;
  repliesAdded: number;
  proposalsAdded: number;
  errors: BatchError[];
}
