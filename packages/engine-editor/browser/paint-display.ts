// Imperative DisplayPage[] painter for the production-editor accessibility harness.
// Mirrors adapter paint semantics without React — presentation-only painted output.

import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { runStyle, colorToCss, borderSegLine } from '../src/paint-style.ts';

function paintTextItem(doc: Document, item: Extract<DisplayItem, { kind: 'text' }>): HTMLElement[] {
  return item.runs.map((run) => {
    const s = runStyle(run);
    const el = doc.createElement('div');
    el.setAttribute('data-painted-text', 'true');
    el.style.position = 'absolute';
    el.style.left = `${run.box.x}px`;
    el.style.top = `${run.box.y}px`;
    el.style.fontFamily = s.fontFamily;
    el.style.fontSize = `${s.fontSizePx}px`;
    el.style.fontWeight = s.fontWeight;
    el.style.fontStyle = s.fontStyle;
    el.style.color = s.color;
    el.style.textDecoration = s.textDecoration;
    el.style.whiteSpace = 'pre';
    el.textContent = run.text;
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
