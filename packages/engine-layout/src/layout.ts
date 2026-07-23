// Deterministic body layout (document-engine section 8 core / design D7). Reads
// the authored model and a metrics port, breaks paragraphs into lines by advance
// width, paginates by height, and emits an anchored DisplayItem[]. All arithmetic
// is integer/fixed-point, so the same model + ports + config produce byte-identical
// pages in browser, worker, and server (the cross-runtime comparator, gate 9).

import {
  bodyStoryId,
  type PackageModel,
  type Block,
  type ParagraphRecord,
  type TableRecord,
  type TableRowRecord,
  type TableCellRecord,
} from '@docx-editor.dev/engine-core';

/** Expand block-level SDTs (content controls) into their nested blocks so downstream
 *  flow code sees only paragraphs and tables. A content control is transparent to
 *  layout; its control kind does not change how the content flows. */
function flattenSdt(blocks: readonly Block[]): (ParagraphRecord | TableRecord)[] {
  const out: (ParagraphRecord | TableRecord)[] = [];
  for (const b of blocks) {
    if (b.kind === 'sdt') out.push(...flattenSdt(b.blocks));
    else out.push(b);
  }
  return out;
}
import type { MetricsPort } from './metrics.ts';
import type { DisplayItem, Page, LayoutResult, TextItem, RectItem } from './display-item.ts';

// Layout coordinates are in twips (the page and metrics are twips), and OOXML grid
// widths are already twips — so column widths are used directly, never rescaled.
const CELL_PAD = 60; // ~4px of cell padding, in twips

export interface LayoutOptions {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly margin: number;
  readonly metrics: MetricsPort;
}

class PageBuilder {
  private readonly pages: Page[] = [];
  private items: DisplayItem[] = [];
  private pageIndex = 0;

  constructor(private readonly width: number, private readonly height: number) {}

  push(item: DisplayItem): void {
    this.items.push(item);
  }

  break(): void {
    this.pages.push({ index: this.pageIndex, width: this.width, height: this.height, items: this.items });
    this.items = [];
    this.pageIndex += 1;
  }

  finish(): Page[] {
    this.break();
    return this.pages;
  }
}

export function layoutBody(model: PackageModel, opts: LayoutOptions): LayoutResult {
  const { pageWidth, pageHeight, margin, metrics } = opts;
  const contentRight = pageWidth - margin;
  const contentBottom = pageHeight - margin;
  const builder = new PageBuilder(pageWidth, pageHeight);

  let x = margin;
  let y = margin;

  const newLine = (): void => {
    y += metrics.lineHeight;
    x = margin;
    if (y + metrics.lineHeight > contentBottom) {
      builder.break();
      y = margin;
    }
  };

  const story = model.stories.get(bodyStoryId(model))!;
  // A block-level SDT (content control) is transparent to flow layout: its nested blocks
  // lay out in place, so the loop recurses through SDT content rather than special-casing
  // each control kind. Tables paginate via layoutTable; everything else is a paragraph.
  const layoutBlocks = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        y = layoutTable(block, { margin, contentRight, contentBottom, metrics, builder }, y);
        x = margin;
        continue;
      }
      if (block.kind === 'sdt') {
        layoutBlocks(block.blocks);
        continue;
      }
      layoutParagraph(block);
    }
  };
  const layoutParagraph = (p: ParagraphRecord): void => {
    let offset = 0;
    for (const run of p.runs) {
      const bold = run.props?.bold === true;
      const italic = run.props?.italic === true;
      // Split into words and whitespace groups, preserving offsets.
      const parts = run.text.split(/(\s+)/);
      for (const part of parts) {
        if (part.length === 0) continue;
        if (/^\s+$/.test(part)) {
          x += metrics.spaceWidth * part.length;
          offset += part.length;
          continue;
        }
        let wordWidth = 0;
        for (const ch of part) wordWidth += metrics.advance(ch, bold, italic);
        if (x + wordWidth > contentRight && x > margin) newLine();
        const item: TextItem = {
          type: 'text',
          x,
          y,
          width: wordWidth,
          height: metrics.lineHeight,
          text: part,
          bold,
          italic,
          anchor: { paragraphId: p.id, offset },
        };
        builder.push(item);
        x += wordWidth;
        offset += part.length;
      }
    }
    newLine(); // paragraph break
  };

  layoutBlocks(story.blocks);

  return { pages: builder.finish(), status: 'converged' };
}

