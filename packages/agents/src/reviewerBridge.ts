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
  CharacterFormatting,
} from './types';
import type { ContentChangeEvent, EditorBridge } from './bridge';
import type {
  Hyperlink,
  Paragraph,
  ParagraphContent,
  Run,
  RunContent,
  StyleDefinitions,
  TextFormatting,
} from '@eigenpal/docx-editor-core/headless';
import { mapHexToHighlightName, pointsToHalfPoints } from '@eigenpal/docx-editor-core/headless';
import { getParagraphAtIndex } from './utils';
import { CommentNotFoundError } from './errors';

/**
 * Build the paraId → top-level paragraphIndex map. Counting mirrors
 * `forEachParagraph` / `getParagraphAtIndex` in utils.ts so the lookup
 * stays consistent with the reviewer's own walker.
 *
 * A paragraph that lacks a `w14:paraId` is keyed by its ordinal index as a
 * string. This mirrors `formatContentForLLM` (content.ts), whose `read_document`
 * output labels such paragraphs `[<index>]` rather than `[<paraId>]` — so the
 * id the agent is handed always resolves here. Without this, a document with no
 * paraIds (Word doesn't always emit them) advertises ids the mutate tools then
 * reject. The index space is identical to `getContent`, so the string key and
 * the label match exactly.
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
      map.set(paraId ?? String(index), index);
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

type RunParent = Array<Run | ParagraphContent | Hyperlink['children'][number]>;

interface TextLeaf {
  run: Run;
  parent: RunParent;
  index: number;
  text: string;
  start: number;
  end: number;
}

function cloneRunWithText(run: Run, text: string): Run {
  const content: RunContent[] = [{ type: 'text', text, preserveSpace: /^\s|\s$/.test(text) }];
  const clone: Run = { type: 'run', content };
  if (run.formatting) clone.formatting = { ...run.formatting };
  if (run.propertyChanges) clone.propertyChanges = [...run.propertyChanges];
  return clone;
}

function getRunPlainText(run: Run): string {
  return run.content.map((item) => (item.type === 'text' ? item.text : '')).join('');
}

function collectRunLeaves(
  run: Run,
  parent: RunParent,
  index: number,
  leaves: TextLeaf[],
  offset: { value: number }
): void {
  const text = getRunPlainText(run);
  if (!text) return;
  const start = offset.value;
  const end = start + text.length;
  leaves.push({ run, parent, index, text, start, end });
  offset.value = end;
}

function collectHyperlinkLeaves(
  hyperlink: Hyperlink,
  leaves: TextLeaf[],
  offset: { value: number }
): void {
  hyperlink.children.forEach((child, index) => {
    if (child.type === 'run') {
      collectRunLeaves(child, hyperlink.children as RunParent, index, leaves, offset);
    }
  });
}

function collectFormattingLeaves(
  paragraph: Paragraph,
  includeTrackedInsertions: boolean
): TextLeaf[] {
  const leaves: TextLeaf[] = [];
  const offset = { value: 0 };

  paragraph.content.forEach((item, index) => {
    if (item.type === 'run') {
      collectRunLeaves(item, paragraph.content as RunParent, index, leaves, offset);
    } else if (item.type === 'hyperlink') {
      collectHyperlinkLeaves(item, leaves, offset);
    } else if (
      item.type === 'deletion' ||
      item.type === 'moveFrom' ||
      (includeTrackedInsertions && (item.type === 'insertion' || item.type === 'moveTo'))
    ) {
      item.content.forEach((child, childIndex) => {
        if (child.type === 'run') {
          collectRunLeaves(child, item.content as RunParent, childIndex, leaves, offset);
        } else if (child.type === 'hyperlink') {
          collectHyperlinkLeaves(child, leaves, offset);
        }
      });
    }
  });

  return leaves;
}

function applyMarksToFormatting(
  formatting: TextFormatting | undefined,
  marks: CharacterFormatting
): TextFormatting | undefined {
  const next: TextFormatting = { ...(formatting ?? {}) };

  if (marks.bold !== undefined) next.bold = marks.bold || undefined;
  if (marks.italic !== undefined) next.italic = marks.italic || undefined;
  if (marks.underline !== undefined) {
    if (marks.underline) {
      next.underline = {
        style:
          typeof marks.underline === 'object' && marks.underline.style
            ? (marks.underline.style as NonNullable<TextFormatting['underline']>['style'])
            : 'single',
      };
    } else {
      delete next.underline;
    }
  }
  if (marks.strike !== undefined) next.strike = marks.strike || undefined;
  if (marks.color !== undefined) {
    if (marks.color && (marks.color.rgb || marks.color.themeColor)) {
      next.color = {
        rgb: marks.color.rgb,
        themeColor: marks.color.themeColor,
      } as NonNullable<TextFormatting['color']>;
    } else {
      delete next.color;
    }
  }
  if (marks.highlight !== undefined) {
    if (marks.highlight) {
      next.highlight = (mapHexToHighlightName(marks.highlight) ||
        marks.highlight) as TextFormatting['highlight'];
    } else {
      delete next.highlight;
    }
  }
  if (marks.fontSize !== undefined) {
    if (marks.fontSize > 0) next.fontSize = pointsToHalfPoints(marks.fontSize);
    else delete next.fontSize;
  }
  if (marks.fontFamily !== undefined) {
    if (marks.fontFamily && (marks.fontFamily.ascii || marks.fontFamily.hAnsi)) {
      next.fontFamily = {
        ascii: marks.fontFamily.ascii,
        hAnsi: marks.fontFamily.hAnsi ?? marks.fontFamily.ascii,
      };
    } else {
      delete next.fontFamily;
    }
  }

  for (const key of Object.keys(next) as (keyof TextFormatting)[]) {
    if (next[key] === undefined) delete next[key];
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function applyMarksToRun(run: Run, marks: CharacterFormatting): void {
  run.formatting = applyMarksToFormatting(run.formatting, marks);
}

function applyMarksToRunSlice(
  leaf: TextLeaf,
  fromOffset: number,
  toOffset: number,
  marks: CharacterFormatting
): void {
  const canSplitRun = leaf.run.content.every((item) => item.type === 'text');
  if ((fromOffset <= 0 && toOffset >= leaf.text.length) || !canSplitRun) {
    applyMarksToRun(leaf.run, marks);
    return;
  }

  const replacement: Run[] = [];
  if (fromOffset > 0) replacement.push(cloneRunWithText(leaf.run, leaf.text.slice(0, fromOffset)));
  const middle = cloneRunWithText(leaf.run, leaf.text.slice(fromOffset, toOffset));
  applyMarksToRun(middle, marks);
  replacement.push(middle);
  if (toOffset < leaf.text.length) {
    replacement.push(cloneRunWithText(leaf.run, leaf.text.slice(toOffset)));
  }

  leaf.parent.splice(leaf.index, 1, ...replacement);
}

function applyMarksToParagraphRange(
  paragraph: Paragraph,
  from: number,
  to: number,
  marks: CharacterFormatting
): boolean {
  const leaves = collectFormattingLeaves(paragraph, false);
  const targets = leaves.filter((leaf) => leaf.start < to && leaf.end > from);
  if (targets.length === 0) return true;

  for (let i = targets.length - 1; i >= 0; i--) {
    const leaf = targets[i];
    applyMarksToRunSlice(
      leaf,
      Math.max(0, from - leaf.start),
      Math.min(leaf.text.length, to - leaf.start),
      marks
    );
  }
  return true;
}

function applyMarksToWholeParagraph(paragraph: Paragraph, marks: CharacterFormatting): boolean {
  const leaves = collectFormattingLeaves(paragraph, true);
  for (const leaf of leaves) applyMarksToRun(leaf.run, marks);
  return true;
}

function findUniqueTextRange(
  paragraph: Paragraph,
  search: string
): { from: number; to: number } | null {
  if (!search) return null;
  const leaves = collectFormattingLeaves(paragraph, false);
  const text = leaves.map((leaf) => leaf.text).join('');
  const first = text.indexOf(search);
  if (first === -1) return null;
  if (text.indexOf(search, first + 1) !== -1) return null;
  return { from: first, to: first + search.length };
}

function hasParagraphStyle(styles: StyleDefinitions | undefined, styleId: string): boolean {
  if (!styles) return true;
  return !!styles.styles?.some((style) => style.styleId === styleId && style.type === 'paragraph');
}

/**
 * Create an EditorBridge backed by a DocxReviewer. The agent (or MCP client)
 * can read, comment, propose changes, etc., against a parsed DOCX file on
 * disk. Call `reviewer.toBuffer()` afterwards to get the modified DOCX.
 *
 * @param reviewer - A DocxReviewer instance. The bridge mutates it in place.
 *
 * @public
 */
