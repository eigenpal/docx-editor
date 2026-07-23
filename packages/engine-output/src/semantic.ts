// Semantic reading-order extraction from the display list (document-engine task
// 8.10 core / design D7). Logical reading order is the display-item order the
// layout emitted; this feeds accessible DOM, tagged-PDF ActualText, and text
// extraction comparators. Pure — no backend, no geometry re-derivation.

import type { LayoutResult } from '@docx-editor.dev/engine-layout';

/** The logical text of each page in reading order. */
export function extractReadingOrder(layout: LayoutResult): string[] {
  return layout.pages.map((page) =>
    page.items
      .filter((i) => i.type === 'text')
      .map((i) => i.text)
      .join(' '),
  );
}