interface TableCtx {
  readonly margin: number;
  readonly contentRight: number;
  readonly contentBottom: number;
  readonly metrics: MetricsPort;
  readonly builder: PageBuilder;
}

/**
 * Lay out a TOP-LEVEL table with row pagination. Column widths come from the grid (or
 * an even split); each row is emitted via the shared `emitRow`, and a row that would
 * not fit forces a page break first (a single row is not split across pages, v1).
 * Returns the y just below the table.
 */
function layoutTable(table: TableRecord, ctx: TableCtx, startY: number): number {
  const { margin, contentRight, contentBottom, metrics, builder } = ctx;
  const cols = columnWidths(table, contentRight - margin);
  const push = (it: DisplayItem): void => builder.push(it);
  // Leading rows flagged w:tblHeader repeat atop each page the table continues onto.
  const headerRows: TableRowRecord[] = [];
  for (const row of table.rows) {
    if (row.props?.isHeader) headerRows.push(row);
    else break;
  }
  let y = startY;
  for (const row of table.rows) {
    const isHeader = row.props?.isHeader === true;
    if (y + metrics.lineHeight + 2 * CELL_PAD > contentBottom && y > margin) {
      builder.break();
      y = margin;
      // Re-emit the header rows before a continuing body row (not before a header itself).
      if (!isHeader) for (const hr of headerRows) y = emitRow(hr, cols, margin, y, metrics, push);
    }
    y = emitRow(row, cols, margin, y, metrics, push);
  }
  return y;
}

/** Emit a table within [left,right] from `top` with NO pagination (used for nested
 *  tables inside a cell). Returns the y just below the table. */
function emitTable(table: TableRecord, left: number, right: number, top: number, metrics: MetricsPort, push: (it: DisplayItem) => void): number {
  const cols = columnWidths(table, right - left);
  let y = top;
  for (const row of table.rows) y = emitRow(row, cols, left, y, metrics, push);
  return y;
}

/** Emit one row: place each cell in its column box, flow its content (paragraphs and
 *  nested tables), size the row to its tallest cell, and push a border/shading rect
 *  per cell. Returns the row's bottom y. */
function emitRow(row: TableRowRecord, cols: readonly number[], left: number, rowTop: number, metrics: MetricsPort, push: (it: DisplayItem) => void): number {
  const total = cols.reduce((a, b) => a + b, 0);
  const cellData: { rect: RectItem; items: DisplayItem[] }[] = [];
  let rowBottom = rowTop + metrics.lineHeight + 2 * CELL_PAD; // min row height
  let colCursor = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.props?.gridSpan ?? 1);
    const cellX = left + sumCols(cols, 0, colCursor);
    const cellW = sumCols(cols, colCursor, Math.min(colCursor + span, cols.length)) || total;
    colCursor += span;
    const items: DisplayItem[] = [];
    // A vMerge cell that is not the restart (explicit "continue" or a bare <w:vMerge/>)
    // continues the cell above: it emits NO content, so text is never duplicated.
    // (Full vertical-span rect height is a refinement; the box is still drawn.)
    const vm = cell.props?.vMerge;
    const isVMergeContinue = vm !== undefined && vm.val !== 'restart';
    if (!isVMergeContinue) {
      const bottom = flowCell(cell, cellX + CELL_PAD, cellX + cellW - CELL_PAD, rowTop + CELL_PAD, metrics, (it) => items.push(it));
      if (bottom + CELL_PAD > rowBottom) rowBottom = bottom + CELL_PAD;
    }
    const fill = shadeFill(cell);
    cellData.push({ rect: { type: 'rect', x: cellX, y: rowTop, width: cellW, height: 0, stroke: true, ...(fill ? { fill } : {}) }, items });
  }
  const rowHeight = rowBottom - rowTop;
  for (const { rect, items } of cellData) {
    push({ ...rect, height: rowHeight }); // border/shading sized to the row
    for (const it of items) push(it);
  }
  return rowBottom;
}

