// Deterministic body layout (document-engine section 8 core / design D7). Reads
// the authored model and a metrics port, breaks paragraphs into lines by advance
// width, paginates by height, and emits an anchored DisplayItem[]. All arithmetic
// is integer/fixed-point, so the same model + ports + config produce byte-identical
// pages in browser, worker, and server (the cross-runtime comparator, gate 9).

import {
  bodyStoryId,
  blockRegistryVersion,
  blockNestedBlocks,
  type PackageModel,
  type Block,
  type ParagraphRecord,
  type TableRecord,
  type TableRowRecord,
  type TableCellRecord,
  type SdtRecord,
} from '@docx-editor.dev/engine-core';
import {
  registerBlockLayout,
  layoutBlock,
  assertLayoutLaneComplete,
  registerBlockDependencies,
  registerBlockSemanticRole,
  blockDependencies,
  type BlockLayoutContext,
  type LayoutBuilder,
} from './block-layout.ts';
import type { DependencyKey } from './dependency-graph.ts';

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
import { layoutParagraphInBox, type ParagraphLayoutSink } from './paragraph-layout.ts';

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

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly margin: number
  ) {}

  push(item: DisplayItem): void {
    this.items.push(item);
  }

  currentPageIndex(): number {
    return this.pageIndex;
  }

  break(): void {
    this.pages.push({
      index: this.pageIndex,
      width: this.width,
      height: this.height,
      contentBox: {
        x: this.margin,
        y: this.margin,
        width: Math.max(0, this.width - this.margin * 2),
        height: Math.max(0, this.height - this.margin * 2),
      },
      items: this.items,
    });
    this.items = [];
    this.pageIndex += 1;
  }

  finish(): Page[] {
    this.break();
    return this.pages;
  }
}

// The layout lane is verified when a document is laid out (comprehensive 3.9): every registered
// block kind must have a flow-layout handler. Keyed on the core block registry version (NOT a
// one-shot boolean) so a kind registered AFTER the first layout still re-validates. -1 forces the
// first layout to check.
let layoutLaneVerifiedAtVersion = -1;

export function layoutBody(model: PackageModel, opts: LayoutOptions): LayoutResult {
  const registryVersion = blockRegistryVersion();
  if (layoutLaneVerifiedAtVersion !== registryVersion) {
    assertLayoutLaneComplete();
    layoutLaneVerifiedAtVersion = registryVersion;
  }
  const { pageWidth, pageHeight, margin, metrics } = opts;
  const contentRight = pageWidth - margin;
  const contentBottom = pageHeight - margin;
  const builder = new PageBuilder(pageWidth, pageHeight, margin);

  // The shared mutable layout context: each block kind's registered handler advances the cursor and
  // pushes items through it; a container kind recurses via ctx.layoutBlocks. No block.kind switch.
  const ctx: BlockLayoutContext = {
    margin,
    contentRight,
    contentBottom,
    metrics,
    builder,
    x: margin,
    y: margin,
    newLine() {
      this.y += metrics.lineHeight;
      this.x = margin;
      if (this.y + metrics.lineHeight > contentBottom) {
        builder.break();
        this.y = margin;
      }
    },
    layoutBlocks(blocks) {
      for (const block of blocks) layoutBlock(block, this);
    },
  };

  const story = model.stories.get(bodyStoryId(model))!;
  ctx.layoutBlocks(story.blocks);

  return { pages: builder.finish(), status: 'converged' };
}

// Register the built-in block-layout handlers (comprehensive 3.7). A block-level SDT (content
// control) is TRANSPARENT to flow layout — its nested blocks lay out in place through the same
// dispatch; tables paginate via layoutTable; a paragraph breaks into lines by advance width.
registerBlockLayout('sdt', (block, ctx) => ctx.layoutBlocks((block as SdtRecord).blocks));

registerBlockLayout('table', (block, ctx) => {
  ctx.y = layoutTable(
    block as TableRecord,
    {
      margin: ctx.margin,
      contentRight: ctx.contentRight,
      contentBottom: ctx.contentBottom,
      metrics: ctx.metrics,
      builder: ctx.builder,
    },
    ctx.y
  );
  ctx.x = ctx.margin;
});

