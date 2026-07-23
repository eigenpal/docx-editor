// Shared read-only preview projection (queue item 2). The SAME framework-agnostic path
// the React and Vue demos use: parse -> layout -> DOM, with visible invalid-file errors
// and no editing/saving. Verified against a real table fixture via a minimal DOM mock.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderDocxPreview } from './enginePreview.ts';

class El {
  style: Record<string, string> = {};
  children: El[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  ownerDocument: unknown;
  constructor(readonly tag: string, owner?: unknown) { this.ownerDocument = owner; }
  get firstChild() { return this.children[0] ?? null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k]; }
  appendChild(c: El) { this.children.push(c); return c; }
  removeChild(c: El) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
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
    const result = renderDocxPreview(bytes, container, {}, doc);

    expect(result.ok).toBe(true);
    expect(result.pageCount).toBeGreaterThan(0);
    const nodes = allNodes(el);
    const pages = el.children.filter((n) => n.attrs.class === 'doc-page');
    expect(pages.length).toBe(result.pageCount); // one page element per layout page
    expect(nodes.some((n) => n.tag === 'div' && n.style.border)).toBe(true); // table cell rects
    const text = nodes.filter((n) => n.tag === 'span').map((n) => n.textContent).join(' ');
    for (const cell of ['A1', 'B2', 'C3']) expect(text).toContain(cell); // visible table text
  });

  test('an invalid file shows a visible error and does not throw', () => {
    const { doc, container, el } = mockDom();
    const result = renderDocxPreview(new Uint8Array([1, 2, 3, 4]), container, {}, doc);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    const err = el.children.find((n) => n.attrs.class === 'docx-preview-error');
    expect(err).toBeDefined();
    expect(err!.textContent).toContain('could not be opened');
  });

  test('re-rendering into the same container replaces prior content (idempotent)', () => {
    const bytes = readFileSync(`${import.meta.dir}/../../e2e/fixtures/with-tables.docx`);
    const { doc, container, el } = mockDom();
    renderDocxPreview(bytes, container, {}, doc);
    const firstCount = el.children.length;
    renderDocxPreview(bytes, container, {}, doc);
    expect(el.children.length).toBe(firstCount); // not doubled
  });
});
