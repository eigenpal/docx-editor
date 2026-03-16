/**
 * Table Renderer
 *
 * Renders table fragments to DOM. Handles:
 * - Multi-row tables split across pages
 * - Cell content (paragraphs within cells)
 * - Column widths and cell spans
 * - Basic cell styling (borders, backgrounds)
 */

import type {
  TableFragment,
  TableBlock,
  TableMeasure,
  TableCell,
  TableCellMeasure,
  ParagraphBlock,
  ParagraphMeasure,
  ParagraphFragment,
  ImageRun,
} from '../layout-engine/types';
import type { RenderContext } from './renderPage';
import { isFloatingImageRun, emuToPixels } from './renderPage';
import { renderParagraphFragment } from './renderParagraph';
import { measureParagraph, type FloatingImageZone } from '../layout-bridge/measuring';

/**
 * CSS class names for table elements
 */
export const TABLE_CLASS_NAMES = {
  table: 'layout-table',
  row: 'layout-table-row',
  cell: 'layout-table-cell',
  cellContent: 'layout-table-cell-content',
  resizeHandle: 'layout-table-resize-handle',
  rowResizeHandle: 'layout-table-row-resize-handle',
  tableEdgeHandleBottom: 'layout-table-edge-handle-bottom',
  tableEdgeHandleRight: 'layout-table-edge-handle-right',
};

/**
 * Options for rendering a table fragment
 */
export interface RenderTableFragmentOptions {
  document?: Document;
}

/** Info about a floating image extracted from a cell paragraph */
interface CellFloatingImage {
  src: string;
  width: number;
  height: number;
  alt?: string;
  transform?: string;
  x: number;
  y: number;
  side: 'left' | 'right';
  distTop: number;
  distBottom: number;
  distLeft: number;
  distRight: number;
  /** OOXML wrapText: which side(s) TEXT flows on */
  wrapText?: 'bothSides' | 'left' | 'right' | 'largest';
  pmStart?: number;
  pmEnd?: number;
}

/**
 * Extract floating images from cell paragraphs and compute their positions
 * relative to the cell content area.
 *
 * NOTE: The horizontal/vertical position logic here mirrors
 * extractFloatingImagesFromParagraph() in renderPage.ts. Kept separate
 * because the coordinate systems differ (cell-relative vs page-relative).
 */
function extractCellFloatingImages(
  cell: TableCell,
  cellMeasure: TableCellMeasure,
  contentWidth: number
): CellFloatingImage[] {
  const result: CellFloatingImage[] = [];
  let paragraphY = 0;

  for (let blockIndex = 0; blockIndex < cell.blocks.length; blockIndex++) {
    const block = cell.blocks[blockIndex];
    if (block?.kind !== 'paragraph') {
      // Use actual measured height for Y tracking
      const blockMeasure = cellMeasure.blocks[blockIndex];
      if (blockMeasure && blockMeasure.kind === 'table') {
        paragraphY += (blockMeasure as TableMeasure).totalHeight ?? 0;
      }
      continue;
    }
    const pBlock = block as ParagraphBlock;

    for (const run of pBlock.runs) {
      if (run.kind !== 'image') continue;
      const imgRun = run as ImageRun;
      if (!isFloatingImageRun(imgRun)) continue;

      const position = imgRun.position;
      const distTop = imgRun.distTop ?? 0;
      const distBottom = imgRun.distBottom ?? 0;
      const distLeft = imgRun.distLeft ?? 12;
      const distRight = imgRun.distRight ?? 12;

      // Horizontal position within cell
      let side: 'left' | 'right' = 'left';
      let x = 0;

      if (position?.horizontal) {
        const h = position.horizontal;
        if (h.align === 'right') {
          side = 'right';
          x = contentWidth - imgRun.width;
        } else if (h.align === 'left') {
          x = 0;
        } else if (h.align === 'center') {
          x = (contentWidth - imgRun.width) / 2;
        } else if (h.posOffset !== undefined) {
          x = emuToPixels(h.posOffset);
          side = x > contentWidth / 2 ? 'right' : 'left';
        }
      } else if (imgRun.cssFloat === 'right') {
        side = 'right';
        x = contentWidth - imgRun.width;
      }

      // Vertical position within cell
      let y = paragraphY;
      if (position?.vertical) {
        const v = position.vertical;
        if (v.posOffset !== undefined) {
          y = paragraphY + emuToPixels(v.posOffset);
        } else if (v.align === 'top') {
          y = 0;
        }
      }

      // Clamp within cell bounds
      x = Math.max(0, Math.min(x, contentWidth - imgRun.width));

      // Derive wrapText from cssFloat (same pattern as page-level):
      // cssFloat='left' → image floats left → text on right → wrapText='right'
      // cssFloat='right' → image floats right → text on left → wrapText='left'
      let wrapText: 'bothSides' | 'left' | 'right' | 'largest' = 'bothSides';
      if (imgRun.cssFloat === 'left') {
        wrapText = 'right';
      } else if (imgRun.cssFloat === 'right') {
        wrapText = 'left';
      }

      result.push({
        src: imgRun.src,
        width: imgRun.width,
        height: imgRun.height,
        alt: imgRun.alt,
        transform: imgRun.transform,
        x,
        y,
        side,
        distTop,
        distBottom,
        distLeft,
        distRight,
        wrapText,
        pmStart: imgRun.pmStart,
        pmEnd: imgRun.pmEnd,
      });
    }

    // Use actual measured height for Y tracking
    const blockMeasure = cellMeasure.blocks[blockIndex];
    if (blockMeasure && blockMeasure.kind === 'paragraph') {
      paragraphY += (blockMeasure as ParagraphMeasure).totalHeight;
    }
  }

  return result;
}

