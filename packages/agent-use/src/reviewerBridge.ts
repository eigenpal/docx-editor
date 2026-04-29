/**
 * Reviewer bridge — wraps a `DocxReviewer` (static document) in the same
 * `EditorBridge` interface the live editor exposes. Lets the same MCP server
 * / agent tools operate on a parsed-from-disk DOCX without a running editor.
 *
 * Trade-offs vs. the live bridge:
 *  - `getSelection()` always returns `null` (no user, no selection).
 *  - `scrollTo()` is a no-op that returns `true` (the doc isn't being viewed).
 *  - `onSelectionChange` listeners never fire (returned unsubscribers are no-ops).
 *  - `onContentChange` fires after every successful mutation through this bridge,
 *    so MCP clients still get notifications when the agent is the only writer.
 *  - paraId resolution maps to `paragraphIndex` by walking the document body
 *    once. None of the reviewer's mutators (`addComment`, `proposeChange`,
 *    `replyTo`, `resolveComment`) shift top-level indices, so the map is
 *    cached for the bridge's lifetime.
 *
 * After the agent finishes mutating, call `reviewer.toBuffer()` to serialize
 * back to DOCX. The bridge does NOT do that automatically — the host decides
 * when to flush.
 */

import type { DocxReviewer } from './DocxReviewer';
import type {
  AddCommentByParaIdOptions,
  ChangeFilter,
  CommentFilter,
  ContentBlock,
  FoundMatch,
  GetContentOptions,
  ProposeChangeOptions,
  ReplyOptions,
  ReviewChange,
  ReviewComment,
  SelectionInfo,
} from './types';
import type { ContentChangeEvent, EditorBridge } from './bridge';
import type { Paragraph } from '@eigenpal/docx-core/headless';

/**
 * Build the paraId → top-level paragraphIndex map. Counting mirrors
 * `forEachParagraph` / `getParagraphAtIndex` in utils.ts so the lookup
 * stays consistent with the reviewer's own walker.
 */
function buildParaIdMap(reviewer: DocxReviewer): Map<string, number> {
  const body = reviewer.toDocument().package?.document;
  if (!body) return new Map();

  const map = new Map<string, number>();
  let index = 0;

  // Counting must mirror utils.ts forEachParagraph / getParagraphAtIndex:
  // top-level paragraph counts 1, table advances by inner cell-paragraph count,
  // any other top-level block (BlockSdt, sectPr, etc.) counts 1.
  for (const block of body.content) {
    if (block.type === 'paragraph') {
      const paraId = (block as Paragraph).paraId;
      if (paraId) map.set(paraId, index);
      index++;
    } else if (block.type === 'table') {
      // Cell paragraphs advance the index but aren't directly addressable in
      // the reviewer surface (DocxReviewer's APIs are top-level-paragraphIndex
      // based; cell-targeted mutations are a follow-up).
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.content) {
            if (cellBlock.type === 'paragraph') index++;
          }
        }
      }
    } else {
      index++;
    }
  }

  return map;
}

/**
 * Extract the vanilla plain text of a paragraph: plain runs + hyperlink runs +
 * deletion / moveFrom content (still in the doc until accepted), with
 * insertions / moveTo hidden. Matches the view the agent reads via
 * `read_document`, so `findText` surfaces the same phrases that `addComment` /
 * `proposeChange` can anchor.
 */
function getParagraphPlainText(p: Paragraph): string {
  const parts: string[] = [];
  const pushRunText = (run: { content: Array<{ type: string; text?: string }> }) => {
    for (const r of run.content) {
      if (r.type === 'text') parts.push(r.text ?? '');
    }
  };
  for (const item of p.content) {
    if (item.type === 'run') {
      pushRunText(item);
    } else if (item.type === 'hyperlink') {
      for (const child of item.children) {
        if (child.type === 'run') pushRunText(child);
      }
    } else if (item.type === 'deletion' || item.type === 'moveFrom') {
      for (const child of item.content) {
        if (child.type === 'run') {
          pushRunText(child);
        } else if (child.type === 'hyperlink') {
          for (const hc of child.children) {
            if (hc.type === 'run') pushRunText(hc);
          }
        }
      }
    }
  }
  return parts.join('');
}

/**
 * Create an EditorBridge backed by a DocxReviewer. The agent (or MCP client)
 * can read, comment, propose changes, etc., against a parsed DOCX file on
 * disk. Call `reviewer.toBuffer()` afterwards to get the modified DOCX.
 *
 * @param reviewer - A DocxReviewer instance. The bridge mutates it in place.
 */
