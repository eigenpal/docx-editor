/**
 * PM-anchored lookups used by DocxEditor's host body and its hooks.
 *
 * `findSelectionYPosition` is a DOM walk against the painted pages —
 * needed by the floating comment button and the context-menu comment
 * action to position UI relative to the editor's scroll container.
 * `findParaIdRange` and `getInitialSectionProperties` are doc-model
 * walks used during document setup and `scrollToParaId` navigation.
 */

import { findBodyPmAnchors } from '@eigenpal/docx-editor-core/flow-model';
import type { Document, SectionProperties } from '@eigenpal/docx-editor-core/types/document';

// `findParaIdRange` moved to `@eigenpal/docx-editor-core/prosemirror/paraText`;
// import it from core directly (no re-export here — there were no consumers).

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