/**
 * Render cell content (paragraphs and nested tables)
 */
function renderCellContent(
  cell: TableCell,
  cellMeasure: TableCellMeasure,
  context: RenderContext,
  doc: Document
): HTMLElement {
  const contentEl = doc.createElement('div');
  contentEl.className = TABLE_CLASS_NAMES.cellContent;
  contentEl.style.position = 'relative';
  // Content width must account for cell padding since the cell uses border-box sizing.
  // Without this, content is wider than the available area, causing centering and
  // clipping issues (especially for nested tables).
  const padLeft = cell.padding?.left ?? 7;
  const padRight = cell.padding?.right ?? 7;
  const contentWidth = Math.max(0, cellMeasure.width - padLeft - padRight);
  contentEl.style.width = `${contentWidth}px`;

  // Extract floating images from cell paragraphs
  const cellFloatingImages = extractCellFloatingImages(cell, cellMeasure, contentWidth);

  // Build floating zones for measurement and render floating layer
  let floatingZones: FloatingImageZone[] | undefined;
  if (cellFloatingImages.length > 0) {
    floatingZones = cellFloatingImages.map((img) => {
      const rectRight = img.x + img.width + img.distRight;
      const rectTop = img.y - img.distTop;
      const rectBottom = img.y + img.height + img.distBottom;

      let leftMargin = 0;
      let rightMargin = 0;
      // Use wrapText to determine which side text flows on (same as rectsToFloatingZones in renderPage.ts)
      const wt = img.wrapText ?? 'bothSides';
      if (wt === 'right') {
        // Text flows on RIGHT only -> image blocks the left side
        leftMargin = rectRight;
      } else if (wt === 'left') {
        // Text flows on LEFT only -> image blocks the right side
        rightMargin = contentWidth - (img.x - img.distLeft);
      } else {
        // bothSides / largest: use image position to determine which side it blocks
        if (img.side === 'left') {
          leftMargin = rectRight;
        } else {
          rightMargin = contentWidth - (img.x - img.distLeft);
        }
      }
      return { leftMargin, rightMargin, topY: rectTop, bottomY: rectBottom };
    });

    // Render floating image layer within the cell
    const floatingLayer = doc.createElement('div');
    floatingLayer.className = 'layout-cell-floating-images-layer';
    floatingLayer.style.position = 'absolute';
    floatingLayer.style.top = '0';
    floatingLayer.style.left = '0';
    floatingLayer.style.width = '100%';
    floatingLayer.style.height = '100%';
    floatingLayer.style.pointerEvents = 'none';
    floatingLayer.style.zIndex = '10';
    floatingLayer.style.overflow = 'hidden';

    for (const img of cellFloatingImages) {
      const imgContainer = doc.createElement('div');
      imgContainer.className = 'layout-cell-floating-image';
      imgContainer.style.position = 'absolute';
      imgContainer.style.left = `${img.x}px`;
      imgContainer.style.top = `${img.y}px`;
      imgContainer.style.pointerEvents = 'auto';
      if (img.pmStart !== undefined) imgContainer.dataset.pmStart = String(img.pmStart);
      if (img.pmEnd !== undefined) imgContainer.dataset.pmEnd = String(img.pmEnd);

      const imgEl = doc.createElement('img');
      imgEl.src = img.src;
      imgEl.style.width = `${img.width}px`;
      imgEl.style.height = `${img.height}px`;
      imgEl.style.display = 'block';
      if (img.alt) imgEl.alt = img.alt;
      if (img.transform) imgEl.style.transform = img.transform;
      imgContainer.appendChild(imgEl);
      floatingLayer.appendChild(imgContainer);
    }

    contentEl.appendChild(floatingLayer);
  }

  let cumulativeY = 0;
  for (let i = 0; i < cell.blocks.length; i++) {
    const block = cell.blocks[i];
    const measure = cellMeasure.blocks[i];

    if (block?.kind === 'paragraph' && measure?.kind === 'paragraph') {
      const paragraphBlock = block as ParagraphBlock;
      let paragraphMeasure = measure as ParagraphMeasure;

      // Re-measure with floating zones if floating images exist in this cell
      if (floatingZones && floatingZones.length > 0) {
        paragraphMeasure = measureParagraph(paragraphBlock, contentWidth, {
          floatingZones,
          paragraphYOffset: cumulativeY,
        });
      }

      // Create synthetic fragment for the paragraph
      const syntheticFragment: ParagraphFragment = {
        kind: 'paragraph',
        blockId: paragraphBlock.id,
        x: 0,
        y: 0,
        width: contentWidth,
        height: paragraphMeasure.totalHeight,
        fromLine: 0,
        toLine: paragraphMeasure.lines.length,
        pmStart: paragraphBlock.pmStart,
        pmEnd: paragraphBlock.pmEnd,
      };

      const cellContext = { ...context, insideTableCell: true as const };
      const fragEl = renderParagraphFragment(
        syntheticFragment,
        paragraphBlock,
        paragraphMeasure,
        cellContext,
        { document: doc }
      );

      fragEl.style.position = 'relative';
      contentEl.appendChild(fragEl);
      cumulativeY += paragraphMeasure.totalHeight;
    } else if (block?.kind === 'table' && measure?.kind === 'table') {
      // Nested table - render in normal document flow.
      // Avoid cumulative marginTop offsets here: cell content already flows vertically,
      // and compounding offsets can produce enormous heights on deeply nested tables.
      const tableBlock = block as TableBlock;
      const tableMeasure = measure as TableMeasure;

      const nestedTableEl = renderNestedTable(tableBlock, tableMeasure, context, doc);
      nestedTableEl.style.position = 'relative';
      contentEl.appendChild(nestedTableEl);
      cumulativeY += (measure as TableMeasure).totalHeight ?? 0;
    }
  }

  return contentEl;
}

