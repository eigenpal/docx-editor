// When a vertical merge is allowed to size its span, and what happens when it is not.
//
// Giving the span its own height is only safe while every row of it lands on one page and
// the span really can hold the merged content. Where either is untrue the merge has to stay
// on the row-by-row path, because a merged cell whose content is not bounded by its span
// paints past the box it owns. Content outside its box is worse than the row heights this
// file's sibling fixes, so every case here asserts the merged content is inside its CELL —
// inside the page is not the same claim, and a cell's content is `overflow: visible`.

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

/**
 * Every painted cell keeps its content inside its own box, and every box inside its table.
 *
 * The page-level check is not enough on its own: a merged head that outlives the rows under
 * it paints below the table's bottom border with no cell around it, and still lands well
 * inside the page.
 */
function expectContentInsideItsTable(layout: SemanticLayout): void {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      const tableBottom = fragment.box.y + fragment.box.height;
      for (const row of fragment.rows) {
        for (const cell of row.cells) {
          if (cell.blocks.length === 0) continue;
          const cellBottom = cell.box.y + cell.box.height;
          expect(contentBottomOf(cell)).toBeLessThanOrEqual(cellBottom + 0.001);
          expect(cellBottom).toBeLessThanOrEqual(tableBottom + 0.001);
        }
      }
    }
  }
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
    expectContentInsideItsTable(layout);
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
    expectContentInsideItsTable(layout);
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
    // The span cannot hold the head, so the head keeps sizing its own row and the exact
    // height clips it there: one line, inside the 20pt row, the way Word draws it.
    expect(contentBottomOf(head)).toBeLessThanOrEqual(head.box.y + 20 + 0.001);
    expectContentInsideItsTable(layout);
    expect(paintedBottomPt(layout, 0)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
  });

  test('a merge over a row that heads another merge is left alone', () => {
    // Column 0 merges rows 0-1 and column 1 restarts at row 1. Row 1 therefore sizes itself
    // around the second head whenever that one is not planned, which is a height the first
    // span never measured, and the row can then take the whole-row move and leave the first
    // span's content on the page above with no table under it. Nothing revokes a span once
    // its head content has been placed, so the first span is not taken at all.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}<w:tbl>${GRID}` +
          `<w:tr>${tc(p('A0') + p('A1'), RESTART)}${tc(p('b0'))}</w:tr>` +
          `<w:tr>${tc(p('a1'), CONTINUE)}${tc(MERGED_CONTENT, RESTART)}</w:tr>` +
          `<w:tr>${tc(p('a2'))}${tc(p('b2'), CONTINUE)}</w:tr>` +
          `<w:tr>${tc(p('a3'))}${tc(p('b3'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    // The two-line head sizes its own row, so its content has a cell around it.
    const first = tablesOf(layout, 0)[0]!;
    const head = first.rows[0]!.cells[0]!;
    expect(head.rowSpan).toBe(1);
    expect(contentBottomOf(head)).toBeGreaterThan(first.box.y + 18);
    expectContentInsideItsTable(layout);
    // The merge that starts BELOW it is still planned, on the page it moves to.
    const carried = tablesOf(layout, 1)[0]!;
    expect(carried.rows[0]!.cells[1]!.rowSpan).toBe(2);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });

  test('an exact head row fixes the ROW, and the merged content flows on through the span', () => {
    // `hRule="exact"` is a height for the row (17.18.37), not a lid on a merged cell that
    // covers rows below it. Clipping the head to its own row while the span reserved the
    // surplus somewhere else left a tall blank band under one visible line.
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${exactRow(400)}${tc(MERGED_CONTENT, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          `<w:tr>${tc(p('c0'))}${tc(p('c1'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    const table = tablesOf(layout, 0)[0]!;
    const head = table.rows[0]!.cells[0]!;
    expect(table.rows[0]!.box.height).toBe(20);
    expect(head.rowSpan).toBe(2);
    // All five lines are painted, inside the merged box — not one line and a blank band.
    const lineCount = head.blocks.filter((block) => block.kind === 'paragraph').length;
    expect(lineCount).toBe(5);
    expect(head.box.height).toBe(20 + table.rows[1]!.box.height);
    expectContentInsideItsTable(layout);
  });

  test('a head taller than a page paginates instead of losing its tail', () => {
    // A detached head answers to the page, so it splits and continues like any other cell.
    // Bounding it by its span instead swallowed everything past the span's bottom: the
    // fragment reported itself complete, no remainder was carried, and the tail was gone.
    const nine = Array.from({ length: 9 }, (_, index) => p(`T${index}`)).join('');
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(nine, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    const painted = layout.pages
      .flatMap((page) => page.fragments)
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .flatMap((table) => table.rows)
      .flatMap((row) => row.cells)
      .flatMap((cell) => cell.blocks)
      .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
      .flatMap((line) => line.spans)
      .map((span) => span.text)
      .join(' ');
    for (let index = 0; index < 9; index += 1) expect(painted).toContain(`T${index}`);
    expectContentInsideItsTable(layout);
  });

  test('a row that starts two merges is measured with the head that stayed in it', () => {
    // Row 0 heads both columns. Whichever merge is not planned goes on sizing row 0, so the
    // row's planned height has to include it. Measuring the row without the content the plan
    // detached judged it against a height nobody would place and broke the page under it.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}<w:tbl>${GRID}` +
          `<w:tr>${tc(p('A0') + p('A1') + p('A2'), RESTART)}${tc(p('B0') + p('B1') + p('B2'), RESTART)}</w:tr>` +
          `<w:tr>${tc(p('a1'), CONTINUE)}${tc(p('b1'), CONTINUE)}</w:tr>` +
          `<w:tr>${tc(p('a2'), CONTINUE)}${tc(p('b2'))}</w:tr>` +
          `<w:tr>${tc(p('a3'), CONTINUE)}${tc(p('b3'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    // The row after the heads shares their page: no break opened under a mostly empty page.
    expect(tablesOf(layout, 0)[0]!.rows.length).toBeGreaterThanOrEqual(2);
    expectContentInsideItsTable(layout);
  });

  test('the unsplit placement bounds a detached head by the page too', () => {
    // The unsplit branch places a row with no bound and then compares its bottom against the
    // page — a check a detached head is invisible to, because the row does not carry its
    // height. Left unbounded there, the head painted below the page content box outright.
    // Nine lines do not fit an 80pt page, so the head has to split whatever branch it takes.
    const nine = Array.from({ length: 9 }, (_, index) => p(`T${index}`)).join('');
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(nine, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
    expectContentInsideItsTable(layout);
  });

  test('a covered row that can place nothing paginates instead of aborting the table', () => {
    // Refusing the recovery breaks for a covered row turned any probe-versus-placement
    // divergence into `TablePaginationError` for the whole table. `w:cantSplit` on a covered
    // row is the shape that reaches one of those breaks without any divergence at all.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}${p('F2')}<w:tbl>${GRID}` +
          `<w:tr>${tc(p('head'), RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
          `${tc(p('ghost'), CONTINUE)}${tc(MERGED_CONTENT)}</w:tr>` +
          '</w:tbl>'
      )
    );
    // Pinned, not just "more than none": the claim is that this lays out rather than
    // aborting, and a page count is the difference between the two.
    expect(layout.pages).toHaveLength(2);
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });

  test('a row holding nothing but a merge head is still a line tall', () => {
    // Detaching a head takes it out of its row's height, and in a single-column table that
    // is the only cell there is — so nothing raised the row and it collapsed to zero, with
    // the row below it starting at the same y. Word draws that row a line tall. The two
    // height passes skip detached cells on purpose; the floor has to come from somewhere
    // else.
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(p('head'), RESTART)}</w:tr>` +
          `<w:tr>${tc(p('g'), CONTINUE)}</w:tr>` +
          '</w:tbl>'
      )
    );
    const table = tablesOf(layout, 0)[0]!;
    expect(table.rows[0]!.box.height).toBeGreaterThan(12);
    expect(table.rows[1]!.box.y).toBe(table.rows[0]!.box.y + table.rows[0]!.box.height);
    expect(table.box.height).toBe(table.rows[0]!.box.height + table.rows[1]!.box.height);
    expectContentInsideItsTable(layout);
  });

  test('two merges starting in the SAME row keep their content inside the table', () => {
    // Both cells of row 0 restart a merge over rows 0-1. Accepting the second detaches it
    // from row 0 as well, which empties row 0 of everything it had and changes what the
    // FIRST span covers. A height captured for that span when it was admitted describes a
    // row that no longer exists, and its content painted below the table's bottom border.
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(MERGED_CONTENT, RESTART)}${tc(p('b0'), RESTART)}</w:tr>` +
          `<w:tr>${tc(p('a1'), CONTINUE)}${tc(p('b1'), CONTINUE)}</w:tr>` +
          '</w:tbl>'
      )
    );
    const table = tablesOf(layout, 0)[0]!;
    expect(table.rows[0]!.cells[0]!.rowSpan).toBe(2);
    expect(table.rows[0]!.cells[1]!.rowSpan).toBe(2);
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
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
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });
});
