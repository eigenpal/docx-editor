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
  fromIndex?: number;
  toIndex?: number;
  /** Annotate tracked changes inline. Default: true */
  includeTrackedChanges?: boolean;
  /** Annotate comments inline. Default: true */
  includeCommentAnchors?: boolean;
}

// ============================================================================
// DISCOVERY — what getChanges() / getComments() return
// ============================================================================

export interface ReviewChange {
  id: number;
  type: 'insertion' | 'deletion' | 'moveFrom' | 'moveTo';
  author: string;
  date: string | null;
  text: string;
  context: string;
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
  text: string;
  anchoredText: string;
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
// ACTION OPTIONS — author is optional (falls back to reviewer default)
// ============================================================================

export interface AddCommentOptions {
  paragraphIndex: number;
  text: string;
  author?: string;
  /** Optional: anchor to specific text. Omit to anchor whole paragraph. */
  search?: string;
}

export interface ReplyOptions {
  text: string;
  author?: string;
}

export interface ProposeReplacementOptions {
  paragraphIndex: number;
  search: string;
  replaceWith: string;
  author?: string;
}

export interface ProposeInsertionOptions {
  paragraphIndex: number;
  insertText: string;
  author?: string;
  position?: 'before' | 'after';
  search?: string;
}

export interface ProposeDeletionOptions {
  paragraphIndex: number;
  search: string;
  author?: string;
}

// ============================================================================
// BATCH — the main LLM-facing interface
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
