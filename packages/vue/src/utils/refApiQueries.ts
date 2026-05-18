/**
 * Pure ref-API query helpers — read-only inspectors over the PM document
 * and the paginated layout. Used by DocxEditorVue's `defineExpose` ref API
 * (`findInDocument`, `getSelectionInfo`, `getPageContent`).
 *
 * Every function takes the PM view (or layout + view) as a parameter
 * instead of closing over a Vue ref. That keeps these helpers callable
 * from anywhere without bringing the Vue reactivity system along.
 */

import type { EditorView } from 'prosemirror-view';
import type { Layout } from '@eigenpal/docx-editor-core/layout-engine';
import { getVanillaNodeText, getVanillaTextBetween } from './paraTextHelpers';

export interface FindInDocumentMatch {
  paraId: string;
  match: string;
  before: string;
  after: string;
}

/**
 * Walk the PM doc looking for `query`. Returns up to `limit` matches —
 * one per paragraph (rejects paragraphs where the query appears more
 * than once, mirroring `findTextInPmParagraph`'s ambiguity guard so the
 * LLM gets a clearer error than a silent mistarget).
 */
export function findInDocument(
  view: EditorView | null,
  query: string,
  opts?: { caseSensitive?: boolean; limit?: number }
): FindInDocumentMatch[] {
  if (!view || !query) return [];
  const caseSensitive = opts?.caseSensitive ?? false;
  const limit = opts?.limit ?? 20;
  const needle = caseSensitive ? query : query.toLowerCase();
  const results: FindInDocumentMatch[] = [];

  view.state.doc.descendants((node) => {
    if (results.length >= limit) return false;
    if (!node.isTextblock) return true;
    const paraId = node.attrs?.paraId as string | undefined;
    if (!paraId) return false;
    const text = getVanillaNodeText(node);
    const haystack = caseSensitive ? text : text.toLowerCase();
    const at = haystack.indexOf(needle);
    if (at === -1 || haystack.indexOf(needle, at + 1) !== -1) return false;
    const context = 40;
    results.push({
      paraId,
      match: text.slice(at, at + query.length),
      before: text.slice(Math.max(0, at - context), at),
      after: text.slice(at + query.length, at + query.length + context),
    });
    return false;
  });

  return results;
}

export interface SelectionInfo {
  paraId: string | null;
  selectedText: string;
  paragraphText: string;
  before: string;
  after: string;
}

/**
 * Describe the current selection in agent-readable form — paraId of the
 * containing paragraph, the selected text, the full paragraph text, and
 * the leading/trailing slices.
 */
export function getSelectionInfo(view: EditorView | null): SelectionInfo | null {
  if (!view) return null;
  const { selection, doc } = view.state;
  const $from = selection.$from;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth--;
  const para = depth > 0 ? $from.node(depth) : null;
  if (!para) return null;
  const paraId = (para.attrs?.paraId as string | undefined) ?? null;
  const paraStart = $from.start(depth);
  const paraEnd = paraStart + para.content.size;
  const before = getVanillaTextBetween(doc, paraStart, selection.from);
  const selectedText = getVanillaTextBetween(doc, selection.from, selection.to);
  const after = getVanillaTextBetween(doc, selection.to, paraEnd);
  return { paraId, selectedText, paragraphText: before + selectedText + after, before, after };
}

export interface PageContent {
  pageNumber: number;
  text: string;
  paragraphs: Array<{ paraId: string; text: string; styleId?: string }>;
}

/**
 * Collect paragraphs visible on `pageNumber` (1-indexed) from the
 * paginated `layout`. Dedupes by paraId so paragraphs split across page
 * boundaries are reported once.
 */
export function getPageContent(
  view: EditorView | null,
  layout: Layout | null,
  pageNumber: number
): PageContent | null {
  if (!layout || !view) return null;
  const page = layout.pages[pageNumber - 1];
  if (!page) return null;

  const seen = new Set<string>();
  const paragraphs: PageContent['paragraphs'] = [];
  for (const fragment of page.fragments) {
    if (fragment.kind !== 'paragraph') continue;
    const docFrom = fragment.docFrom;
    if (docFrom == null) continue;
    const node = view.state.doc.nodeAt(docFrom);
    if (!node || !node.isTextblock) continue;
    const paraId = node.attrs?.paraId as string | undefined;
    if (!paraId || seen.has(paraId)) continue;
    seen.add(paraId);
    paragraphs.push({
      paraId,
      text: getVanillaNodeText(node),
      styleId: (node.attrs?.styleId as string | undefined) ?? undefined,
    });
  }

  const text = paragraphs.map((paragraph) => `[${paragraph.paraId}] ${paragraph.text}`).join('\n');
  return { pageNumber, text, paragraphs };
}
