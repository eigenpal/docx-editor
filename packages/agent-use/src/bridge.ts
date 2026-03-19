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

import type {
  ContentBlock,
  GetContentOptions,
  ReviewComment,
  ReviewChange,
  ChangeFilter,
  CommentFilter,
  AddCommentOptions,
  ReplyOptions,
  ProposeReplacementOptions,
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
    paragraphIndex: number;
    text: string;
    author: string;
    search?: string;
  }): number | null;
  replyToComment(commentId: number, text: string, author: string): number | null;
  resolveComment(commentId: number): void;
  proposeReplacement(options: {
    paragraphIndex: number;
    search: string;
    replaceWith: string;
    author: string;
  }): boolean;
  scrollToIndex(paragraphIndex: number): void;
  getComments(): Array<{
    id: number;
    author: string;
    date?: string;
    parentId?: number;
    content: unknown[];
    done?: boolean;
  }>;
}

export interface EditorBridge {
  /** Get document content as indexed text lines for LLM prompts. */
  getContentAsText(options?: GetContentOptions): string;
  /** Get document content as structured blocks. */
  getContent(options?: GetContentOptions): ContentBlock[];
  /** Get all comments in the document. */
  getComments(filter?: CommentFilter): ReviewComment[];
  /** Get all tracked changes in the document. */
  getChanges(filter?: ChangeFilter): ReviewChange[];
  /** Add a comment to a paragraph. Returns the comment ID or null on failure. */
  addComment(options: AddCommentOptions): number | null;
  /** Reply to an existing comment. Returns the reply ID or null. */
  replyTo(commentId: number, options: ReplyOptions): number | null;
  /** Resolve a comment (mark as done). */
  resolveComment(commentId: number): void;
  /** Replace text, creating a tracked change. Returns true on success. */
  replace(options: ProposeReplacementOptions): boolean;
  /** Scroll to a paragraph by index. */
  scrollTo(paragraphIndex: number): void;
}

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

    addComment(options: AddCommentOptions): number | null {
      return editorRef.addComment({
        paragraphIndex: options.paragraphIndex,
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

    replace(options: ProposeReplacementOptions): boolean {
      return editorRef.proposeReplacement({
        paragraphIndex: options.paragraphIndex,
        search: options.search,
        replaceWith: options.replaceWith,
        author: resolveAuthor(options.author),
      });
    },

    scrollTo(paragraphIndex: number): void {
      editorRef.scrollToIndex(paragraphIndex);
    },
  };
}