/**
 * Render a nested table (within a cell)
 */
function renderNestedTable(
  block: TableBlock,
  measure: TableMeasure,
  context: RenderContext,
  doc: Document
): HTMLElement {
  const tableEl = doc.createElement('div');
  tableEl.className = `${TABLE_CLASS_NAMES.table} layout-nested-table`;

  // Positioning (relative, not absolute)
  tableEl.style.position = 'relative';
  tableEl.style.width = `${measure.totalWidth}px`;
  tableEl.style.display = 'block';

  if (block.justification === 'center') {
    tableEl.style.marginLeft = 'auto';
    tableEl.style.marginRight = 'auto';
  } else if (block.justification === 'right') {
    tableEl.style.marginLeft = 'auto';
  } else if (block.indent) {
    tableEl.style.marginLeft = `${block.indent}px`;
  }

  // Store metadata
  tableEl.dataset.blockId = String(block.id);

  if (block.pmStart !== undefined) {
    tableEl.dataset.pmStart = String(block.pmStart);
  }
  if (block.pmEnd !== undefined) {
    tableEl.dataset.pmEnd = String(block.pmEnd);
  }

  // Build row Y positions for rowSpan height calculation
  const rowYPositions: number[] = [];
  let yPos = 0;
  for (let i = 0; i < measure.rows.length; i++) {
    rowYPositions.push(yPos);
    yPos += measure.rows[i]?.height ?? 0;
  }
  rowYPositions.push(yPos);

  // Track spanning cells across rows
  const spanningCells = new Map<string, SpanningCell>();

  // Render all rows
  let y = 0;
  for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex++) {
    const row = block.rows[rowIndex];
    const rowMeasure = measure.rows[rowIndex];

    if (!row || !rowMeasure) continue;

    const rowEl = renderTableRow(
      row,
      rowMeasure,
      rowIndex,
      y,
      measure.columnWidths,
      block.rows.length,
      context,
      doc,
      spanningCells,
      rowYPositions
    );
    tableEl.appendChild(rowEl);
    y += rowMeasure.height;
  }

  tableEl.style.height = `${y}px`;

  return tableEl;
}