registerBlockLayout('paragraph', (block, ctx) => {
  const cursor = { x: ctx.x, y: ctx.y };
  const next = layoutParagraphInBox(
    block as ParagraphRecord,
    cursor,
    ctx.margin,
    ctx.contentRight,
    ctx.metrics,
    ctx.builder,
    () => {
      ctx.newLine();
      cursor.x = ctx.x;
      cursor.y = ctx.y;
    }
  );
  ctx.x = next.x;
  ctx.y = next.y;
});

// Built-in resolution-dependency + semantic-role lanes (comprehensive 3.6). These declare a block's
// INTRINSIC + NESTED-child dependencies (feeding the 8.2 closure that gates 8.3 cache reuse) and its
// a11y role. NOTE (scope boundary): the block-level extractor cannot see its containing story or
// section — those CONTEXTUAL edges (section page geometry) are added by the graph builder that
// composes the document, which has that context; here each block declares only what it reads itself
// plus its children's composed dependencies. Every content block also reads document defaults.
const DOC_DEFAULTS: DependencyKey = { kind: 'style', id: 'docDefaults' };

registerBlockDependencies('paragraph', (block) => {
  const p = block as ParagraphRecord;
  const deps: DependencyKey[] = [DOC_DEFAULTS];
  if (p.props?.styleId) deps.push({ kind: 'style', id: p.props.styleId }); // paragraph style
  if (p.props?.numId) deps.push({ kind: 'numbering', id: p.props.numId }); // list numbering
  for (const r of p.runs) if (r.props?.styleId) deps.push({ kind: 'style', id: r.props.styleId }); // character styles
  return deps;
});
registerBlockSemanticRole('paragraph', 'paragraph');

registerBlockDependencies('table', (block) => {
  const t = block as TableRecord;
  // A table STYLE is a style identity (StyleRecord type 'table'), NOT a separate 'table' key — so a
  // change to that style value invalidates cached table layout through the same style closure.
  const deps: DependencyKey[] = [DOC_DEFAULTS];
  if (t.props?.styleId) deps.push({ kind: 'style', id: t.props.styleId });
  // Compose the nested cells' block dependencies (a cached table reuse must invalidate when any
  // nested paragraph's style/numbering changes). Each nested block's own extractor recurses.
  for (const nested of blockNestedBlocks(t)) deps.push(...blockDependencies(nested));
  return deps;
});
registerBlockSemanticRole('table', 'table');

registerBlockDependencies('sdt', (block) => {
  // A transparent SDT reads nothing itself; it composes its nested blocks' dependencies.
  const deps: DependencyKey[] = [];
  for (const nested of blockNestedBlocks(block)) deps.push(...blockDependencies(nested));
  return deps;
});
registerBlockSemanticRole('sdt', 'group');

interface TableCtx {
  readonly margin: number;
  readonly contentRight: number;
  readonly contentBottom: number;
  readonly metrics: MetricsPort;
  readonly builder: LayoutBuilder;
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
      if (!isHeader)
        for (const hr of headerRows) y = emitRow(hr, cols, margin, y, metrics, push, builder);
    }
    y = emitRow(row, cols, margin, y, metrics, push, builder);
  }
  return y;
}

/** Emit a table within [left,right] from `top` with NO pagination (used for nested
 *  tables inside a cell). Returns the y just below the table. */
function emitTable(
  table: TableRecord,
  left: number,
  right: number,
  top: number,
  metrics: MetricsPort,
  push: (it: DisplayItem) => void,
  builder: LayoutBuilder
): number {
  const cols = columnWidths(table, right - left);
  let y = top;
  for (const row of table.rows) y = emitRow(row, cols, left, y, metrics, push, builder);
  return y;
}

/** Emit one row: place each cell in its column box, flow its content (paragraphs and
 *  nested tables), size the row to its tallest cell, and push a border/shading rect
 *  per cell. Returns the row's bottom y. */
