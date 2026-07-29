// Output capability registry (comprehensive 3.8). renderPageElement dispatches each display item
// through its registered renderer, painting by ascending layer (rects behind text); an unknown
// item kind fails closed. This proves the built-ins render and the layer order is preserved.

import { describe, expect, test } from 'bun:test';
import { renderPageElement } from '../dom.ts';
import {
  registerDisplayItemRenderer,
  renderDisplayItem,
  displayItemLayer,
} from '../output-capabilities.ts';
import type { Page, DisplayItem } from '@docx-editor.dev/core-contract/layout';

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
const mockDoc = {
  createElement: (t: string) => new El(t),
  createElementNS: (_namespace: string, t: string) => new El(t),
} as unknown as Document;

const TEST_LINE = {
  lineId: 'test:L0',
  fragmentId: 'test:L0:F0',
  lineIndex: 0,
  fragmentIndex: 0,
} as const;
const TEST_FONT = {
  id: 'test',
  identity: `sha256:${'1'.repeat(64)}#0`,
  family: 'Test',
  request: { family: 'Test', weight: 400, style: 'normal' as const },
  hash: `sha256:${'1'.repeat(64)}`,
  faceIndex: 0,
  byteLength: 12,
  substitution: null,
};
const text = (value: string, x: number, offset: number) => ({
  type: 'text' as const,
  x,
  y: 0,
  width: 10,
  height: 20,
  ascent: 16,
  descent: 4,
  lineGap: 0,
  baseline: 16,
  text: value,
  bold: false,
  italic: false,
  direction: 'ltr' as const,
  fontSizeHalfPoints: 24,
  color: '000000',
  shapingEnvironment: { font: TEST_FONT, features: [], fixedPointScale: 20 },
  shapedRun: {
    glyphs: [
      {
        id: 1,
        cluster: 0,
        originX: 0,
        originY: 0,
        advanceX: 10,
        advanceY: 0,
        offsetX: 0,
        offsetY: 0,
        outline: { path: 'M0,0L1,0Z', unitsPerEm: 1000 },
      },
    ],
  },
  anchor: { paragraphId: 'p', offset },
  line: TEST_LINE,
});

describe('output capability registry', () => {
  test('rects paint before text (layer order), preserving document order within a layer', () => {
    const page = {
      index: 0,
      width: 12240,
      height: 15840,
      items: [
        text('A', 0, 0),
        { type: 'rect', x: 0, y: 0, width: 100, height: 40, stroke: true },
        text('B', 20, 1),
      ],
    } as unknown as Page;
    const el = renderPageElement(
      page,
      { aliasFor: () => 'DocxFont_capability' },
      mockDoc
    ) as unknown as El;
    // First the rect (layer 0), then the two text wrappers in order (layer 1).
    expect(el.children.map((c) => c.tag)).toEqual(['div', 'div', 'div']);
    expect(
      el.children
        .slice(1)
        .map((wrapper) => wrapper.children.find((child) => child.tag === 'span')?.textContent)
    ).toEqual(['A', 'B']);
  });

  test('display-item layers: rect behind text', () => {
    expect(displayItemLayer('rect')).toBe(0);
    expect(displayItemLayer('text')).toBe(1);
  });

  test('a duplicate renderer registration is rejected', () => {
    expect(() =>
      registerDisplayItemRenderer('text', () => mockDoc.createElement('span'), 1)
    ).toThrow(/duplicate display-item renderer/);
  });

  test('an unknown display-item kind fails closed', () => {
    expect(() =>
      renderDisplayItem({ type: 'hologram' } as unknown as DisplayItem, mockDoc)
    ).toThrow(/no display-item renderer registered/);
  });
});
