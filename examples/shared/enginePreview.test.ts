// Shared read-only preview projection (queue item 2). The SAME framework-agnostic path
// the React and Vue demos use: parse -> layout -> DOM, with visible invalid-file errors
// and no editing/saving. Verified against a real table fixture via a minimal DOM mock.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseDocx } from '@docx-editor.dev/engine-core';
import { createDeterministicLayoutShaping } from '@docx-editor.dev/engine-layout';
import { renderDocxPreview, renderModelPreview } from './enginePreview.ts';

const options = {
  shaping: createDeterministicLayoutShaping({
    families: [
      'Arial',
      'Calibri',
      'Cambria',
      'Courier New',
      'Georgia',
      'Times New Roman',
      'Verdana',
    ],
  }),
  installedFonts: { aliasFor: () => 'DocxFont_preview_test' },
};

class El {
  style: Record<string, string> = {};
  children: El[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  ownerDocument: unknown;
  constructor(
    readonly tag: string,
    owner?: unknown
  ) {
    this.ownerDocument = owner;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k];
  }
  appendChild(c: El) {
    this.children.push(c);
    return c;
  }
  removeChild(c: El) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
}
function mockDom() {
  const doc = { createElement: (t: string) => new El(t, doc) } as unknown as Document;
  const container = new El('div', doc);
  return { doc, container: container as unknown as HTMLElement, el: container };
}
function allNodes(root: El): El[] {
  return [root, ...root.children.flatMap((c) => allNodes(c))];
}

describe('renderDocxPreview (shared read-only projection)', () => {
  test('renders a real table fixture: pages, cell rects, and cell text', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../e2e/fixtures/with-tables.docx`);
    const { doc, container, el } = mockDom();
    const result = renderDocxPreview(bytes, container, options, doc);

    expect(result.ok).toBe(true);
    expect(result.pageCount).toBeGreaterThan(0);
    const nodes = allNodes(el);
    const pages = el.children.filter((n) => n.attrs.class === 'doc-page');
    expect(pages.length).toBe(result.pageCount); // one page element per layout page

    // Table cell rects have real, non-zero geometry (not zero-sized/degenerate).
    const px = (v?: string) => (v ? parseFloat(v) : NaN);
    const cellRects = nodes.filter((n) => n.tag === 'div' && n.style.border);
    expect(cellRects.length).toBeGreaterThanOrEqual(9); // 3x3 table
    for (const r of cellRects) {
      expect(px(r.style.width)).toBeGreaterThan(0);
      expect(px(r.style.height)).toBeGreaterThan(0);
      expect(Number.isFinite(px(r.style.left))).toBe(true);
      expect(Number.isFinite(px(r.style.top))).toBe(true);
    }
    // Visible cell text is positioned inside the page (non-negative, finite coords).
    const spans = nodes.filter((n) => n.tag === 'span');
    const text = spans.map((n) => n.textContent).join(' ');
    for (const cell of ['A1', 'B2', 'C3']) expect(text).toContain(cell);
    const a1 = spans.find((n) => n.textContent === 'A1')!;
    expect(px(a1.style.left)).toBeGreaterThanOrEqual(0);
    expect(px(a1.style.top)).toBeGreaterThanOrEqual(0);
  });

  test('an invalid file shows a visible error and does not throw', () => {
    const { doc, container, el } = mockDom();
    const result = renderDocxPreview(new Uint8Array([1, 2, 3, 4]), container, options, doc);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    const err = el.children.find((n) => n.attrs.class === 'docx-preview-error');
    expect(err).toBeDefined();
    expect(err!.textContent).toContain('could not be opened');
  });

  test('re-rendering into the same container replaces prior content (idempotent)', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../e2e/fixtures/with-tables.docx`);
    const { doc, container, el } = mockDom();
    renderDocxPreview(bytes, container, options, doc);
    const firstCount = el.children.length;
    renderDocxPreview(bytes, container, options, doc);
    expect(el.children.length).toBe(firstCount); // not doubled
  });
});

describe('renderModelPreview (paginated display from the canonical model)', () => {
  test('renders a parsed model directly (the editor repaints this from store.model)', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../e2e/fixtures/editable-sample.docx`);
    const parsed = parseDocx(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { doc, container, el } = mockDom();
    const result = renderModelPreview(parsed.model, container, options, doc);
    expect(result.ok).toBe(true);
    expect(result.pageCount).toBeGreaterThan(0);
    // Re-rendering the same model is idempotent (used on every keystroke).
    const before = el.children.length;
    renderModelPreview(parsed.model, container, options, doc);
    expect(el.children.length).toBe(before);
    // The model's paragraph text reaches the paginated display.
    const text = allNodes(el)
      .filter((n) => n.tag === 'span')
      .map((n) => n.textContent)
      .join(' ');
    expect(text).toContain('Edit');
  });
});

describe('deterministic page count (locks React/Vue parity by construction)', () => {
  test('the same fixture always yields the same page count', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../e2e/fixtures/repeated-table-header.docx`);
    const a = renderDocxPreview(bytes, mockDom().container, options, mockDom().doc);
    const b = renderDocxPreview(bytes, mockDom().container, options, mockDom().doc);
    // Both demos call this one path, so identical bytes -> identical page count.
    expect(a.ok && b.ok).toBe(true);
    expect(a.pageCount).toBe(b.pageCount);
    expect(a.pageCount).toBeGreaterThan(0);
  });
});
