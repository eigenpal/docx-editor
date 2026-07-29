// DOM output backend (document-engine task 8.10 / design D7). Consumes the same
// anchored DisplayItem[] IR as the PDF and hit-test backends and paints it with
// SAFE DOM construction only — createElement + setAttribute + textContent, never
// innerHTML/HTML-from-string (security contract). Fixed-point layout units (twips,
// 1/1440in) convert to CSS px (96/in).

import type { LayoutResult, Page, TextItem, RectItem } from '@docx-editor.dev/engine-layout';
import {
  registerDisplayItemRenderer,
  renderDisplayItem,
  displayItemLayer,
  orderedLayers,
} from './output-capabilities.ts';

const TWIPS_PER_PX = 15; // 1440 twips/in ÷ 96 px/in

function px(twips: number): number {
  return twips / TWIPS_PER_PX;
}

export interface InstalledFontMapping {
  aliasFor(font: TextItem['shapingEnvironment']['font']): string;
}

/** Build a positioned page element from a layout page (no HTML-from-string). */
export function renderPageElement(
  page: Page,
  fonts: InstalledFontMapping,
  doc: Document = document
): HTMLElement {
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
      if (displayItemLayer(item.type) === layer) {
        el.appendChild(
          renderDisplayItem(item, doc, {
            fontAlias: (font) => {
              const alias = fonts.aliasFor(font);
              if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(alias)) {
                throw new TypeError(
                  `Installed font mapping returned an invalid CSS alias for ${font.identity}`
                );
              }
              return alias;
            },
          })
        );
      }
    }
  }
  return el;
}

// Register the built-in display-item renderers with their paint layers (rects behind text).
registerDisplayItemRenderer('rect', (item, doc) => renderRectItem(item as RectItem, doc), 0);
registerDisplayItemRenderer(
  'text',
  (item, doc, context) => {
    if (!context) throw new TypeError('DOM text output requires an installed-font mapping');
    const text = item as TextItem;
    context.fontAlias(text.shapingEnvironment.font);
    return renderTextItem(text, doc);
  },
  1
);

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
  const wrapper = doc.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.left = `${px(item.x)}px`;
  wrapper.style.top = `${px(item.y)}px`;
  wrapper.style.width = `${px(item.width)}px`;
  wrapper.style.height = `${px(item.height)}px`;

  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-para', item.anchor.paragraphId);
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = `${px(item.width)}px`;
  svg.style.height = `${px(item.height)}px`;
  svg.style.overflow = 'visible';
  svg.style.pointerEvents = 'none';
  for (const glyph of item.shapedRun.glyphs) {
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    const scale = (item.fontSizeHalfPoints * 2) / 3 / glyph.outline.unitsPerEm;
    path.setAttribute('d', glyph.outline.path);
    path.setAttribute(
      'transform',
      `translate(${px(glyph.originX + glyph.offsetX)} ${px(
        item.baseline - item.y - glyph.originY - glyph.offsetY
      )}) scale(${scale} ${-scale})`
    );
    path.setAttribute(
      'fill',
      item.color.toLowerCase() === 'auto'
        ? 'currentColor'
        : /^[0-9a-fA-F]{6}$/.test(item.color)
          ? `#${item.color}`
          : 'currentColor'
    );
    svg.appendChild(path);
  }

  const span = doc.createElement('span');
  span.style.position = 'absolute';
  span.style.width = '1px';
  span.style.height = '1px';
  span.style.margin = '-1px';
  span.style.padding = '0';
  span.style.overflow = 'hidden';
  span.style.clipPath = 'inset(50%)';
  span.style.whiteSpace = 'nowrap';
  span.style.pointerEvents = 'none';
  // Anchor metadata for hit-testing / navigation (data-* attributes, safe).
  span.setAttribute('data-para', item.anchor.paragraphId);
  span.setAttribute('data-offset', String(item.anchor.offset));
  span.textContent = item.text; // SAFE: textContent, never innerHTML
  wrapper.appendChild(svg);
  wrapper.appendChild(span);
  return wrapper;
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
export function renderToDom(
  layout: LayoutResult,
  container: HTMLElement,
  fonts: InstalledFontMapping,
  doc: Document = document
): HTMLElement[] {
  const pages: HTMLElement[] = [];
  for (const page of layout.pages) {
    const el = renderPageElement(page, fonts, doc);
    container.appendChild(el);
    pages.push(el);
  }
  return pages;
}
