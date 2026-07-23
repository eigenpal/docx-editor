// Layout -> DOM integration (document-engine section 8, queue item 1). Proves the DOM
// backend CONSUMES the same anchored DisplayItem[] the layout emits — one page div per
// layout page, one bordered div per RectItem, one span per TextItem, at the layout's
// (twip->px) geometry. No geometry is re-derived in the backend.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToDom } from '../src/index.ts';
import { layoutBody, DeterministicMetrics, type LayoutOptions } from '@docx-editor.dev/engine-layout';
import { parseDocx } from '@docx-editor.dev/engine-core';

// Minimal DOM stand-in: renderToDom only uses createElement/style/setAttribute/
// appendChild/textContent.
class El {
  style: Record<string, string> = {};
  children: El[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k]; }
  appendChild(c: El) { this.children.push(c); return c; }
}
const mockDoc = { createElement: (t: string) => new El(t) } as unknown as Document;
const PX = 15; // twips per px, matching the backend

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new DeterministicMetrics(), ...over };
}
function withTables() {
  const r = parseDocx(readFileSync(`${import.meta.dir}/../../../e2e/fixtures/with-tables.docx`));
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.model;
}

describe('layout -> DOM integration', () => {
  test('the DOM renders exactly the layout DisplayItems at the layout geometry', () => {
    const layout = layoutBody(withTables(), opts());
    const container = new El('div');
    renderToDom(layout, container, mockDoc);

    // One page element per layout page.
    expect(container.children.length).toBe(layout.pages.length);

    const layoutRects = layout.pages.flatMap((p) => p.items).filter((i) => i.type === 'rect');
    const layoutTexts = layout.pages.flatMap((p) => p.items).filter((i) => i.type === 'text');
    const domNodes = container.children.flatMap((page) => page.children);
    const domRects = domNodes.filter((n) => n.tag === 'div' && n.style.border);
    const domSpans = domNodes.filter((n) => n.tag === 'span');

    // 1:1 with the layout — nothing added or dropped by the backend.
    expect(domRects.length).toBe(layoutRects.length);
    expect(domSpans.length).toBe(layoutTexts.length);

    // Cell text is present and positioned from the layout item (no re-derivation).
    const a1 = domSpans.find((s) => s.textContent === 'A1');
    expect(a1).toBeDefined();
    const a1Item = layoutTexts.find((i) => i.type === 'text' && i.text === 'A1')!;
    expect(a1!.style.left).toBe(`${a1Item.x / PX}px`);
    expect(a1!.style.top).toBe(`${a1Item.y / PX}px`);
    // Anchors survive for hit-testing/navigation.
    expect(a1!.getAttribute('data-para')).toBe(a1Item.type === 'text' ? a1Item.anchor.paragraphId : '');
  });
});
