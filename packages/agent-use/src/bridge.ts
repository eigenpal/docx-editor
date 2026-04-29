/**
 * Editor Bridge — connects agent tools to a live DocxEditor instance.
 *
 * Separate entry point: import from '@eigenpal/docx-editor-agents/bridge'
 *
 * @example
 * ```ts
 * import { createEditorBridge, useAgentChat } from '@eigenpal/docx-editor-agents/bridge';
 *
 * // Hook (React) — simplest way
 * const { executeToolCall, toolSchemas } = useAgentChat({ editorRef, author: 'Assistant' });
 *
 * // Manual
 * const bridge = createEditorBridge(editorRef, 'Assistant');
 * bridge.addComment({ paragraphIndex: 3, text: 'Fix this.' });
 * ```
 */

// Re-export hook and tools for convenience
export { useAgentChat, type UseAgentChatOptions, type UseAgentChatReturn } from './useAgentChat';
export { agentTools, executeToolCall, getToolSchemas } from './tools';
export type { AgentToolDefinition, AgentToolResult } from './tools';
export { createReviewerBridge } from './reviewerBridge';

import type {
  ContentBlock,
  GetContentOptions,
  ReviewComment,
  ReviewChange,
  ChangeFilter,
  CommentFilter,
  AddCommentByParaIdOptions,
  ReplyOptions,
  ProposeChangeOptions,
  FoundMatch,
  SelectionInfo,
  ApplyFormattingOptions,
  SetParagraphStyleOptions,
  PageContent,
} from './types';
import { getContent, formatContentForLLM } from './content';
import { getChanges, getComments } from './discovery';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Minimal DocxEditorRef interface — only the methods the bridge needs.
 * This avoids importing the full React package at type level.
 */
export interface EditorRefLike {
  getDocument(): unknown | null;
  getEditorRef(): { getDocument(): unknown | null } | null;
  addComment(options: {
    paraId: string;
    text: string;
    author: string;
    search?: string;
  }): number | null;
  replyToComment(commentId: number, text: string, author: string): number | null;
  resolveComment(commentId: number): void;
  proposeChange(options: {
    paraId: string;
    search: string;
    replaceWith: string;
    author: string;
  }): boolean;
  scrollToParaId(paraId: string): boolean;
  findInDocument(
    query: string,
    options?: { caseSensitive?: boolean; limit?: number }
  ): FoundMatch[];
  getSelectionInfo(): SelectionInfo | null;
  getComments(): Array<{
    id: number;
    author: string;
    date?: string;
    parentId?: number;
    content: unknown[];
    done?: boolean;
  }>;
  /** Apply character formatting to a paragraph or sub-range. Returns false on missing paraId / ambiguous search. */
  applyFormatting(options: {
    paraId: string;
    search?: string;
    marks: import('./types').CharacterFormatting;
  }): boolean;
  /** Apply a paragraph style by styleId. Returns false if paraId is unknown. */
  setParagraphStyle(options: { paraId: string; styleId: string }): boolean;
  /** Read a single page's paragraphs (1-indexed). Returns null if the page does not exist. */
  getPageContent(pageNumber: number): PageContent | null;
  /** Total number of pages currently rendered. */
  getTotalPages(): number;
  /** 1-indexed page the user's cursor / selection is on. 0 if unknown. */
  getCurrentPage(): number;
  onContentChange(listener: (doc: unknown) => void): () => void;
  onSelectionChange(listener: (selection: unknown) => void): () => void;
}

