// Imperative DisplayPage[] painter for the production-editor accessibility harness.
// Mirrors adapter paint semantics without React — presentation-only painted output.

import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/contracts/geometry';
import { colorToCss, borderSegLine } from '../../core/src/editor/paint-style.ts';

function paintTextItem(doc: Document, item: Extract<DisplayItem, { kind: 'text' }>): HTMLElement[] {
  return item.runs.map((run) => {
    const el = doc.createElement('div');
    el.setAttribute('data-painted-text', 'true');
    el.style.position = 'absolute';
    el.style.left = `${run.box.x}px`;
    el.style.top = `${run.box.y}px`;
    el.style.width = `${run.box.width}px`;
    el.style.height = `${run.box.height}px`;
    const fixedToPx = 4 / (3 * run.shaping.fixedPointScale);
    const baseline = run.verticalMetrics.baseline - run.box.y;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.width = `${run.box.width}px`;
    svg.style.height = `${run.box.height}px`;
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    for (const glyph of run.glyphs) {
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      const scale = run.fontSizePx / glyph.outline.unitsPerEm;
      path.setAttribute('d', glyph.outline.path);
      path.setAttribute('fill', colorToCss(run.color) ?? 'currentColor');
      path.setAttribute(
        'transform',
        `translate(${(glyph.originX + glyph.offsetX) * fixedToPx} ${
          baseline - (glyph.originY + glyph.offsetY) * fixedToPx
        }) scale(${scale} ${-scale})`
      );
      svg.append(path);
    }
    const semantic = doc.createElement('span');
    semantic.style.position = 'absolute';
    semantic.style.width = '1px';
    semantic.style.height = '1px';
    semantic.style.margin = '-1px';
    semantic.style.overflow = 'hidden';
    semantic.style.clipPath = 'inset(50%)';
    semantic.style.whiteSpace = 'nowrap';
    semantic.style.pointerEvents = 'none';
    semantic.textContent = run.text;
    el.append(svg, semantic);
    return el;
  });
}

function paintItem(doc: Document, item: DisplayItem): HTMLElement[] {
  switch (item.kind) {
    case 'text':
      return paintTextItem(doc, item);
    case 'fill': {
      const el = doc.createElement('div');
      el.style.position = 'absolute';
      el.style.left = `${item.box.x}px`;
      el.style.top = `${item.box.y}px`;
      el.style.width = `${item.box.width}px`;
      el.style.height = `${item.box.height}px`;
      el.style.backgroundColor = colorToCss(item.color);
      return [el];
    }
    case 'tableBorder':
      return item.segments.map((seg) => {
        const b = borderSegLine(seg);
        const el = doc.createElement('div');
        el.style.position = 'absolute';
        el.style.left = `${b.x}px`;
        el.style.top = `${b.y}px`;
        el.style.width = b.horizontal ? `${b.length}px` : '0';
        el.style.height = b.horizontal ? '0' : `${b.length}px`;
        const border = `${b.widthPx}px ${b.cssStyle} ${b.color ?? 'currentColor'}`;
        if (b.horizontal) el.style.borderTop = border;
        else el.style.borderLeft = border;
        return el;
      });
    default:
      return [];
  }
}

/** Paint positioned pages into `container`, replacing prior children. */
export function paintDisplayPages(container: HTMLElement, pages: readonly DisplayPage[]): void {
  const doc = container.ownerDocument ?? document;
  container.replaceChildren();
  for (const page of pages) {
    const pageEl = doc.createElement('div');
    pageEl.className = 'doc-page';
    pageEl.setAttribute('data-page-index', String(page.index));
    pageEl.style.position = 'relative';
    pageEl.style.width = `${page.box.width}px`;
    pageEl.style.height = `${page.box.height}px`;
    pageEl.style.background = 'white';
    pageEl.style.margin = '16px auto';
    for (const item of page.items) {
      for (const node of paintItem(doc, item)) pageEl.append(node);
    }
    container.append(pageEl);
  }
}
