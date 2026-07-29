// Layout -> DOM integration (document-engine section 8, queue item 1). Proves the DOM
// backend CONSUMES the same anchored DisplayItem[] the layout emits — one page div per
// layout page, one bordered div per RectItem, one span per TextItem, at the layout's
// (twip->px) geometry. No geometry is re-derived in the backend.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToDom } from '../index.ts';
import {
  createDeterministicLayoutShaping,
  layoutBody,
  type LayoutOptions,
} from '@docx-editor.dev/engine-layout';
import { parseDocx } from '@docx-editor.dev/engine-core';

// Minimal DOM stand-in: renderToDom only uses createElement/style/setAttribute/
// appendChild/textContent.
class El {
  style: Record<string, string> = {};
  children: El[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  constructor(readonly tag: string) {}
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
}
const mockDoc = {
  createElement: (t: string) => new El(t),
  createElementNS: (_namespace: string, t: string) => new El(t),
} as unknown as Document;
const PX = 15; // twips per px, matching the backend
const installedFonts = {
  aliasFor: () => 'DocxFont_output_fixture',
};

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    pageWidth: 12240,
    pageHeight: 15840,
    margin: 1440,
    shaping: createDeterministicLayoutShaping(),
    ...over,
  };
}
function withTables() {
  const r = parseDocx(readFileSync(`${import.meta.dir}/../../../../../e2e/fixtures/with-tables.docx`));
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.model;
}

describe('layout -> DOM integration', () => {
  test('the DOM renders exactly the layout DisplayItems at the layout geometry', () => {
    const layout = layoutBody(withTables(), opts());
    const container = new El('div');
    renderToDom(layout, container, installedFonts, mockDoc);

    // One page element per layout page.
    expect(container.children.length).toBe(layout.pages.length);

    const layoutRects = layout.pages.flatMap((p) => p.items).filter((i) => i.type === 'rect');
    const layoutTexts = layout.pages.flatMap((p) => p.items).filter((i) => i.type === 'text');
    const domNodes = container.children.flatMap((page) => page.children);
    const descendants = (nodes: readonly El[]): El[] =>
      nodes.flatMap((node) => [node, ...descendants(node.children)]);
    const allNodes = descendants(domNodes);
    const domRects = domNodes.filter((n) => n.tag === 'div' && n.style.border);
    const domSpans = allNodes.filter((n) => n.tag === 'span');
    const domSvgs = allNodes.filter((n) => n.tag === 'svg');

    // 1:1 with the layout — nothing added or dropped by the backend.
    expect(domRects.length).toBe(layoutRects.length);
    expect(domSpans.length).toBe(layoutTexts.length);
    expect(domSvgs.length).toBe(layoutTexts.length);

    // Cell text is present and positioned from the layout item (no re-derivation).
    const a1 = domSpans.find((s) => s.textContent === 'A1');
    expect(a1).toBeDefined();
    const a1Item = layoutTexts.find((i) => i.type === 'text' && i.text === 'A1')!;
    const a1Wrapper = domNodes.find((node) =>
      node.children.some((child) => child.tag === 'span' && child.textContent === 'A1')
    )!;
    expect(a1Wrapper.style.left).toBe(`${a1Item.x / PX}px`);
    expect(a1Wrapper.style.top).toBe(`${a1Item.y / PX}px`);
    expect(a1Wrapper.style.width).toBe(`${a1Item.width / PX}px`);
    expect(a1Wrapper.style.height).toBe(`${a1Item.height / PX}px`);
    expect(a1!.style.position).toBe('absolute');
    expect(a1!.style.width).toBe('1px');
    expect(a1!.style.height).toBe('1px');
    expect(a1!.style.pointerEvents).toBe('none');
    expect(a1!.style.fontFamily).toBeUndefined();
    const a1Svg = domSvgs.find(
      (svg) => svg.getAttribute('data-para') === a1Item.anchor.paragraphId
    )!;
    expect(a1Svg.getAttribute('aria-hidden')).toBe('true');
    expect(a1Svg.children.map((path) => path.getAttribute('d'))).toEqual(
      a1Item.shapedRun.glyphs.map((glyph) => glyph.outline.path)
    );
    expect(a1Svg.children.map((path) => path.getAttribute('transform'))).toEqual(
      a1Item.shapedRun.glyphs.map((glyph) => {
        const scale = (a1Item.fontSizeHalfPoints * 2) / 3 / glyph.outline.unitsPerEm;
        return `translate(${(glyph.originX + glyph.offsetX) / PX} ${
          (a1Item.baseline - a1Item.y - glyph.originY - glyph.offsetY) / PX
        }) scale(${scale} ${-scale})`;
      })
    );
    // Anchors survive for hit-testing/navigation.
    expect(a1!.getAttribute('data-para')).toBe(
      a1Item.type === 'text' ? a1Item.anchor.paragraphId : ''
    );
  });

  test('adjacent DOM run boxes meet at the layout caret boundary', () => {
    const source = layoutBody(withTables(), opts());
    const first = source.pages.flatMap((page) => page.items).find((item) => item.type === 'text');
    if (!first || first.type !== 'text') throw new Error('fixture needs text');
    const second = {
      ...first,
      x: first.x + first.width,
      text: `${first.text} next`,
      anchor: { ...first.anchor, offset: first.anchor.offset + first.text.length },
    };
    const layout = {
      ...source,
      pages: [{ ...source.pages[0]!, items: [first, second] }],
    };
    const container = new El('div');

    renderToDom(layout, container, installedFonts, mockDoc);

    const wrappers = container.children
      .flatMap((page) => page.children)
      .filter((node) => node.tag === 'div');
    const firstSpan = wrappers.find(
      (node) =>
        node.style.left === `${first.x / PX}px` &&
        node.children.some((child) => child.textContent === first.text)
    )!;
    const secondSpan = wrappers.find(
      (node) =>
        node.style.left === `${second.x / PX}px` &&
        node.children.some((child) => child.textContent === second.text)
    )!;
    expect(Number.parseFloat(firstSpan.style.left) + Number.parseFloat(firstSpan.style.width)).toBe(
      Number.parseFloat(secondSpan.style.left)
    );
  });
});
