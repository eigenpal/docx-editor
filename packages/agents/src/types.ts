/**
 * Types for @eigenpal/docx-editor-agents
 */

// ============================================================================
// CONTENT BLOCKS — what getContent() returns
// ============================================================================

export interface HeadingBlock {
  type: 'heading';
  index: number;
  /** Stable Word `w14:paraId`. Use this as the anchor for live-editor operations. */
  paraId?: string;
  level: number;
  text: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  index: number;
  /** Stable Word `w14:paraId`. Use this as the anchor for live-editor operations. */
  paraId?: string;
  text: string;
}

export interface TableCellBlock {
  type: 'table-cell';
  index: number;
  /** Stable Word `w14:paraId` of the cell's first paragraph. */
  paraId?: string;
  row: number;
  col: number;
  text: string;
}

export interface TableBlock {
  type: 'table';
  index: number;
  rows: string[][];
  /** Per-cell paraIds, parallel to `rows`. cells[r][c] is the first paraId in that cell. */
  cellParaIds?: (string | undefined)[][];
}

export interface ListItemBlock {
  type: 'list-item';
  index: number;
  /** Stable Word `w14:paraId`. Use this as the anchor for live-editor operations. */
  paraId?: string;
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

/**
 * Live-editor (bridge) action options — anchored by Word `w14:paraId`.
 * Stable across edits; the agent gets paraIds from `read_document` / `find_text`.
 */
export interface AddCommentByParaIdOptions {
  paraId: string;
  text: string;
  author?: string;
  /** Optional: anchor to a specific phrase within the paragraph (must be unique). */
  search?: string;
}

/**
 * Headless / DocxReviewer action options — anchored by ordinal paragraph index.
 * Used by the static-document review pipeline.
 */
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

/**
 * Live-editor change. Pass `replaceWith: ''` to delete; pass `search: ''` to
 * insert at end of paragraph; pass both non-empty for a replacement.
 */
export interface ProposeChangeOptions {
  paraId: string;
  search: string;
  replaceWith: string;
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

/** Per-match handle returned by `findText` — pass `paraId` + `match` back as `search`. */
export interface FoundMatch {
  paraId: string;
  match: string;
  before: string;
  after: string;
}

/** Snapshot of the user's current selection / cursor. */
export interface SelectionInfo {
  paraId: string | null;
  selectedText: string;
  paragraphText: string;
  before: string;
  after: string;
}

/**
 * Character formatting marks the agent can apply.
 *
 * Mirrors Word JS API `Range.font.*`. A `false` value clears that mark in the
 * range; a missing key leaves it untouched. `color.themeColor` follows ECMA-376
 * theme color values (e.g. `'accent1'`, `'text1'`) and resolves at render time.
 */
export interface CharacterFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean | { style?: string };
  strike?: boolean;
  color?: { rgb?: string; themeColor?: string };
  highlight?: string;
  fontSize?: number;
  fontFamily?: { ascii?: string; hAnsi?: string };
}

/**
 * Apply character formatting to a range. `paraId` is required; if `search`
 * is provided, the formatting only applies to that phrase within the
 * paragraph (must match exactly once). Otherwise it applies to the whole
 * paragraph's text.
 */
export interface ApplyFormattingOptions {
  paraId: string;
  search?: string;
  marks: CharacterFormatting;
}

/**
 * Apply a paragraph style by `styleId` (e.g. `'Heading1'`, `'Title'`,
 * `'Quote'`). The styleId must exist in the document's style definitions
 * — unknown ids are no-ops.
 */
export interface SetParagraphStyleOptions {
  paraId: string;
  styleId: string;
}

/** A single paragraph anchored on a page (returned by `getPage` / `getPages`). */
export interface PageParagraph {
  paraId: string;
  text: string;
  /** True for headings, list items, and other styled blocks. */
  styleId?: string;
}

/** What the agent sees when reading one or more pages. */
export interface PageContent {
  /** 1-indexed page number. */
  pageNumber: number;
  /** Plain text of the page, formatted as `[paraId] text` lines. */
  text: string;
  /** Paragraphs on the page, in document order. */
  paragraphs: PageParagraph[];
}

/**
 * Snapshot of what the user is looking at — pass this to your agent's system
 * prompt so it knows the current selection / page without an extra
 * `read_selection` round-trip.
 */
export interface AgentContextSnapshot {
  /** User's current selection or cursor (null if editor isn't focused). */
  selection: SelectionInfo | null;
  /** 1-indexed page the cursor / selection is on. 0 if unknown. */
  currentPage: number;
  /** Total number of pages currently rendered. */
  totalPages: number;
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