/**
 * Apply a single border to an element.
 */
function applyBorder(
  el: HTMLElement,
  side: 'top' | 'right' | 'bottom' | 'left',
  border: { width?: number; color?: string; style?: string } | undefined
): void {
  const styleProp = `border${side.charAt(0).toUpperCase() + side.slice(1)}` as
    | 'borderTop'
    | 'borderRight'
    | 'borderBottom'
    | 'borderLeft';

  if (!border || border.style === 'none' || border.style === 'nil' || border.width === 0) {
    el.style[styleProp] = 'none';
  } else {
    const width = border.width ?? 1;
    const color = border.color ?? '#000000';
    const style = border.style ?? 'solid';
    el.style[styleProp] = `${width}px ${style} ${color}`;
  }
}

/**
 * Render a single table cell
 */
function renderTableCell(
  cell: TableCell,
  cellMeasure: TableCellMeasure,
  x: number,
  rowHeight: number,
  borderFlags: {
    isFirstRow: boolean;
    isLastRow: boolean;
    isFirstCol: boolean;
    isLastCol: boolean;
  },
  context: RenderContext,
  doc: Document
): HTMLElement {
  const cellEl = doc.createElement('div');
  cellEl.className = TABLE_CLASS_NAMES.cell;

  // Positioning
  cellEl.style.position = 'absolute';
  cellEl.style.left = `${x}px`;
  cellEl.style.top = '0';
  cellEl.style.width = `${cellMeasure.width}px`;
  cellEl.style.height = `${rowHeight}px`;
  cellEl.style.overflow = 'hidden';
  cellEl.style.boxSizing = 'border-box';
  // Use per-cell padding from DOCX margins, default to Word's visual rendering
  const padTop = cell.padding?.top ?? 1;
  const padRight = cell.padding?.right ?? 7;
  const padBottom = cell.padding?.bottom ?? 1;
  const padLeft = cell.padding?.left ?? 7;
  cellEl.style.padding = `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`;

  // Apply borders - use cell borders if available, otherwise no border
  if (cell.borders) {
    // Collapse shared borders to avoid double-thick lines.
    // Strategy: "bottom wins" for rows, "right wins" for columns.
    // Each cell's bottom border represents the shared edge with the row below.
    // Each cell's right border represents the shared edge with the column to its right.
    // Only the first row draws its top border (table's top edge).
    // Only the first column draws its left border (table's left edge).
    if (borderFlags.isFirstRow) {
      applyBorder(cellEl, 'top', cell.borders.top);
    }
    applyBorder(cellEl, 'right', cell.borders.right);
    applyBorder(cellEl, 'bottom', cell.borders.bottom);
    if (borderFlags.isFirstCol) applyBorder(cellEl, 'left', cell.borders.left);
  }
  // No default border - cells without explicit borders should be borderless

  // Background color
  if (cell.background) {
    cellEl.style.backgroundColor = cell.background;
  }

  // Vertical alignment
  if (cell.verticalAlign) {
    cellEl.style.display = 'flex';
    cellEl.style.flexDirection = 'column';
    switch (cell.verticalAlign) {
      case 'top':
        cellEl.style.justifyContent = 'flex-start';
        break;
      case 'center':
        cellEl.style.justifyContent = 'center';
        break;
      case 'bottom':
        cellEl.style.justifyContent = 'flex-end';
        break;
    }
  }

  // Render cell content
  const contentEl = renderCellContent(cell, cellMeasure, context, doc);
  cellEl.appendChild(contentEl);

  // Store PM positions for selection
  if (cell.blocks.length > 0) {
    const firstBlock = cell.blocks[0];
    const lastBlock = cell.blocks[cell.blocks.length - 1];
    if (firstBlock && 'pmStart' in firstBlock && firstBlock.pmStart !== undefined) {
      cellEl.dataset.pmStart = String(firstBlock.pmStart);
    }
    if (lastBlock && 'pmEnd' in lastBlock && lastBlock.pmEnd !== undefined) {
      cellEl.dataset.pmEnd = String(lastBlock.pmEnd);
    }
  }

  return cellEl;
}

