// DOM output backend (document-engine task 8.10 / design D7). Consumes the same
// anchored DisplayItem[] IR as the PDF and hit-test backends and paints it with
// SAFE DOM construction only — createElement + setAttribute + textContent, never
// innerHTML/HTML-from-string (security contract). Fixed-point layout units (twips,
// 1/1440in) convert to CSS px (96/in).

import type { LayoutResult, Page, TextItem } from '@docx-editor.dev/engine-layout';

const TWIPS_PER_PX = 15; // 1440 twips/in ÷ 96 px/in

function px(twips: number): number {
  return twips / TWIPS_PER_PX;
}

/** Build a positioned page element from a layout page (no HTML-from-string). */
export function renderPageElement(page: Page, doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.setAttribute('class', 'doc-page');
  el.style.position = 'relative';
  el.style.width = `${px(page.width)}px`;
  el.style.height = `${px(page.height)}px`;
  el.style.background = 'white';
  el.style.margin = '16px auto';
  el.style.boxShadow = '0 1px 6px rgba(0,0,0,0.25)';
  el.style.overflow = 'hidden';

  for (const item of page.items) {
    if (item.type !== 'text') continue;
    el.appendChild(renderTextItem(item, doc));
  }
  return el;
}

function renderTextItem(item: TextItem, doc: Document): HTMLElement {
  const span = doc.createElement('span');
  span.style.position = 'absolute';
  span.style.left = `${px(item.x)}px`;
  span.style.top = `${px(item.y)}px`;
  span.style.fontSize = `${px(item.height * 0.9)}px`;
  span.style.fontFamily = 'Helvetica, Arial, sans-serif';
  span.style.lineHeight = '1';
  span.style.whiteSpace = 'pre';
  if (item.bold) span.style.fontWeight = 'bold';
  if (item.italic) span.style.fontStyle = 'italic';
  // Anchor metadata for hit-testing / navigation (data-* attributes, safe).
  span.setAttribute('data-para', item.anchor.paragraphId);
  span.setAttribute('data-offset', String(item.anchor.offset));
  span.textContent = item.text; // SAFE: textContent, never innerHTML
  return span;
}

/** Paint a full layout into a container element. Returns the page elements. */
export function renderToDom(layout: LayoutResult, container: HTMLElement, doc: Document = document): HTMLElement[] {
  const pages: HTMLElement[] = [];
  for (const page of layout.pages) {
    const el = renderPageElement(page, doc);
    container.appendChild(el);
    pages.push(el);
  }
  return pages;
}
