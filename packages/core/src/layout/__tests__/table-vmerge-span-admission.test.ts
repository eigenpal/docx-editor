// When a vertical merge is allowed to size its span, and what happens when it is not.
//
// Giving the span its own height is only safe while every row of it lands on one page and
// the span really can hold the merged content. Where either is untrue the merge has to stay
// on the row-by-row path, because a merged cell whose content is not bounded by its span
// paints past the page content box, and the sheet clips whatever crosses the paper edge.
// Content outside its box is worse than the row heights this file's sibling fixes.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  PageGeometry,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** 80pt of content box, and a 14pt line: every height below is checkable by hand. */
const TINY: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};
const CONTENT_BOTTOM_PT = 80;

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';
const exactRow = (twips: number) =>
  `<w:trPr><w:trHeight w:val="${twips}" w:hRule="exact"/></w:trPr>`;

const GRID =
  '<w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="8" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders></w:tblPr>';

/** Five lines of merged content: taller than any single row below asks to be. */
const MERGED_CONTENT = Array.from({ length: 5 }, (_, index) => p(`T${index}`)).join('');

const layoutTiny = (part: OoxmlPart): SemanticLayout =>
  layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer(), geometry: TINY });

function tablesOf(layout: SemanticLayout, pageIndex: number): TableFragmentRecord[] {
  return (layout.pages[pageIndex]?.fragments ?? []).filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
}

/** Lowest y anything is painted at on this page, whatever kind of fragment holds it. */
function paintedBottomPt(layout: SemanticLayout, pageIndex: number): number {
  let bottom = 0;
  const takeBlocks = (blocks: TableCellFragmentRecord['blocks']): void => {
    for (const block of blocks) bottom = Math.max(bottom, block.box.y + block.box.height);
  };
  for (const fragment of layout.pages[pageIndex]?.fragments ?? []) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
    if (fragment.kind === 'paragraph') takeBlocks([fragment]);
    if (fragment.kind !== 'table') continue;
    for (const row of fragment.rows) for (const cell of row.cells) takeBlocks(cell.blocks);
  }
  return bottom;
}

function contentBottomOf(cell: TableCellFragmentRecord): number {
  let bottom = Number.NEGATIVE_INFINITY;
  for (const block of cell.blocks) bottom = Math.max(bottom, block.box.y + block.box.height);
  return bottom;
}

describe('a merge is only sized as a span where the span can hold it', () => {
  test('a repeated header row on the next page does not let the merge overrun it', () => {
    // The merge does not fit the band it is offered in. Moving the row to a fresh page
    // re-emits the `w:tblHeader` row, so the page it lands on has LESS room than the one the
    // offer was judged against. Deciding before the move and not looking again let the head
    // detach anyway, and its content — no longer bounded by the row — painted past the box.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}<w:tbl>${GRID}` +
          `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H'))}${tc(p('Hb'))}</w:tr>` +
          `<w:tr>${tc(MERGED_CONTENT, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    expect(layout.pages).toHaveLength(3);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
    // And no page is spent on nothing: every page carries a body row, not just the repeat.
    for (const pageIndex of layout.pages.keys()) {
      const rows = tablesOf(layout, pageIndex).flatMap((table) => table.rows);
      if (rows.length === 0) continue;
      expect(rows.some((row) => row.isHeaderRepeat !== true)).toBe(true);
    }
  });

  test('the surplus skips a row Word clips: it goes to the last row that can grow', () => {
    // The span's last row is `hRule="exact"`, which fixes it at its authored box (17.18.37).
    // Handing it the surplus drops the surplus, and the merged content then runs past the
    // table it lives in. The head row is the last row of this span that can grow.
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(MERGED_CONTENT, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${exactRow(400)}${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>' +
          p('AFTER')
      )
    );
    const table = tablesOf(layout, 0)[0]!;
    const head = table.rows[0]!.cells[0]!;
    expect(head.rowSpan).toBe(2);
    // The exact row keeps its 20pt; the head row took the whole surplus.
    expect(table.rows[1]!.box.height).toBe(20);
    expect(table.rows[0]!.box.height).toBe(table.box.height - 20);
    expect(head.box.height).toBe(table.box.height);
    // Every line of the merged content is inside the merged cell, and so inside the table.
    expect(contentBottomOf(head)).toBeLessThanOrEqual(head.box.y + head.box.height + 0.001);
    expect(paintedBottomPt(layout, 0)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
  });

  test('a span where nothing can grow keeps its authored height and clips, like Word', () => {
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${exactRow(400)}${tc(MERGED_CONTENT, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${exactRow(400)}${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>' +
          p('AFTER')
      )
    );
    const table = tablesOf(layout, 0)[0]!;
    expect(table.rows.map((row) => row.box.height)).toEqual([20, 20]);
    const head = table.rows[0]!.cells[0]!;
    expect(head.box.height).toBe(40);
    // Clipped to the span, not painted past it.
    expect(contentBottomOf(head)).toBeLessThanOrEqual(head.box.y + 40 + 0.001);
    expect(paintedBottomPt(layout, 0)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
  });

  test('two merges in different columns are decided one at a time', () => {
    // Column 0 merges rows 0-1 and column 1 merges rows 1-2. Treating the two as one
    // keep-together block moved the whole table to the next page and left the first one
    // blank, and once such a chain outgrew a page it turned the plan off for every row.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}<w:tbl>${GRID}` +
          `<w:tr>${tc(p('a0'), RESTART)}${tc(p('b0'))}</w:tr>` +
          `<w:tr>${tc(p('a1'), CONTINUE)}${tc(MERGED_CONTENT, RESTART)}</w:tr>` +
          `<w:tr>${tc(p('a2'))}${tc(p('b2'), CONTINUE)}</w:tr>` +
          `<w:tr>${tc(p('a3'))}${tc(p('b3'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    // The first row still uses the room left on the page it was reached on.
    expect(tablesOf(layout, 0)[0]!.rows).toHaveLength(1);
    // The second merge is kept whole on the page it moved to, and its content fits it.
    const carried = tablesOf(layout, 1)[0]!;
    const merged = carried.rows[0]!.cells[1]!;
    expect(merged.rowSpan).toBe(2);
    expect(merged.box.height).toBe(carried.rows[0]!.box.height + carried.rows[1]!.box.height);
    expect(contentBottomOf(merged)).toBeLessThanOrEqual(merged.box.y + merged.box.height + 0.001);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });
});