function emitRow(
  row: TableRowRecord,
  cols: readonly number[],
  left: number,
  rowTop: number,
  metrics: MetricsPort,
  push: (it: DisplayItem) => void,
  builder: LayoutBuilder
): number {
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
      const bottom = flowCell(
        cell,
        cellX + CELL_PAD,
        cellX + cellW - CELL_PAD,
        rowTop + CELL_PAD,
        metrics,
        builder,
        (it) => items.push(it)
      );
      if (bottom + CELL_PAD > rowBottom) rowBottom = bottom + CELL_PAD;
    }
    const fill = shadeFill(cell);
    cellData.push({
      rect: {
        type: 'rect',
        x: cellX,
        y: rowTop,
        width: cellW,
        height: 0,
        stroke: true,
        ...(fill ? { fill } : {}),
      },
      items,
    });
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
      return Number.isFinite(tw) && tw > 0
        ? Math.round(tw)
        : Math.round(contentWidth / table.grid!.length);
    });
  }
  // Two separate file-driven hazards live in this one line, both found by review.
  //
  // 1. `gridSpan` came straight from the file into `Array.from({ length })`, the
  //    pattern CLAUDE.md forbids outright ("never feed a file-supplied number into
  //    allocation"). `intAttr` has no upper bound, so a 965-BYTE .docx with one
  //    table, one row, one cell and `<w:gridSpan w:val="500000000"/>` allocated
  //    12.9 GB and spent 107 s in `layoutBody` — an immediate OOM kill in a tab,
  //    zero clicks, on open. `layoutBody` runs synchronously from `loadSource`
  //    inside no `try`, so there is no graceful path either.
  // 2. `Math.max(1, ...rows.map(...))` spreads one argument per ROW. V8 throws
  //    `RangeError: Maximum call stack size exceeded` above ~130,000 arguments, and
  //    review proved a 652 KB .docx (8.4 MB XML, zip ratio 13 — inside every limit)
  //    reaching exactly that. The editor would die on open in Chrome rather than be
  //    slow. JSC tolerates 200,000 arguments, which is why `bun test` can never
  //    catch it: the repo's runner is the one engine that does not throw.
  //
  // So: accumulate with a fold (no spread, no arity limit), clamp each cell's span
  // before it is summed, and clamp the total. `MAX_TABLE_COLUMNS` is far above
  // anything Word authors (its UI caps at 63) while keeping the allocation bounded.
  const MAX_TABLE_COLUMNS = 1024;
  let colCount = 1;
  for (const row of table.rows) {
    let rowCols = 0;
    for (const cell of row.cells) {
      const span = cell.props?.gridSpan;
      const safeSpan = Number.isInteger(span) && span! > 1 ? Math.min(span!, MAX_TABLE_COLUMNS) : 1;
      rowCols += safeSpan;
      if (rowCols >= MAX_TABLE_COLUMNS) break;
    }
    if (rowCols > colCount) colCount = rowCols;
    if (colCount >= MAX_TABLE_COLUMNS) {
      colCount = MAX_TABLE_COLUMNS;
      break;
    }
  }
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
function flowCell(
  cell: TableCellRecord,
  left: number,
  right: number,
  top: number,
  metrics: MetricsPort,
  builder: LayoutBuilder,
  push: (it: DisplayItem) => void
): number {
  const cursor = { x: left, y: top };
  let started = false;
  const sink: ParagraphLayoutSink = { push, currentPageIndex: () => builder.currentPageIndex() };
  for (const block of flattenSdt(cell.blocks)) {
    if (block.kind === 'table') {
      if (started) cursor.y += metrics.lineHeight;
      cursor.y = emitTable(block, left, right, cursor.y, metrics, push, builder);
      started = true;
      cursor.x = left;
      continue;
    }
    if (started) {
      cursor.y += metrics.lineHeight;
      cursor.x = left;
    }
    started = true;
    layoutParagraphInBox(
      block,
      cursor,
      left,
      right,
      metrics,
      sink,
      () => {
        cursor.y += metrics.lineHeight;
        cursor.x = left;
      },
      { trailingNewLine: false }
    );
  }
  return cursor.y + metrics.lineHeight;
}

/**
 * Hit-test a point against a page's display items (design D7). Returns the anchor
 * under the point, refined to a character offset within the item by advance. The
 * same inverse the DOM/PDF backends use — geometry is never re-derived.
 */
export function hitTest(
  result: LayoutResult,
  pageIndex: number,
  px: number,
  py: number,
  metrics: MetricsPort
): TextItem['anchor'] | undefined {
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