export interface EditorBridge {
  /** Get document content as paraId-tagged text lines for LLM prompts. */
  getContentAsText(options?: GetContentOptions): string;
  /** Get document content as structured blocks (each paragraph carries its `paraId`). */
  getContent(options?: GetContentOptions): ContentBlock[];
  /** Get all comments in the document. */
  getComments(filter?: CommentFilter): ReviewComment[];
  /** Get all tracked changes in the document. */
  getChanges(filter?: ChangeFilter): ReviewChange[];
  /** Locate text in the document. Returns one handle per matching paragraph. */
  findText(query: string, options?: { caseSensitive?: boolean; limit?: number }): FoundMatch[];
  /** Read the user's current cursor / selection. */
  getSelection(): SelectionInfo | null;
  /** Add a comment, anchored to a paragraph by paraId. */
  addComment(options: AddCommentByParaIdOptions): number | null;
  /** Reply to an existing comment. Returns the reply ID or null. */
  replyTo(commentId: number, options: ReplyOptions): number | null;
  /** Resolve a comment (mark as done). */
  resolveComment(commentId: number): void;
  /** Suggest a tracked change. `replaceWith=''` deletes; `search=''` inserts at paragraph end. */
  proposeChange(options: ProposeChangeOptions): boolean;
  /**
   * Apply character formatting (bold / italic / color / size / font / etc.)
   * to a paragraph, or to a unique phrase within it. This is a direct edit —
   * not a tracked change.
   */
  applyFormatting(options: ApplyFormattingOptions): boolean;
  /**
   * Apply a paragraph style by styleId (e.g. `'Heading1'`, `'Quote'`).
   * Direct edit, not a tracked change.
   */
  setParagraphStyle(options: SetParagraphStyleOptions): boolean;
  /** Read a single page (1-indexed). Returns null if the page does not exist. */
  getPage(pageNumber: number): PageContent | null;
  /** Read a range of pages (1-indexed, inclusive). Out-of-range pages are skipped. */
  getPages(options: { from: number; to: number }): PageContent[];
  /** Total number of pages currently rendered in the editor. */
  getTotalPages(): number;
  /** 1-indexed page the user's cursor / selection is on. 0 if unknown. */
  getCurrentPage(): number;
  /** Scroll the editor to a paragraph by paraId. */
  scrollTo(paraId: string): boolean;
  /** Subscribe to document content changes. Returns an unsubscribe function. */
  onContentChange(listener: (event: ContentChangeEvent) => void): () => void;
  /** Subscribe to selection changes (cursor moves / selection changes). Returns an unsubscribe function. */
  onSelectionChange(listener: (event: SelectionChangeEvent) => void): () => void;
}

/** Event payload for `onContentChange`. */
export interface ContentChangeEvent {
  /** Total comments in the document after the change. */
  commentCount: number;
  /** Total tracked changes after the change. */
  changeCount: number;
  /** Snapshot of all current comments. */
  comments: ReviewComment[];
  /** Snapshot of all current tracked changes. */
  changes: ReviewChange[];
}

/** Event payload for `onSelectionChange`. */
export type SelectionChangeEvent = SelectionInfo | null;

// ── Implementation ──────────────────────────────────────────────────────────

/** Extract plain text from a Comment's content paragraphs. */
function getCommentText(content: unknown[]): string {
  if (!content || content.length === 0) return '';
  // Comment content is Paragraph[] — each paragraph has runs with text
  return content
    .map((para) => {
      const p = para as { content?: Array<{ content?: Array<{ text?: string }> }> };
      if (!p?.content) return '';
      return p.content.map((run) => run.content?.map((t) => t.text || '').join('') || '').join('');
    })
    .join('\n');
}

/**
 * Get the DocumentBody from the editor ref, using the live PM state.
 */
function getDocumentBody(
  editorRef: EditorRefLike
): import('@eigenpal/docx-core/headless').DocumentBody | null {
  // Prefer the live PM-based document (reflects user edits)
  const pagedRef = editorRef.getEditorRef();
  if (pagedRef) {
    const doc = pagedRef.getDocument() as import('@eigenpal/docx-core/headless').Document | null;
    if (doc?.package?.document) return doc.package.document;
  }
  // Fallback to the initial document
  const doc = editorRef.getDocument() as import('@eigenpal/docx-core/headless').Document | null;
  return doc?.package?.document ?? null;
}

/**
 * Create an EditorBridge from a DocxEditorRef.
 *
 * @param editorRef - A DocxEditorRef (or anything matching EditorRefLike)
 * @param author - Default author name for comments and changes. (default: 'AI')
 */
