/**
 * Module-scope helpers for DocxEditor — pure utilities the forwardRef
 * body and its hooks call into. Covers element-to-pixel anchoring,
 * paragraph lookup by `w14:paraId`, and "vanilla view" text extraction
 * (skips text inside `insertion` marks so what the agent reads matches
 * what `add_comment` / `suggest_change` can anchor).
 *
 * `createComment` and `nextCommentId` stay in DocxEditor.tsx because the
 * counter is mutated from three sites in the forwardRef body
 * (load/reset, plus tracked-change creation) and the mutable
 * cross-module binding is fragile.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { findBodyPmAnchors } from '@eigenpal/docx-editor-core/layout-bridge';
import type { Document, SectionProperties } from '@eigenpal/docx-editor-core/types/document';

/**
 * Find the Y position (relative to parentEl) of the element containing the given PM position.
 * Used by both the floating comment button and the context menu comment action.
 * Queries all elements with data-doc-from (spans, divs, imgs) — not just spans,
 * since table cell content may use div fragments.
 */
export function findSelectionYPosition(
  scrollContainer: HTMLElement | null,
  parentEl: HTMLElement | null,
  pmPos: number
): number | null {
  if (!scrollContainer || !parentEl) return null;
  const pagesEl = scrollContainer.querySelector('.paged-editor__pages');
  if (!pagesEl) return null;
  for (const el of findBodyPmAnchors(pagesEl)) {
    const docFrom = Number(el.dataset.docFrom);
    const docTo = Number(el.dataset.docTo);
    if (pmPos >= docFrom && pmPos <= docTo) {
      return el.getBoundingClientRect().top - parentEl.getBoundingClientRect().top;
    }
  }
  return null;
}

export function getInitialSectionProperties(
  doc: Document | null | undefined
): SectionProperties | undefined {
  const body = doc?.package?.document;
  return body?.sections?.[0]?.properties ?? body?.finalSectionProperties;
}

/**
 * Find the ProseMirror position range for a paragraph by Word `w14:paraId`.
 * Stable across edits — the inverse of `formatContentForLLM`'s `[paraId]` line tag.
 *
 * Returns inclusive `from` (position before the textblock) and exclusive `to`
 * (`from + nodeSize`). Text content lives in `[from + 1, to - 1]`.
 */
export function findParaIdRange(doc: PMNode, paraId: string): { from: number; to: number } | null {
  if (!paraId || !paraId.trim()) return null;
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result !== null) return false;
    if (node.isTextblock && node.attrs?.paraId === paraId) {
      result = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return result;
}

/**
 * Vanilla-view text of a single PM node (typically a paragraph): concatenates
 * descendant text node content, skipping any text inside an `insertion` mark.
 * Use this in any agent-facing read path so the agent's view of the document
 * matches what `add_comment` / `suggest_change` can anchor.
 */
export function getVanillaNodeText(node: PMNode): string {
  const parts: string[] = [];
  node.descendants((child) => {
    if (!child.isText || !child.text) return true;
    if (child.marks.some((m) => m.type.name === 'insertion')) return false;
    parts.push(child.text);
    return true;
  });
  return parts.join('');
}

/**
 * Vanilla-view text between two doc positions. Same semantics as
 * `getVanillaNodeText`, but takes a PM position range so it can serve a
 * selection rather than a single node.
 */
export function getVanillaTextBetween(doc: PMNode, from: number, to: number): string {
  if (from >= to) return '';
  const parts: string[] = [];
  doc.nodesBetween(from, to, (child, pos) => {
    if (!child.isText || !child.text) return;
    if (child.marks.some((m) => m.type.name === 'insertion')) return;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + child.text.length);
    if (start < end) parts.push(child.text.slice(start - pos, end - pos));
  });
  return parts.join('');
}

/**
 * Find a text string within a ProseMirror paragraph node range and return its positions.
 *
 * Returns null if:
 *   - searchText is empty
 *   - searchText is not found
 *   - searchText appears more than once (ambiguous; caller must disambiguate)
 *
 * The fullText is built from PM text nodes only and matches the vanilla view
 * the agent reads via `read_document` (the bridge passes includeTrackedChanges/
 * includeCommentAnchors=false): tracked insertions are excluded (not in the doc
 * yet), tracked deletions are included (still in the doc until accepted), and
 * comment markers are stripped.
 */
export function findTextInPmParagraph(
  doc: PMNode,
  paragraphFrom: number,
  paragraphTo: number,
  searchText: string
): { from: number; to: number } | null {
  if (!searchText) return null;

  let fullText = '';
  const textPositions: { pos: number; len: number }[] = [];

  doc.nodesBetween(paragraphFrom, paragraphTo, (node, pos) => {
    if (!node.isText || !node.text) return;
    // Vanilla view: text inside an `insertion` mark isn't in the doc yet.
    if (node.marks.some((m) => m.type.name === 'insertion')) return;
    textPositions.push({ pos, len: node.text.length });
    fullText += node.text;
  });

  const firstMatch = fullText.indexOf(searchText);
  if (firstMatch === -1) return null;
  // Reject ambiguous searches — the LLM gets a clearer error than a silent mistarget.
  const secondMatch = fullText.indexOf(searchText, firstMatch + 1);
  if (secondMatch !== -1) return null;

  // Map string offset to PM position
  let charOffset = 0;
  let fromPos = paragraphFrom;
  let toPos = paragraphFrom;

  for (const tp of textPositions) {
    const segEnd = charOffset + tp.len;
    if (charOffset <= firstMatch && firstMatch < segEnd) {
      fromPos = tp.pos + (firstMatch - charOffset);
    }
    if (charOffset <= firstMatch + searchText.length && firstMatch + searchText.length <= segEnd) {
      toPos = tp.pos + (firstMatch + searchText.length - charOffset);
      break;
    }
    charOffset = segEnd;
  }

  return { from: fromPos, to: toPos };
}
