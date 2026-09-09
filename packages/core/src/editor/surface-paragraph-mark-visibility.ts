import type { ReviewItem } from '@docx-editor.dev/core/layout';

/**
 * Show paragraph-mark glyphs only for the selected paragraph-mark decision.
 *
 * Word keeps tracked paragraph marks out of the document until the reviewer selects the
 * corresponding change. A grouped decision can cover several paragraphs, so the item ranges
 * are the authority: every paragraph in the group becomes visible together.
 */
export function syncActiveParagraphMarks(pagesLayer: HTMLElement, active: ReviewItem | null): void {
  const activeParagraphs =
    active?.kind === 'revision' && active.revisionKind === 'paragraphMark'
      ? new Set(active.ranges.map((range) => range.start.paragraphId))
      : null;
  for (const glyph of pagesLayer.querySelectorAll<HTMLElement>('.docx-revision-pmark')) {
    const paragraphId = glyph.closest<HTMLElement>('[data-paragraph-id]')?.dataset.paragraphId;
    glyph.classList.toggle(
      'docx-revision-pmark--active',
      paragraphId !== undefined && (activeParagraphs?.has(paragraphId) ?? false)
    );
  }
}