export function createEditorBridge(editorRef: EditorRefLike, author = 'AI'): EditorBridge {
  function resolveAuthor(a?: string): string {
    return a ?? author;
  }

  return {
    getContentAsText(options?: GetContentOptions): string {
      const body = getDocumentBody(editorRef);
      if (!body) return '';
      return formatContentForLLM(getContent(body, options));
    },

    getContent(options?: GetContentOptions): ContentBlock[] {
      const body = getDocumentBody(editorRef);
      if (!body) return [];
      return getContent(body, options);
    },

    getComments(filter?: CommentFilter): ReviewComment[] {
      const body = getDocumentBody(editorRef);
      if (!body) return [];

      // Prefer doc-level comments (include anchor/paragraph info)
      const docComments = getComments(body, filter);
      if (docComments.length > 0) return docComments;

      // Fallback: build from live editor state (for comments added via bridge)
      const liveComments = editorRef.getComments();
      if (liveComments.length === 0) return [];

      // Pre-group replies by parentId (O(n) instead of O(n^2))
      const repliesByParent = new Map<number, typeof liveComments>();
      const topLevel: typeof liveComments = [];
      for (const c of liveComments) {
        if (c.parentId) {
          const arr = repliesByParent.get(c.parentId);
          if (arr) arr.push(c);
          else repliesByParent.set(c.parentId, [c]);
        } else {
          topLevel.push(c);
        }
      }

      const result: ReviewComment[] = [];
      for (const c of topLevel) {
        if (filter?.author && c.author !== filter.author) continue;
        if (filter?.done !== undefined && (c.done ?? false) !== filter.done) continue;
        const replies = repliesByParent.get(c.id) ?? [];
        result.push({
          id: c.id,
          author: c.author,
          date: c.date ?? null,
          text: getCommentText(c.content),
          anchoredText: '',
          paragraphIndex: -1,
          replies: replies.map((r) => ({
            id: r.id,
            author: r.author,
            date: r.date ?? null,
            text: getCommentText(r.content),
          })),
          done: c.done ?? false,
        });
      }
      return result;
    },

    getChanges(filter?: ChangeFilter): ReviewChange[] {
      const body = getDocumentBody(editorRef);
      if (!body) return [];
      return getChanges(body, filter);
    },

    findText(query, options): FoundMatch[] {
      return editorRef.findInDocument(query, options);
    },

    getSelection(): SelectionInfo | null {
      return editorRef.getSelectionInfo();
    },

    addComment(options: AddCommentByParaIdOptions): number | null {
      return editorRef.addComment({
        paraId: options.paraId,
        text: options.text,
        author: resolveAuthor(options.author),
        search: options.search,
      });
    },

    replyTo(commentId: number, options: ReplyOptions): number | null {
      return editorRef.replyToComment(commentId, options.text, resolveAuthor(options.author));
    },

    resolveComment(commentId: number): void {
      editorRef.resolveComment(commentId);
    },

    proposeChange(options: ProposeChangeOptions): boolean {
      return editorRef.proposeChange({
        paraId: options.paraId,
        search: options.search,
        replaceWith: options.replaceWith,
        author: resolveAuthor(options.author),
      });
    },

    applyFormatting(options: ApplyFormattingOptions): boolean {
      return editorRef.applyFormatting({
        paraId: options.paraId,
        search: options.search,
        marks: options.marks,
      });
    },

    setParagraphStyle(options: SetParagraphStyleOptions): boolean {
      return editorRef.setParagraphStyle({
        paraId: options.paraId,
        styleId: options.styleId,
      });
    },

    getPage(pageNumber: number): PageContent | null {
      return editorRef.getPageContent(pageNumber);
    },

    getPages(options: { from: number; to: number }): PageContent[] {
      const total = editorRef.getTotalPages();
      const from = Math.max(1, Math.min(options.from, total));
      const to = Math.max(from, Math.min(options.to, total));
      const pages: PageContent[] = [];
      for (let n = from; n <= to; n++) {
        const p = editorRef.getPageContent(n);
        if (p) pages.push(p);
      }
      return pages;
    },

    getTotalPages(): number {
      return editorRef.getTotalPages();
    },

    getCurrentPage(): number {
      return editorRef.getCurrentPage();
    },

    scrollTo(paraId: string): boolean {
      return editorRef.scrollToParaId(paraId);
    },

    onContentChange(listener) {
      return editorRef.onContentChange(() => {
        const body = getDocumentBody(editorRef);
        const comments = body ? getComments(body) : [];
        const changes = body ? getChanges(body) : [];
        try {
          listener({
            commentCount: comments.length,
            changeCount: changes.length,
            comments,
            changes,
          });
        } catch (e) {
          console.error('onContentChange listener threw:', e);
        }
      });
    },

    onSelectionChange(listener) {
      return editorRef.onSelectionChange(() => {
        try {
          listener(editorRef.getSelectionInfo());
        } catch (e) {
          console.error('onSelectionChange listener threw:', e);
        }
      });
    },
  };
}