/**
 * Track cells that span multiple rows
 */
type SpanningCell = {
  cell: TableCell;
  cellMeasure: TableCellMeasure;
  columnIndex: number;
  startRow: number;
  rowSpan: number;
  colSpan: number;
  x: number;
  totalHeight: number;
};

/**
 * Render a table row with rowSpan support
 */
function renderTableRow(
  row: TableBlock['rows'][number],
  rowMeasure: TableMeasure['rows'][number],
  rowIndex: number,
  y: number,
  columnWidths: number[],
  totalRows: number,
  context: RenderContext,
  doc: Document,
  spanningCells?: Map<string, SpanningCell>,
  rowYPositions?: number[],
  isFirstRowInFragment?: boolean
): HTMLElement {
  const rowEl = doc.createElement('div');
  rowEl.className = TABLE_CLASS_NAMES.row;

  // Positioning
  rowEl.style.position = 'absolute';
  rowEl.style.left = '0';
  rowEl.style.top = `${y}px`;
  rowEl.style.width = '100%';
  rowEl.style.height = `${rowMeasure.height}px`;

  // Data attributes
  rowEl.dataset.rowIndex = String(rowIndex);

  // Build set of columns occupied by spanning cells from previous rows
  const occupiedColumns = new Set<number>();
  if (spanningCells) {
    for (const [, spanCell] of spanningCells) {
      // Check if this spanning cell covers the current row
      if (spanCell.startRow < rowIndex && spanCell.startRow + spanCell.rowSpan > rowIndex) {
        for (let c = 0; c < spanCell.colSpan; c++) {
          occupiedColumns.add(spanCell.columnIndex + c);
        }
      }
    }
  }

  // Render cells
  // Track actual column index separately from cell index
  // because cells with colSpan > 1 span multiple columns
  let x = 0;
  let columnIndex = 0;

  // Skip columns occupied by spanning cells
  while (occupiedColumns.has(columnIndex)) {
    x += columnWidths[columnIndex] ?? 0;
    columnIndex++;
  }

  for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex++) {
    const cell = row.cells[cellIndex];
    const cellMeasure = rowMeasure.cells[cellIndex];

    if (!cell || !cellMeasure) continue;

    const colSpan = cell.colSpan ?? 1;
    const rowSpan = cell.rowSpan ?? 1;

    // Calculate cell height - for spanning cells, use total height of spanned rows
    let cellHeight = rowMeasure.height;
    if (rowSpan > 1 && rowYPositions) {
      cellHeight = 0;
      for (let r = rowIndex; r < rowIndex + rowSpan && r < rowYPositions.length - 1; r++) {
        cellHeight += (rowYPositions[r + 1] ?? 0) - (rowYPositions[r] ?? 0);
      }
      // Fallback if rowYPositions doesn't have enough entries
      if (cellHeight === 0) {
        cellHeight = rowMeasure.height * rowSpan;
      }
    }

    const isFirstRow = rowIndex === 0 || isFirstRowInFragment === true;
    const isLastRow = rowIndex + rowSpan >= totalRows;
    const isFirstCol = columnIndex === 0;
    const isLastCol = columnIndex + colSpan >= columnWidths.length;

    const cellEl = renderTableCell(
      cell,
      cellMeasure,
      x,
      cellHeight,
      { isFirstRow, isLastRow, isFirstCol, isLastCol },
      context,
      doc
    );
    cellEl.dataset.cellIndex = String(cellIndex);
    cellEl.dataset.columnIndex = String(columnIndex);

    // Store rowSpan info for styling
    if (rowSpan > 1) {
      cellEl.dataset.rowSpan = String(rowSpan);
    }

    rowEl.appendChild(cellEl);

    // Track this cell as spanning if it spans multiple rows
    if (rowSpan > 1 && spanningCells) {
      const key = `${rowIndex}-${columnIndex}`;
      spanningCells.set(key, {
        cell,
        cellMeasure,
        columnIndex,
        startRow: rowIndex,
        rowSpan,
        colSpan,
        x,
        totalHeight: cellHeight,
      });
    }

    // Move x by the width of columns this cell spans
    for (let c = 0; c < colSpan && columnIndex + c < columnWidths.length; c++) {
      x += columnWidths[columnIndex + c] ?? 0;
    }

    // Advance column index by colSpan
    columnIndex += colSpan;

    // Skip columns occupied by spanning cells
    while (occupiedColumns.has(columnIndex)) {
      x += columnWidths[columnIndex] ?? 0;
      columnIndex++;
    }
  }

  return rowEl;
}

