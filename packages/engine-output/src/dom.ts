// DOM output backend (document-engine task 8.10 / design D7). Consumes the same
// anchored DisplayItem[] IR as the PDF and hit-test backends and paints it with
// SAFE DOM construction only — createElement + setAttribute + textContent, never
// innerHTML/HTML-from-string (security contract). Fixed-point layout units (twips,
// 1/1440in) convert to CSS px (96/in).

import type { LayoutResult, Page, TextItem, RectItem } from '@docx-editor.dev/engine-layout';
import { registerDisplayItemRenderer, renderDisplayItem, displayItemLayer, orderedLayers } from './output-capabilities.ts';

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

  // Paint by ascending LAYER (rects behind text), preserving document order within each layer, and
  // dispatch each item through its registered renderer (comprehensive 3.8) — no item.type switch.
  for (const layer of orderedLayers(page.items)) {
    for (const item of page.items) {
      if (item.type === 'caretEdge') continue;
      if (displayItemLayer(item.type) === layer) el.appendChild(renderDisplayItem(item, doc));
    }
  }
  return el;
}

// Register the built-in display-item renderers with their paint layers (rects behind text).
registerDisplayItemRenderer('rect', (item, doc) => renderRectItem(item as RectItem, doc), 0);
registerDisplayItemRenderer('text', (item, doc) => renderTextItem(item as TextItem, doc), 1);

function renderRectItem(item: RectItem, doc: Document): HTMLElement {
  const div = doc.createElement('div');
  div.style.position = 'absolute';
  div.style.left = `${px(item.x)}px`;
  div.style.top = `${px(item.y)}px`;
  div.style.width = `${px(item.width)}px`;
  div.style.height = `${px(item.height)}px`;
  div.style.boxSizing = 'border-box';
  if (item.stroke) div.style.border = '1px solid #000';
  // fill is a bare hex from the layout; re-validate at this CSS sink (security contract).
  if (item.fill && /^[0-9a-fA-F]{6}$/.test(item.fill)) div.style.background = `#${item.fill}`;
  return div;
}

function renderTextItem(item: TextItem, doc: Document): HTMLElement {
  const span = doc.createElement('span');
  span.style.position = 'absolute';
  span.style.left = `${px(item.x)}px`;
  span.style.top = `${px(item.y)}px`;
  span.style.fontSize = `${px(item.height * 0.9)}px`;
  span.style.fontFamily = 'Helvetica, Arial, sans-serif';
  span.style.fontVariantLigatures = 'none';
  span.style.fontFeatureSettings = '"liga" 0, "clig" 0, "dlig" 0';
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

/**
 * Public test-target attribute for the first editable body glyph
 * (interactive-paginated-editing M2.3). Browser gates click the center of this
 * element instead of a hardcoded page coordinate, so a layout change moves the
 * target with the text rather than silently aiming a click at whitespace.
 */
export const ONE_SURFACE_CLICK_TARGET = 'one-surface-click-target';

/**
 * Stamp the click-target attribute on the first rendered text element that
 * carries non-whitespace content. Returns that element, or null when the page
 * has no inked glyph — never fabricates a target.
 */
export function markOneSurfaceClickTarget(pageEl: HTMLElement): HTMLElement | null {
  const spans = pageEl.querySelectorAll('span[data-para]');
  for (const span of Array.from(spans)) {
    if ((span.textContent ?? '').trim().length === 0) continue;
    span.setAttribute('data-testid', ONE_SURFACE_CLICK_TARGET);
    return span as HTMLElement;
  }
  return null;
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
