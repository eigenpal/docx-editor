// Semantic reading-order extraction from the display list (document-engine task
// 8.10 core / design D7). Logical reading order is the display-item order the
// layout emitted; this feeds accessible DOM, tagged-PDF ActualText, and text
// extraction comparators. Pure — no backend, no geometry re-derivation.

import type { DisplayItem, LayoutResult } from '@docx-editor.dev/engine-layout';
import { assertNeverDisplayItem } from './output-capabilities.ts';

/** The reading-order text an item contributes (empty for non-text). Exhaustive over DisplayItem, so a
 *  new kind must decide its reading-order role here (comprehensive 3.8) rather than be dropped. */
function itemText(item: DisplayItem): string[] {
  switch (item.type) {
    case 'text':
      return [item.text];
    case 'rect':
      return []; // a border/shading rect carries no reading-order text
    default:
      return assertNeverDisplayItem(item);
  }
}

/** The logical text of each page in reading order. */
export function extractReadingOrder(layout: LayoutResult): string[] {
  return layout.pages.map((page) => page.items.flatMap(itemText).join(' '));
}