/**
 * Render a table fragment to DOM
 *
 * @param fragment - The table fragment to render
 * @param block - The full table block
 * @param measure - The full table measure
 * @param context - Rendering context
 * @param options - Rendering options
 * @returns The table DOM element
 */
export function renderTableFragment(
  fragment: TableFragment,
  block: TableBlock,
  measure: TableMeasure,
  context: RenderContext,
  options: RenderTableFragmentOptions = {}
): HTMLElement {
  const doc = options.document ?? document;

  const tableEl = doc.createElement('div');
  tableEl.className = TABLE_CLASS_NAMES.table;

  // Basic table styling
  tableEl.style.position = 'absolute';
  tableEl.style.width = `${fragment.width}px`;
  tableEl.style.height = `${fragment.height}px`;
  tableEl.style.overflow = 'hidden';

  // Store metadata
  tableEl.dataset.blockId = String(fragment.blockId);
  tableEl.dataset.fromRow = String(fragment.fromRow);
  tableEl.dataset.toRow = String(fragment.toRow);

  if (fragment.pmStart !== undefined) {
    tableEl.dataset.pmStart = String(fragment.pmStart);
  }
  if (fragment.pmEnd !== undefined) {
    tableEl.dataset.pmEnd = String(fragment.pmEnd);
  }

  // Add column resize handles at each column boundary
  let handleX = 0;
  for (let col = 0; col < measure.columnWidths.length - 1; col++) {
    handleX += measure.columnWidths[col] ?? 0;
    const handle = doc.createElement('div');
    handle.className = TABLE_CLASS_NAMES.resizeHandle;
    handle.style.position = 'absolute';
    handle.style.left = `${handleX - 3}px`;
    handle.style.top = '0';
    handle.style.width = '6px';
    handle.style.height = '100%';
    handle.style.cursor = 'col-resize';
    handle.style.zIndex = '10';
    handle.dataset.columnIndex = String(col);
    handle.dataset.tableBlockId = String(fragment.blockId);
    if (fragment.pmStart !== undefined) {
      handle.dataset.tablePmStart = String(fragment.pmStart);
    }
    tableEl.appendChild(handle);
  }

  // Build row Y positions for rowSpan height calculation
  const rowYPositions: number[] = [];
  let yPos = 0;
  for (let i = 0; i < measure.rows.length; i++) {
    rowYPositions.push(yPos);
    yPos += measure.rows[i]?.height ?? 0;
  }
  rowYPositions.push(yPos); // Add final position for height calculation

  // Track spanning cells across rows
  const spanningCells = new Map<string, SpanningCell>();

  // Render repeated header rows for continuation fragments
  const headerRowCount = fragment.headerRowCount ?? 0;
  let y = 0;
  if (headerRowCount > 0 && fragment.continuesFromPrev) {
    for (let hdrIdx = 0; hdrIdx < headerRowCount; hdrIdx++) {
      const hdrRow = block.rows[hdrIdx];
      const hdrRowMeasure = measure.rows[hdrIdx];
      if (!hdrRow || !hdrRowMeasure) continue;

      const rowEl = renderTableRow(
        hdrRow,
        hdrRowMeasure,
        hdrIdx,
        y,
        measure.columnWidths,
        block.rows.length,
        context,
        doc,
        spanningCells,
        rowYPositions,
        hdrIdx === 0 // first header row draws top border
      );
      rowEl.dataset.repeatedHeader = 'true';
      tableEl.appendChild(rowEl);
      y += hdrRowMeasure.height;
    }
  }

  // Render content rows from fragment.fromRow to fragment.toRow
  for (let rowIndex = fragment.fromRow; rowIndex < fragment.toRow; rowIndex++) {
    const row = block.rows[rowIndex];
    const rowMeasure = measure.rows[rowIndex];

    if (!row || !rowMeasure) continue;

    // First content row in a continuation fragment with headers should draw top border
    const isFirstRowInFragment =
      headerRowCount > 0 && fragment.continuesFromPrev
        ? false // header rows already drawn, content rows are not "first"
        : fragment.continuesFromPrev && rowIndex === fragment.fromRow;

    const rowEl = renderTableRow(
      row,
      rowMeasure,
      rowIndex,
      y,
      measure.columnWidths,
      block.rows.length,
      context,
      doc,
      spanningCells,
      rowYPositions,
      isFirstRowInFragment
    );

    tableEl.appendChild(rowEl);
    y += rowMeasure.height;
  }

  // Add row resize handles at each row boundary (between consecutive rows)
  let handleY = 0;
  for (let rowIdx = fragment.fromRow; rowIdx < fragment.toRow; rowIdx++) {
    handleY += measure.rows[rowIdx]?.height ?? 0;

    // Don't add a handle after the last row in this fragment (unless it's the table's last row — that's the bottom edge)
    if (rowIdx < fragment.toRow - 1) {
      const rowHandle = doc.createElement('div');
      rowHandle.className = TABLE_CLASS_NAMES.rowResizeHandle;
      rowHandle.style.position = 'absolute';
      rowHandle.style.left = '0';
      rowHandle.style.top = `${handleY - 3}px`;
      rowHandle.style.width = '100%';
      rowHandle.style.height = '6px';
      rowHandle.style.cursor = 'row-resize';
      rowHandle.style.zIndex = '10';
      rowHandle.dataset.rowIndex = String(rowIdx);
      rowHandle.dataset.tableBlockId = String(fragment.blockId);
      if (fragment.pmStart !== undefined) {
        rowHandle.dataset.tablePmStart = String(fragment.pmStart);
      }
      tableEl.appendChild(rowHandle);
    }
  }

  // Bottom edge handle (only on fragments containing the last row)
  if (fragment.toRow === block.rows.length) {
    const bottomHandle = doc.createElement('div');
    bottomHandle.className = TABLE_CLASS_NAMES.tableEdgeHandleBottom;
    bottomHandle.style.position = 'absolute';
    bottomHandle.style.left = '0';
    bottomHandle.style.top = `${handleY - 3}px`;
    bottomHandle.style.width = '100%';
    bottomHandle.style.height = '6px';
    bottomHandle.style.cursor = 'row-resize';
    bottomHandle.style.zIndex = '10';
    bottomHandle.dataset.rowIndex = String(block.rows.length - 1);
    bottomHandle.dataset.tableBlockId = String(fragment.blockId);
    bottomHandle.dataset.isEdge = 'bottom';
    if (fragment.pmStart !== undefined) {
      bottomHandle.dataset.tablePmStart = String(fragment.pmStart);
    }
    tableEl.appendChild(bottomHandle);
  }

  // Right edge handle (only on fragments containing the last row)
  if (fragment.toRow === block.rows.length) {
    const totalWidth = measure.columnWidths.reduce((w, cw) => w + cw, 0);
    const rightHandle = doc.createElement('div');
    rightHandle.className = TABLE_CLASS_NAMES.tableEdgeHandleRight;
    rightHandle.style.position = 'absolute';
    rightHandle.style.left = `${totalWidth - 3}px`;
    rightHandle.style.top = '0';
    rightHandle.style.width = '6px';
    rightHandle.style.height = '100%';
    rightHandle.style.cursor = 'col-resize';
    rightHandle.style.zIndex = '10';
    rightHandle.dataset.columnIndex = String(measure.columnWidths.length - 1);
    rightHandle.dataset.tableBlockId = String(fragment.blockId);
    rightHandle.dataset.isEdge = 'right';
    if (fragment.pmStart !== undefined) {
      rightHandle.dataset.tablePmStart = String(fragment.pmStart);
    }
    tableEl.appendChild(rightHandle);
  }

  return tableEl;
}
