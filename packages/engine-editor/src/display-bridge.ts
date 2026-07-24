// Reconcile the engine layout IR with the provisional contract display IR — ONCE, here, in the
// production composition (document-engine 4.3), not separately in each adapter. engine-layout emits
// twips-space `Page[]` with `{type:'text'|'rect'}` items anchored by {paragraphId, offset};
// the published `core-contract` geometry is 96 px/in `DisplayPage[]` with `{kind:'text'|'fill'|
// 'tableBorder'}` items carrying `GlyphRun`s + numeric doc positions. Both adapters consume the
// contract IR through `EditorHost.onDisplay`, so this mapping lives here and nowhere else.

import type { DisplayPage, DisplayItem as ContractItem, GlyphRun, BorderSeg } from '@docx-editor.dev/core-contract/geometry';
import type { ColorValue, Rect, ViewScope } from '@docx-editor.dev/core-contract/editor';
import type { Page, DisplayItem, TextItem, RectItem } from '@docx-editor.dev/engine-layout';

const TWIPS_PER_PX = 15; // 1440 twips/in ÷ 96 px/in
const px = (twips: number): number => twips / TWIPS_PER_PX;
const BLACK: ColorValue = { kind: 'hex', value: '000000' };
// The editor facade is body-only for now (headers/footers/notes are a later scope).
const BODY: ViewScope = { kind: 'body' };

const boxOf = (it: { x: number; y: number; width: number; height: number }): Rect => ({
  x: px(it.x),
  y: px(it.y),
  width: px(it.width),
  height: px(it.height),
});

function textItem(it: TextItem, blockId: number, docFrom: number): ContractItem {
  const box = boxOf(it);
  const run: GlyphRun = {
    text: it.text,
    box,
    fontFamily: 'Helvetica',
    fontSizePx: px(it.height) * 0.9, // leading -> glyph size (matches the PDF backend)
    color: BLACK,
    bold: it.bold,
    italic: it.italic,
  };
  return {
    kind: 'text',
    box,
    runs: [run],
    // docFrom/docTo are monotonic offsets ACROSS the addressed view (contract requirement), using
    // UTF-16 length to match the layout's own offset advance. They are a provisional flat-position
    // model: exact within-story selection mapping is a follow-up on the selection/hit-test lane;
    // rendering (box + runs) is exact.
    docFrom,
    docTo: docFrom + it.text.length,
    blockId,
    scope: BODY,
  };
}

function borderSegments(box: Rect): BorderSeg[] {
  const { x, y, width: w, height: h } = box;
  const edge = (from: { x: number; y: number }, to: { x: number; y: number }): BorderSeg => ({
    from,
    to,
    widthPx: 1,
    color: BLACK,
    style: 'single',
  });
  return [
    edge({ x, y }, { x: x + w, y }), // top
    edge({ x: x + w, y }, { x: x + w, y: y + h }), // right
    edge({ x, y: y + h }, { x: x + w, y: y + h }), // bottom
    edge({ x, y }, { x, y: y + h }), // left
  ];
}

function rectItems(it: RectItem): ContractItem[] {
  const box = boxOf(it);
  const out: ContractItem[] = [];
  if (it.fill) out.push({ kind: 'fill', box, color: { kind: 'hex', value: it.fill } });
  if (it.stroke) out.push({ kind: 'tableBorder', segments: borderSegments(box) });
  return out;
}

/** Map engine-layout pages to the contract display list (twips → px, anchors → GlyphRuns + doc
 *  positions). Block ids are assigned in first-seen paragraph order, and text doc-offsets accumulate
 *  monotonically across the whole view (all pages), both threaded through this single call. */
export function toDisplayPages(pages: readonly Page[]): DisplayPage[] {
  const blockIds = new Map<string, number>();
  const blockIdOf = (paragraphId: string): number => {
    let n = blockIds.get(paragraphId);
    if (n === undefined) {
      n = blockIds.size;
      blockIds.set(paragraphId, n);
    }
    return n;
  };
  let docOffset = 0; // running flat offset across the addressed view
  const bridgeItem = (it: DisplayItem): ContractItem[] => {
    switch (it.type) {
      case 'text': {
        const item = textItem(it, blockIdOf(it.anchor.paragraphId), docOffset);
        docOffset += it.text.length + 1; // + a boundary so consecutive runs never collide
        return [item];
      }
      case 'rect':
        return rectItems(it);
    }
  };
  return pages.map((page) => ({
    index: page.index,
    box: { x: 0, y: 0, width: px(page.width), height: px(page.height) },
    items: page.items.flatMap(bridgeItem),
  }));
}
