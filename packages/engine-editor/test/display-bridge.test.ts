// The display bridge reconciles the engine layout IR (twips, {type}, anchors) with the contract
// display IR (px, {kind}, GlyphRuns) — the single reconciliation point for both adapters (4.3).

import { describe, expect, test } from 'bun:test';
import { toDisplayPages } from '../src/display-bridge.ts';
import type { Page } from '@docx-editor.dev/engine-layout';

const page = (items: Page['items']): Page => ({ index: 0, width: 12240, height: 15840, items });

describe('engine layout IR -> contract display IR', () => {
  test('page dimensions convert twips -> px (1440 twips/in -> 96 px/in)', () => {
    const [p] = toDisplayPages([page([])]);
    expect(p.box).toEqual({ x: 0, y: 0, width: 12240 / 15, height: 15840 / 15 });
    expect(p.box.width).toBe(816); // 8.5in * 96
  });

  test('a text item becomes a contract text item with one GlyphRun in px', () => {
    const [p] = toDisplayPages([
      page([{ type: 'text', x: 1440, y: 1440, width: 300, height: 240, text: 'hi', bold: true, italic: false, anchor: { paragraphId: 'p1', offset: 5 } }]),
    ]);
    const item = p.items[0];
    expect(item.kind).toBe('text');
    if (item.kind !== 'text') throw new Error('expected text');
    expect(item.box).toEqual({ x: 96, y: 96, width: 20, height: 16 });
    expect(item.runs).toHaveLength(1);
    expect(item.runs[0]).toMatchObject({ text: 'hi', bold: true, italic: false, fontFamily: 'Helvetica' });
    expect(item.docFrom).toBe(5); // flat view offset = paragraph base (0, first para) + anchor.offset (5)
    expect(item.docTo).toBe(7); // + UTF-16 length of 'hi'
    expect(item.scope).toEqual({ kind: 'body' });
  });

  test('distinct paragraphs get distinct block ids in first-seen order', () => {
    const [p] = toDisplayPages([
      page([
        { type: 'text', x: 0, y: 0, width: 10, height: 240, text: 'a', bold: false, italic: false, anchor: { paragraphId: 'pA', offset: 0 } },
        { type: 'text', x: 0, y: 240, width: 10, height: 240, text: 'b', bold: false, italic: false, anchor: { paragraphId: 'pB', offset: 0 } },
        { type: 'text', x: 20, y: 0, width: 10, height: 240, text: 'a2', bold: false, italic: false, anchor: { paragraphId: 'pA', offset: 1 } },
      ]),
    ]);
    const ids = p.items.map((i) => (i.kind === 'text' ? i.blockId : -1));
    expect(ids).toEqual([0, 1, 0]); // pA=0, pB=1, pA reused
  });

  test('text doc-offsets accumulate across the view (UTF-16 length), never colliding', () => {
    const [p] = toDisplayPages([
      page([
        { type: 'text', x: 0, y: 0, width: 10, height: 240, text: 'ab', bold: false, italic: false, anchor: { paragraphId: 'p1', offset: 0 } },
        { type: 'text', x: 0, y: 240, width: 10, height: 240, text: '😀', bold: false, italic: false, anchor: { paragraphId: 'p2', offset: 0 } },
      ]),
    ]);
    const [a, b] = p.items;
    if (a.kind !== 'text' || b.kind !== 'text') throw new Error('text');
    expect([a.docFrom, a.docTo]).toEqual([0, 2]); // 'ab'
    expect(b.docFrom).toBe(3); // 2 + a boundary; strictly greater than a.docTo
    expect(b.docTo).toBe(3 + '😀'.length); // UTF-16 length (2), matching the layout's advance
  });

  test('a rect with fill + stroke becomes a fill item and a 4-segment tableBorder', () => {
    const [p] = toDisplayPages([
      page([{ type: 'rect', x: 150, y: 150, width: 600, height: 300, stroke: true, fill: 'DDDDDD' }]),
    ]);
    expect(p.items.map((i) => i.kind)).toEqual(['fill', 'tableBorder']);
    const fill = p.items[0];
    const border = p.items[1];
    if (fill.kind !== 'fill' || border.kind !== 'tableBorder') throw new Error('shape');
    expect(fill.color).toEqual({ kind: 'hex', value: 'DDDDDD' });
    expect(fill.box).toEqual({ x: 10, y: 10, width: 40, height: 20 });
    expect(border.segments).toHaveLength(4);
  });
});
