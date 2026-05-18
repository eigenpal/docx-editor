/**
 * PM-anchored lookups used by DocxEditor's host body and its hooks.
 *
 * `findSelectionYPosition` is a DOM walk against the painted pages —
 * needed by the floating comment button and the context-menu comment
 * action to position UI relative to the editor's scroll container.
 * `findParaIdRange` and `getInitialSectionProperties` are doc-model
 * walks used during document setup and `scrollToParaId` navigation.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { findBodyPmAnchors } from '@eigenpal/docx-editor-core/layout-bridge';
import type { Document, SectionProperties } from '@eigenpal/docx-editor-core/types/document';

/**
 * Y position (relative to parentEl) of the painted element containing `pmPos`.
 * Queries all elements with `data-doc-from` — spans, divs, imgs — not just
 * spans, since table cell content uses div fragments.
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
 * PM position range for a paragraph identified by Word `w14:paraId`.
 * Stable across edits — inverse of `formatContentForLLM`'s `[paraId]` line tag.
 *
 * Returns inclusive `from` (position before the textblock) and exclusive
 * `to` (`from + nodeSize`). Text content lives in `[from + 1, to - 1]`.
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