/** Column widths in twips: from the grid when present, else even distribution. */
function columnWidths(table: TableRecord, contentWidth: number): number[] {
  if (table.grid && table.grid.length > 0) {
    return table.grid.map((c) => {
      const tw = c.w !== undefined ? Number(c.w) : NaN;
      return Number.isFinite(tw) && tw > 0 ? Math.round(tw) : Math.round(contentWidth / table.grid!.length);
    });
  }
  const colCount = Math.max(1, ...table.rows.map((r) => r.cells.reduce((n, c) => n + Math.max(1, c.props?.gridSpan ?? 1), 0)));
  const w = Math.floor(contentWidth / colCount);
  return Array.from({ length: colCount }, () => w);
}

function sumCols(cols: readonly number[], from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to && i < cols.length; i += 1) s += cols[i];
  return s;
}

function shadeFill(cell: TableCellRecord): string | undefined {
  const fill = cell.props?.shading?.fill;
  return fill && fill !== 'auto' && /^[0-9a-fA-F]{6}$/.test(fill) ? fill : undefined;
}

/** Flow a cell's blocks within [left,right] from `top`; returns bottom y. No
 *  pagination inside a cell (v1). Paragraphs flow line-by-line; a NESTED table is laid
 *  out with its own declared geometry (rows/cells/rects) inside the cell box. */
function flowCell(cell: TableCellRecord, left: number, right: number, top: number, metrics: MetricsPort, push: (it: DisplayItem) => void): number {
  let x = left;
  let y = top;
  let started = false;
  const width = Math.max(right - left, metrics.spaceWidth);
  for (const block of flattenSdt(cell.blocks)) {
    if (block.kind === 'table') {
      if (started) y += metrics.lineHeight; // gap before the nested table
      y = emitTable(block, left, right, y, metrics, push);
      started = true;
      x = left;
      continue;
    }
    if (started) {
      y += metrics.lineHeight;
      x = left;
    }
    started = true;
    let offset = 0;
    for (const run of block.runs) {
      const bold = run.props?.bold === true;
      const italic = run.props?.italic === true;
      for (const part of run.text.split(/(\s+)/)) {
        if (part.length === 0) continue;
        if (/^\s+$/.test(part)) {
          x += metrics.spaceWidth * part.length;
          offset += part.length;
          continue;
        }
        let wordWidth = 0;
        for (const ch of part) wordWidth += metrics.advance(ch, bold, italic);
        if (x + wordWidth > left + width && x > left) {
          y += metrics.lineHeight;
          x = left;
        }
        push({ type: 'text', x, y, width: wordWidth, height: metrics.lineHeight, text: part, bold, italic, anchor: { paragraphId: block.id, offset } });
        x += wordWidth;
        offset += part.length;
      }
    }
  }
  return y + metrics.lineHeight;
}

/**
 * Hit-test a point against a page's display items (design D7). Returns the anchor
 * under the point, refined to a character offset within the item by advance. The
 * same inverse the DOM/PDF backends use — geometry is never re-derived.
 */
export function hitTest(result: LayoutResult, pageIndex: number, px: number, py: number, metrics: MetricsPort): TextItem['anchor'] | undefined {
  const page = result.pages[pageIndex];
  if (!page) return undefined;
  for (const item of page.items) {
    if (item.type !== 'text') continue;
    if (px >= item.x && px < item.x + item.width && py >= item.y && py < item.y + item.height) {
      // Refine to a character offset within the run by cumulative advance.
      let cursor = item.x;
      let i = 0;
      for (const ch of item.text) {
        const w = metrics.advance(ch, item.bold, item.italic);
        if (px < cursor + w / 2) break;
        cursor += w;
        i += 1;
      }
      return { paragraphId: item.anchor.paragraphId, offset: item.anchor.offset + i };
    }
  }
  return undefined;
}