export function createReviewerBridge(reviewer: DocxReviewer): EditorBridge {
  // Content-change listeners fan out from successful mutations. Selection
  // listeners never fire in headless mode (no user, no caret) — the
  // unsubscribe is a no-op.
  const contentListeners = new Set<(e: ContentChangeEvent) => void>();

  // (paraId → paragraphIndex) cache. None of the reviewer's current mutators
  // insert/remove top-level body blocks — they mutate paragraph content and
  // append to body.comments — so the index map is invariant under the
  // mutators we expose. Build once, lazy.
  let cache: Map<string, number> | null = null;
  function map(): Map<string, number> {
    if (cache === null) cache = buildParaIdMap(reviewer);
    return cache;
  }

  function emitContentChange(): void {
    if (contentListeners.size === 0) return;
    const comments = reviewer.getComments();
    const changes = reviewer.getChanges();
    const event: ContentChangeEvent = {
      commentCount: comments.length,
      changeCount: changes.length,
      comments,
      changes,
    };
    for (const cb of contentListeners) {
      try {
        cb(event);
      } catch (e) {
        console.error('reviewerBridge content listener threw:', e);
      }
    }
  }

  return {
    getContentAsText(options?: GetContentOptions): string {
      return reviewer.getContentAsText(options);
    },

    getContent(options?: GetContentOptions): ContentBlock[] {
      return reviewer.getContent(options);
    },

    getComments(filter?: CommentFilter): ReviewComment[] {
      return reviewer.getComments(filter);
    },

    getChanges(filter?: ChangeFilter): ReviewChange[] {
      return reviewer.getChanges(filter);
    },

    findText(query, options): FoundMatch[] {
      if (!query) return [];
      const caseSensitive = options?.caseSensitive ?? false;
      const limit = options?.limit ?? 20;
      const needle = caseSensitive ? query : query.toLowerCase();

      const body = reviewer.toDocument().package?.document;
      if (!body) return [];

      const matches: FoundMatch[] = [];
      const CONTEXT = 40;

      for (const block of body.content) {
        if (matches.length >= limit) break;
        if (block.type !== 'paragraph') continue;
        const para = block as Paragraph;
        if (!para.paraId) continue;
        const text = getParagraphPlainText(para);
        const haystack = caseSensitive ? text : text.toLowerCase();
        const at = haystack.indexOf(needle);
        if (at === -1) continue;
        // Ambiguous matches in a single paragraph: skip — agent must narrow.
        if (haystack.indexOf(needle, at + 1) !== -1) continue;
        const match = text.slice(at, at + query.length);
        matches.push({
          paraId: para.paraId,
          match,
          before: text.slice(Math.max(0, at - CONTEXT), at),
          after: text.slice(at + query.length, at + query.length + CONTEXT),
        });
      }
      return matches;
    },

    /** Headless mode: no live cursor. Returns null. */
    getSelection(): SelectionInfo | null {
      return null;
    },

    addComment(options: AddCommentByParaIdOptions): number | null {
      const idx = map().get(options.paraId);
      if (idx === undefined) return null;
      try {
        const id = reviewer.addComment({
          paragraphIndex: idx,
          text: options.text,
          author: options.author,
          search: options.search,
        });
        emitContentChange();
        return id;
      } catch {
        return null;
      }
    },

    replyTo(commentId: number, options: ReplyOptions): number | null {
      try {
        const id = reviewer.replyTo(commentId, options);
        emitContentChange();
        return id;
      } catch {
        return null;
      }
    },

    /** Mark a comment resolved. DocxReviewer doesn't expose this directly,
     * so we mutate the body's comment record in place. */
    resolveComment(commentId: number): void {
      const body = reviewer.toDocument().package?.document;
      const comment = body?.comments?.find((c) => c.id === commentId);
      if (comment) {
        comment.done = true;
        emitContentChange();
      }
    },

    proposeChange(options: ProposeChangeOptions): boolean {
      const idx = map().get(options.paraId);
      if (idx === undefined) return false;

      const isInsertion = options.search === '';
      const isDeletion = options.replaceWith === '';
      if (isInsertion && isDeletion) return false;

      try {
        if (isInsertion) {
          // Insert at end of paragraph.
          reviewer.proposeInsertion({
            paragraphIndex: idx,
            insertText: options.replaceWith,
            author: options.author,
          });
        } else if (isDeletion) {
          reviewer.proposeDeletion({
            paragraphIndex: idx,
            search: options.search,
            author: options.author,
          });
        } else {
          reviewer.replace({
            paragraphIndex: idx,
            search: options.search,
            replaceWith: options.replaceWith,
            author: options.author,
          });
        }
        emitContentChange();
        return true;
      } catch {
        return false;
      }
    },

    /** Headless mode: no viewport to scroll. Reports success if paraId exists. */
    scrollTo(paraId: string): boolean {
      return map().has(paraId);
    },

    /**
     * Headless mode: character formatting mutations on a parsed Document model
     * are not yet implemented. The live editor bridge supports this — the
     * static reviewer will gain it in a follow-up.
     */
    applyFormatting(): boolean {
      return false;
    },

    /**
     * Headless mode: paragraph style mutations on a parsed Document model
     * are not yet implemented. The live editor bridge supports this — the
     * static reviewer will gain it in a follow-up.
     */
    setParagraphStyle(): boolean {
      return false;
    },

    /** Headless mode: pages are a layout concept; the static document has none. */
    getPage(): null {
      return null;
    },

    /** Headless mode: no layout, no pages. */
    getPages(): never[] {
      return [];
    },

    /** Headless mode: no layout, no pages. */
    getTotalPages(): number {
      return 0;
    },

    /** Headless mode: no cursor, no current page. */
    getCurrentPage(): number {
      return 0;
    },

    onContentChange(listener) {
      contentListeners.add(listener);
      return () => {
        contentListeners.delete(listener);
      };
    },

    /** Headless mode: selections never change. Returned unsubscribe is a no-op. */
    onSelectionChange() {
      return () => undefined;
    },
  };
}
