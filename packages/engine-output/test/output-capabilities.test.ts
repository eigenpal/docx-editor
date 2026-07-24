// Output capability registry (comprehensive 3.8). renderPageElement dispatches each display item
// through its registered renderer, painting by ascending layer (rects behind text); an unknown
// item kind fails closed. This proves the built-ins render and the layer order is preserved.

import { describe, expect, test } from 'bun:test';
import { renderPageElement } from '../src/dom.ts';
import { registerDisplayItemRenderer, renderDisplayItem, displayItemLayer } from '../src/output-capabilities.ts';
import type { Page, DisplayItem } from '@docx-editor.dev/engine-layout';

// Minimal DOM stand-in (renderPageElement only uses createElement/style/setAttribute/textContent/
// appendChild). children preserve insertion order so we can assert paint order.
class El {
  style: Record<string, string> = {};
  children: El[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: El) {
    this.children.push(c);
    return c;
  }
}
const mockDoc = { createElement: (t: string) => new El(t) } as unknown as Document;

const TEST_LINE = { lineId: 'test:L0', fragmentId: 'test:L0:F0', lineIndex: 0, fragmentIndex: 0 } as const;

describe('output capability registry', () => {
  test('rects paint before text (layer order), preserving document order within a layer', () => {
    const page: Page = {
      index: 0,
      width: 12240,
      height: 15840,
      items: [
        { type: 'text', x: 0, y: 0, width: 10, height: 20, text: 'A', bold: false, italic: false, anchor: { paragraphId: 'p', offset: 0 }, line: TEST_LINE },
        { type: 'rect', x: 0, y: 0, width: 100, height: 40, stroke: true },
        { type: 'text', x: 20, y: 0, width: 10, height: 20, text: 'B', bold: false, italic: false, anchor: { paragraphId: 'p', offset: 1 }, line: TEST_LINE },
      ],
    };
    const el = renderPageElement(page, mockDoc) as unknown as El;
    // First the rect (layer 0), then the two text spans in order (layer 1).
    expect(el.children.map((c) => c.tag)).toEqual(['div', 'span', 'span']);
    expect(el.children.filter((c) => c.tag === 'span').map((c) => c.textContent)).toEqual(['A', 'B']);
  });

  test('display-item layers: rect behind text', () => {
    expect(displayItemLayer('rect')).toBe(0);
    expect(displayItemLayer('text')).toBe(1);
  });

  test('a duplicate renderer registration is rejected', () => {
    expect(() => registerDisplayItemRenderer('text', () => mockDoc.createElement('span'), 1)).toThrow(
      /duplicate display-item renderer/,
    );
  });

  test('an unknown display-item kind fails closed', () => {
    expect(() => renderDisplayItem({ type: 'hologram' } as unknown as DisplayItem, mockDoc)).toThrow(
      /no display-item renderer registered/,
    );
  });
});