export function createReviewerBridge(reviewer: DocxReviewer): EditorBridge {
  // Content-change listeners fan out from successful mutations. Selection
  // listeners never fire in headless mode (no user, no caret) — the
  // unsubscribe is a no-op.
  const contentListeners = new Set<(e: ContentChangeEvent) => void>();

  // (paraId → paragraphIndex) cache. Most mutators only mutate paragraph
  // content / append to body.comments, so the index map stays invariant and we
  // build it once, lazily. `insertBreak({type:'page'})` is the exception — it
  // inserts a top-level block, so it resets `cache` to force a rebuild.
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

      // Track the top-level ordinal index exactly as buildParaIdMap does, so a
      // paraId-less paragraph surfaces the same `String(index)` id the mutate
      // tools resolve. Tables advance the index by their cell-paragraph count
      // (cells aren't searched here — same top-level-only scope as before).
      let index = 0;
      for (const block of body.content) {
        if (matches.length >= limit) break;
        if (block.type === 'table') {
          for (const row of block.rows) {
            for (const cell of row.cells) {
              for (const cellBlock of cell.content) {
                if (cellBlock.type === 'paragraph') index++;
              }
            }
          }
          continue;
        }
        if (block.type !== 'paragraph') {
          index++;
          continue;
        }
        const para = block as Paragraph;
        const paraIndex = index++;
        const text = getParagraphPlainText(para);
        const haystack = caseSensitive ? text : text.toLowerCase();
        const at = haystack.indexOf(needle);
        if (at === -1) continue;
        // Ambiguous matches in a single paragraph: skip — agent must narrow.
        if (haystack.indexOf(needle, at + 1) !== -1) continue;
        const match = text.slice(at, at + query.length);
        matches.push({
          paraId: para.paraId ?? String(paraIndex),
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
     * so we mutate the body's comment record in place. Throws
     * `CommentNotFoundError` if no comment carries `commentId` — mirrors the
     * not-found semantics of `acceptChange`/`removeComment` so a missed id is a
     * loud failure, not a silent no-op that reports success to the caller. */
    resolveComment(commentId: number): void {
      const body = reviewer.toDocument().package?.document;
      const comment = body?.comments?.find((c) => c.id === commentId);
      if (!comment) {
        throw new CommentNotFoundError(commentId);
      }
      comment.done = true;
      emitContentChange();
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

    applyFormatting(options): boolean {
      const idx = map().get(options.paraId);
      if (idx === undefined) return false;

      const body = reviewer.toDocument().package?.document;
      if (!body) return false;

      try {
        const para = body ? getParagraphAtIndex(body, idx) : null;
        if (!para) return false;

        if (options.search) {
          const range = findUniqueTextRange(para, options.search);
          if (!range) return false;
          applyMarksToParagraphRange(para, range.from, range.to, options.marks);
        } else {
          applyMarksToWholeParagraph(para, options.marks);
        }

        emitContentChange();
        return true;
      } catch {
        return false;
      }
    },

    setParagraphStyle(options): boolean {
      const idx = map().get(options.paraId);
      if (idx === undefined) return false;

      const doc = reviewer.toDocument();
      const body = doc.package?.document;
      if (!body) return false;
      if (!hasParagraphStyle(doc.package?.styles, options.styleId)) return false;

      try {
        const para = getParagraphAtIndex(body, idx);
        para.formatting = { ...(para.formatting ?? {}), styleId: options.styleId };
        emitContentChange();
        return true;
      } catch {
        return false;
      }
    },

    insertBreak(options): boolean {
      const idx = map().get(options.paraId);
      if (idx === undefined) return false;

      const body = reviewer.toDocument().package?.document;
      if (!body) return false;

      try {
        const para = getParagraphAtIndex(body, idx);
        if (!para) return false;

        if (options.type === 'sectionNextPage' || options.type === 'sectionContinuous') {
          // A section break is the sectPr carried by the section's last
          // paragraph — set it directly on the target (no block-count change).
          const sectionStart: 'nextPage' | 'continuous' =
            options.type === 'sectionNextPage' ? 'nextPage' : 'continuous';
          para.sectionProperties = { ...(para.sectionProperties ?? {}), sectionStart };
          emitContentChange();
          return true;
        }

        // Page break: insert a break-run paragraph right after the target
        // top-level paragraph (the model shape `fromProseDoc` emits). paraIds
        // only map top-level paragraphs, so the target is findable in
        // `body.content`; inserting shifts indices, so rebuild the cache.
        const pos = body.content.indexOf(para);
        if (pos === -1) return false;
        const pageBreakParagraph: Paragraph = {
          type: 'paragraph',
          content: [{ type: 'run', content: [{ type: 'break', breakType: 'page' }] }],
        };
        body.content.splice(pos + 1, 0, pageBreakParagraph);
        cache = null;
        emitContentChange();
        return true;
      } catch {
        return false;
      }
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
