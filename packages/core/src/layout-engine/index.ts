/**
 * Layout Engine - Main Entry Point
 *
 * Converts blocks + measures into positioned fragments on pages.
 */

import {
  calculateChainHeight,
  computeKeepNextChains,
  getMidChainIndices,
  hasPageBreakBefore,
} from './keep-together';
import type { Paginator } from './paginator';
import { createPaginator, createPaginatorFromSnapshot } from './paginator';
import type {
  ColumnLayout,
  FlowBlock,
  ImageBlock,
  ImageFragment,
  ImageMeasure,
  Layout,
  LayoutOptions,
  Measure,
  PageMargins,
  PaginatorSnapshot,
  PaginatorStateAtBlock,
  ParagraphBlock,
  ParagraphFragment,
  ParagraphMeasure,
  SectionBreakBlock,
  TableBlock,
  TableFragment,
  TableMeasure,
  TextBoxBlock,
  TextBoxFragment,
  TextBoxMeasure,
} from './types';

// Default page size (US Letter in pixels at 96 DPI)
const DEFAULT_PAGE_SIZE = { w: 816, h: 1056 };

// Default margins (1 inch = 96 pixels)
const DEFAULT_MARGINS: PageMargins = {
  top: 96,
  right: 96,
  bottom: 96,
  left: 96,
};

/**
 * Get spacing before a paragraph block.
 */
function getSpacingBefore(block: ParagraphBlock): number {
  return block.attrs?.spacing?.before ?? 0;
}

/**
 * Get spacing after a paragraph block.
 */
function getSpacingAfter(block: ParagraphBlock): number {
  return block.attrs?.spacing?.after ?? 0;
}

/**
 * Apply contextual spacing suppression (OOXML §17.3.1.9).
 *
 * When two consecutive paragraph blocks both have `contextualSpacing: true`
 * and share the same `styleId`, the spaceAfter of the first paragraph and
 * the spaceBefore of the second paragraph are suppressed (set to 0).
 *
 * This mutates the block attrs in-place before layout runs.
 */
function applyContextualSpacing(blocks: FlowBlock[]): void {
  for (let i = 0; i < blocks.length - 1; i++) {
    const curr = blocks[i];
    const next = blocks[i + 1];

    if (curr.kind !== 'paragraph' || next.kind !== 'paragraph') continue;

    const currAttrs = curr.attrs;
    const nextAttrs = next.attrs;

    if (
      currAttrs?.contextualSpacing &&
      nextAttrs?.contextualSpacing &&
      currAttrs.styleId &&
      currAttrs.styleId === nextAttrs.styleId
    ) {
      // Suppress spaceAfter on current paragraph
      if (currAttrs.spacing) {
        currAttrs.spacing = { ...currAttrs.spacing, after: 0 };
      }
      // Suppress spaceBefore on next paragraph
      if (nextAttrs.spacing) {
        nextAttrs.spacing = { ...nextAttrs.spacing, before: 0 };
      }
    }
  }
}

/**
 * Apply contextual spacing for a partial range of blocks.
 * Only processes pairs where at least one block falls within [from, to).
 */
function applyContextualSpacingRange(blocks: FlowBlock[], from: number, to: number): void {
  // Check pair before range start (previous block interacts with first dirty block)
  const start = Math.max(0, from - 1);
  const end = Math.min(blocks.length - 1, to);
  for (let i = start; i < end; i++) {
    const curr = blocks[i];
    const next = blocks[i + 1];

    if (curr.kind !== 'paragraph' || next.kind !== 'paragraph') continue;

    const currAttrs = curr.attrs;
    const nextAttrs = next.attrs;

    if (
      currAttrs?.contextualSpacing &&
      nextAttrs?.contextualSpacing &&
      currAttrs.styleId &&
      currAttrs.styleId === nextAttrs.styleId
    ) {
      if (currAttrs.spacing) {
        currAttrs.spacing = { ...currAttrs.spacing, after: 0 };
      }
      if (nextAttrs.spacing) {
        nextAttrs.spacing = { ...nextAttrs.spacing, before: 0 };
      }
    }
  }
}

/**
 * Capture compact paginator state at current block boundary.
 */
function capturePaginatorState(paginator: Paginator): PaginatorStateAtBlock {
  const state = paginator.getCurrentState();
  return {
    pageCount: paginator.pages.length,
    cursorY: state.cursorY,
    columnIndex: state.columnIndex,
    trailingSpacing: state.trailingSpacing,
  };
}

/**
 * Check if two paginator states are identical (converged).
 */
function statesConverged(a: PaginatorStateAtBlock, b: PaginatorStateAtBlock): boolean {
  return (
    a.pageCount === b.pageCount &&
    Math.abs(a.cursorY - b.cursorY) < 0.01 &&
    a.columnIndex === b.columnIndex &&
    Math.abs(a.trailingSpacing - b.trailingSpacing) < 0.01
  );
}

/** Number of consecutive converged blocks required before early exit. */
const CONVERGENCE_THRESHOLD = 2;

/**
 * Layout a document: convert blocks + measures into pages with positioned fragments.
 *
 * Algorithm:
 * 1. Walk blocks in order with their corresponding measures
 * 2. For each block, create appropriate fragment(s)
 * 3. Use paginator to manage page/column state
 * 4. Handle page breaks, section breaks, and keepNext chains
 */
export function layoutDocument(
  blocks: FlowBlock[],
  measures: Measure[],
  options: LayoutOptions = {} as LayoutOptions
): Layout {
  // Validate input
  if (blocks.length !== measures.length) {
    throw new Error(
      `layoutDocument: expected one measure per block (blocks=${blocks.length}, measures=${measures.length})`
    );
  }

  // Set up options with defaults
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const baseMargins = {
    top: options.margins?.top ?? DEFAULT_MARGINS.top,
    right: options.margins?.right ?? DEFAULT_MARGINS.right,
    bottom: options.margins?.bottom ?? DEFAULT_MARGINS.bottom,
    left: options.margins?.left ?? DEFAULT_MARGINS.left,
    header: options.margins?.header ?? options.margins?.top ?? DEFAULT_MARGINS.top,
    footer: options.margins?.footer ?? options.margins?.bottom ?? DEFAULT_MARGINS.bottom,
  };

  // Use document margins directly for WYSIWYG fidelity
  // Word uses fixed margins from the document - body content always starts at marginTop
  // If header content extends below marginTop, it overlaps (this matches Word behavior)
  // Note: headerContentHeights are still available for future use (e.g., warnings)
  void options.headerContentHeights;
  void options.footerContentHeights;
  void options.titlePage;
  void options.evenAndOddHeaders;

  const margins = { ...baseMargins };

  // Calculate content width
  const contentWidth = pageSize.w - margins.left - margins.right;
  if (contentWidth <= 0) {
    throw new Error('layoutDocument: page size and margins yield no content area');
  }

  // Pre-scan blocks to build per-section configs.
  // Each section break carries the CURRENT section's properties (columns, type).
  // ECMA-376 §17.6.22: w:type specifies how the CURRENT section starts relative
  // to the previous one. So for the transition at break[N], we need:
  //   - columns: from break[N+1] (what the next section uses)
  //   - type: from break[N+1] (how the next section starts)
  const defaultColumns: ColumnLayout = { count: 1, gap: 0 };
  const sectionColumnConfigs: ColumnLayout[] = [];
  const sectionBreakTypes: (SectionBreakBlock['type'] | undefined)[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind === 'sectionBreak') {
      const sb = blocks[i] as SectionBreakBlock;
      sectionColumnConfigs.push(sb.columns ?? defaultColumns);
      sectionBreakTypes.push(sb.type);
    }
  }
  // Final section uses body-level columns; its type comes from options
  sectionColumnConfigs.push(options.columns ?? defaultColumns);
  sectionBreakTypes.push(options.bodyBreakType);

  // First section's columns
  const initialColumns =
    sectionColumnConfigs.length > 0 ? sectionColumnConfigs[0] : options.columns;

  // Determine starting block and paginator based on resume options
  const resume = options.resumeFrom;
  let startBlock = 0;
  let sectionIdx = 0;
  let paginator: Paginator;

  if (resume && resume.resumeFromBlock > 0 && resume.resumeFromBlock < blocks.length) {
    // Resume from snapshot — create paginator pre-loaded with previous state
    paginator = createPaginatorFromSnapshot(resume.paginatorSnapshot, {
      pageSize,
      margins,
      columns: initialColumns,
      footnoteReservedHeights: options.footnoteReservedHeights,
    });
    startBlock = resume.resumeFromBlock;

    // Only apply contextual spacing around the dirty range
    applyContextualSpacingRange(blocks, startBlock, resume.dirtyTo);

    // Count section breaks before startBlock to initialize sectionIdx
    for (let i = 0; i < startBlock; i++) {
      if (blocks[i].kind === 'sectionBreak') sectionIdx++;
    }
  } else {
    // Full layout from scratch
    paginator = createPaginator({
      pageSize,
      margins,
      columns: initialColumns,
      footnoteReservedHeights: options.footnoteReservedHeights,
    });

    // Apply contextual spacing for all blocks
    applyContextualSpacing(blocks);
  }

  // Pre-compute keepNext chains for pagination decisions
  const keepNextChains = computeKeepNextChains(blocks);
  const midChainIndices = getMidChainIndices(keepNextChains);

  // Per-block paginator state tracking for convergence detection.
  // Pre-fill with previous states up to startBlock so the array is dense (no undefined holes).
  const statesAtBlock: PaginatorStateAtBlock[] = [];
  if (resume?.prevStatesAtBlock) {
    for (let i = 0; i < startBlock && i < resume.prevStatesAtBlock.length; i++) {
      statesAtBlock[i] = resume.prevStatesAtBlock[i];
    }
  }

  // Early exit tracking
  const dirtyTo = resume?.dirtyTo ?? blocks.length;
  const prevStates = resume?.prevStatesAtBlock;
  let convergentCount = 0;

  // Snapshot capture: take a paginator snapshot at the first block of each new page.
  // These snapshots enable future incremental layout runs to resume from a page boundary.
  const paginatorSnapshots = new Map<number, PaginatorSnapshot>();
  let lastSnapshotPageCount = paginator.pages.length;

  // Process each block, tracking section break index with a counter (O(1) per break)
  for (let i = startBlock; i < blocks.length; i++) {
    // Capture snapshot when a new page was created since last check
    if (paginator.pages.length > lastSnapshotPageCount) {
      paginatorSnapshots.set(i, paginator.snapshot());
      lastSnapshotPageCount = paginator.pages.length;
    }
    const block = blocks[i];
    const measure = measures[i];

    // Handle pageBreakBefore on paragraphs
    if (hasPageBreakBefore(block)) {
      paginator.forcePageBreak();
    }

    // Handle keepNext chains - if this is a chain start, check if chain fits
    const chain = keepNextChains.get(i);
    if (chain && !midChainIndices.has(i)) {
      const chainHeight = calculateChainHeight(chain, blocks, measures);
      const state = paginator.getCurrentState();
      const availableHeight = paginator.getAvailableHeight();
      const pageContentHeight = state.contentBottom - state.topMargin;

      // Only move to new page if:
      // 1. Chain fits on a blank page (avoid infinite loop for oversized chains)
      // 2. Chain doesn't fit in current available space
      // 3. Current page already has content
      if (
        chainHeight <= pageContentHeight &&
        chainHeight > availableHeight &&
        state.page.fragments.length > 0
      ) {
        paginator.forcePageBreak();
      }
    }

    switch (block.kind) {
      case 'paragraph':
        layoutParagraph(block, measure as ParagraphMeasure, paginator, contentWidth);
        break;

      case 'table':
        if (block.floating) {
          layoutFloatingTable(block, measure as TableMeasure, paginator, contentWidth);
        } else {
          layoutTable(block, measure as TableMeasure, paginator);
        }
        break;

      case 'image':
        layoutImage(block, measure as ImageMeasure, paginator);
        break;

      case 'textBox':
        layoutTextBox(block as TextBoxBlock, measure as TextBoxMeasure, paginator);
        break;

      case 'pageBreak':
        paginator.forcePageBreak();
        break;

      case 'columnBreak':
        paginator.forceColumnBreak();
        break;

      case 'sectionBreak': {
        // Use the NEXT section's columns; for break type, prefer next section's
        // type but fall back to current break's type (preserves explicit 'continuous')
        const nextType = sectionBreakTypes[sectionIdx + 1] ?? sectionBreakTypes[sectionIdx];
        handleSectionBreak(
          block as SectionBreakBlock,
          paginator,
          sectionColumnConfigs[sectionIdx + 1] ?? defaultColumns,
          nextType
        );
        sectionIdx++;
        break;
      }
    }

    // Capture paginator state after this block
    const stateAfter = capturePaginatorState(paginator);
    statesAtBlock[i] = stateAfter;

    // Early exit: once past the dirty range, check for convergence with previous run
    if (resume && i >= dirtyTo && prevStates && i < prevStates.length) {
      if (statesConverged(stateAfter, prevStates[i])) {
        convergentCount++;
        if (convergentCount >= CONVERGENCE_THRESHOLD) {
          // Layout has converged — splice remaining pages from previous run.
          // The current paginator has pages up to the convergence point.
          // Remaining pages (and their statesAtBlock) come from the previous run.
          const earlyExitAt = i;

          // Copy remaining statesAtBlock from previous run
          if (prevStates) {
            for (let j = earlyExitAt + 1; j < prevStates.length; j++) {
              statesAtBlock[j] = prevStates[j];
            }
          }

          // Splice remaining pages from previous layout.
          // Find which page the convergence block landed on, then append
          // all subsequent pages from prevPages.
          if (resume.prevPages && resume.prevPages.length > 0) {
            const currentPageCount = paginator.pages.length;
            for (let p = currentPageCount; p < resume.prevPages.length; p++) {
              paginator.pages.push(resume.prevPages[p]);
            }
          }

          break;
        }
      } else {
        convergentCount = 0;
      }
    }
  }

  // Ensure at least one page exists
  if (paginator.pages.length === 0) {
    paginator.getCurrentState();
  }

  const earlyExitBlock =
    convergentCount >= CONVERGENCE_THRESHOLD ? statesAtBlock.length - 1 : undefined;

  return {
    pageSize,
    pages: paginator.pages,
    columns: options.columns,
    pageGap: options.pageGap,
    statesAtBlock,
    earlyExitBlock,
    paginatorSnapshots,
  };
}

/**
 * Layout a paragraph block onto pages.
 */
function layoutParagraph(
  block: ParagraphBlock,
  measure: ParagraphMeasure,
  paginator: ReturnType<typeof createPaginator>,
  contentWidth: number
): void {
  if (measure.kind !== 'paragraph') {
    throw new Error(`layoutParagraph: expected paragraph measure`);
  }

  const lines = measure.lines;
  if (lines.length === 0) {
    // Empty paragraph - still takes up space based on spacing
    const spaceBefore = getSpacingBefore(block);
    const spaceAfter = getSpacingAfter(block);
    const state = paginator.getCurrentState();

    // Create minimal fragment
    const fragment: ParagraphFragment = {
      kind: 'paragraph',
      blockId: block.id,
      x: paginator.getColumnX(state.columnIndex),
      y: state.cursorY + spaceBefore,
      width: contentWidth,
      height: 0,
      fromLine: 0,
      toLine: 0,
      pmStart: block.pmStart,
      pmEnd: block.pmEnd,
    };

    paginator.addFragment(fragment, 0, spaceBefore, spaceAfter);
    return;
  }

  const spaceBefore = getSpacingBefore(block);
  const spaceAfter = getSpacingAfter(block);

  // Try to fit all lines on current page/column
  let currentLineIndex = 0;

  while (currentLineIndex < lines.length) {
    const state = paginator.getCurrentState();
    const availableHeight = paginator.getAvailableHeight();

    // Calculate how many lines fit
    let linesHeight = 0;
    let fittingLines = 0;

    for (let j = currentLineIndex; j < lines.length; j++) {
      const lineHeight = lines[j].lineHeight;
      const totalWithLine = linesHeight + lineHeight;

      // Add space before only for first fragment
      const withSpacing =
        currentLineIndex === 0 && j === currentLineIndex
          ? totalWithLine + spaceBefore
          : totalWithLine;

      if (withSpacing <= availableHeight || fittingLines === 0) {
        linesHeight = totalWithLine;
        fittingLines++;
      } else {
        break;
      }
    }

    // Create fragment for these lines
    const isFirstFragment = currentLineIndex === 0;
    const isLastFragment = currentLineIndex + fittingLines >= lines.length;
    const effectiveSpaceBefore = isFirstFragment ? spaceBefore : 0;
    const effectiveSpaceAfter = isLastFragment ? spaceAfter : 0;

    const fragment: ParagraphFragment = {
      kind: 'paragraph',
      blockId: block.id,
      x: paginator.getColumnX(state.columnIndex),
      y: 0, // Will be set by addFragment
      width: contentWidth,
      height: linesHeight,
      fromLine: currentLineIndex,
      toLine: currentLineIndex + fittingLines,
      pmStart: block.pmStart,
      pmEnd: block.pmEnd,
      continuesFromPrev: !isFirstFragment,
      continuesOnNext: !isLastFragment,
    };

    const result = paginator.addFragment(
      fragment,
      linesHeight,
      effectiveSpaceBefore,
      effectiveSpaceAfter
    );
    fragment.y = result.y;

    currentLineIndex += fittingLines;

    // If more lines remain, advance to next column/page
    if (currentLineIndex < lines.length) {
      paginator.ensureFits(lines[currentLineIndex].lineHeight);
    }
  }
}

/**
 * Count consecutive header rows at the start of a table.
 * Header rows are marked with isHeader: true in the block data.
 */
function countHeaderRows(block: TableBlock): number {
  let count = 0;
  for (const row of block.rows) {
    if (row.isHeader) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Calculate total height of header rows from their measures.
 */
export function getHeaderRowsHeight(measure: TableMeasure, headerRowCount: number): number {
  let height = 0;
  for (let i = 0; i < headerRowCount && i < measure.rows.length; i++) {
    height += measure.rows[i].height;
  }
  return height;
}

/**
 * Layout a table block onto pages.
 */
function layoutTable(
  block: TableBlock,
  measure: TableMeasure,
  paginator: ReturnType<typeof createPaginator>
): void {
  if (measure.kind !== 'table') {
    throw new Error(`layoutTable: expected table measure`);
  }

  const rows = measure.rows;
  if (rows.length === 0) {
    return;
  }

  // Detect header rows (consecutive rows at start with isHeader: true)
  const headerRowCount = countHeaderRows(block);
  const headerRowsHeight = getHeaderRowsHeight(measure, headerRowCount);

  let currentRowIndex = 0;

  while (currentRowIndex < rows.length) {
    const state = paginator.getCurrentState();
    const rawAvailableHeight = paginator.getAvailableHeight();
    const isFirstFragment = currentRowIndex === 0;

    // Account for trailing spacing from previous block that addFragment will consume.
    // addFragment computes effectiveSpaceBefore = max(spaceBefore, trailingSpacing)
    // and adds it to the fragment height before calling ensureFits.
    // We pass spaceBefore=0 for tables, so the overhead is just trailingSpacing.
    const pendingSpacing = isFirstFragment ? state.trailingSpacing : 0;
    const availableHeight = rawAvailableHeight - pendingSpacing;

    // For continuation fragments, we need space for header rows + at least one content row
    const headerOverhead = !isFirstFragment && headerRowCount > 0 ? headerRowsHeight : 0;

    // Calculate how many rows fit (excluding header rows which are prepended separately)
    let rowsHeight = 0;
    let fittingRows = 0;

    for (let j = currentRowIndex; j < rows.length; j++) {
      const rowHeight = rows[j].height;
      const totalWithRow = rowsHeight + rowHeight + headerOverhead;

      if (totalWithRow <= availableHeight || fittingRows === 0) {
        rowsHeight += rowHeight;
        fittingRows++;
      } else {
        break;
      }
    }

    // Total fragment height includes header rows for continuation fragments
    const fragmentHeight = rowsHeight + headerOverhead;

    // Create fragment for these rows
    const isLastFragment = currentRowIndex + fittingRows >= rows.length;

    // Calculate x position based on table justification and indent
    let desiredX = paginator.getColumnX(state.columnIndex);
    if (block.justification === 'center') {
      desiredX = desiredX + (paginator.columnWidth - measure.totalWidth) / 2;
    } else if (block.justification === 'right') {
      desiredX = desiredX + paginator.columnWidth - measure.totalWidth;
    } else if (block.indent) {
      desiredX += block.indent;
    }

    const fragment: TableFragment = {
      kind: 'table',
      blockId: block.id,
      x: desiredX,
      y: 0, // Will be set by addFragment
      width: measure.totalWidth,
      height: fragmentHeight,
      fromRow: currentRowIndex,
      toRow: currentRowIndex + fittingRows,
      pmStart: block.pmStart,
      pmEnd: block.pmEnd,
      continuesFromPrev: !isFirstFragment,
      continuesOnNext: !isLastFragment,
      headerRowCount: !isFirstFragment && headerRowCount > 0 ? headerRowCount : undefined,
    };

    const result = paginator.addFragment(fragment, fragmentHeight, 0, 0);
    fragment.y = result.y;
    fragment.x = desiredX;

    currentRowIndex += fittingRows;

    // If more rows remain, advance to next column/page
    if (currentRowIndex < rows.length) {
      // Need space for at least one content row plus repeated header rows
      const nextRowHeight =
        rows[currentRowIndex].height + (headerRowCount > 0 ? headerRowsHeight : 0);
      paginator.ensureFits(nextRowHeight);
    }
  }
}

/**
 * Layout a floating table (anchored) without advancing the cursor.
 */
function layoutFloatingTable(
  block: TableBlock,
  measure: TableMeasure,
  paginator: ReturnType<typeof createPaginator>,
  contentWidth: number
): void {
  if (measure.kind !== 'table') {
    throw new Error(`layoutFloatingTable: expected table measure`);
  }

  const state = paginator.getCurrentState();
  const floating = block.floating;
  const page = state.page;
  const margins = page.margins;

  const tableWidth = measure.totalWidth;
  const tableHeight = measure.totalHeight;

  const contentHeight = page.size.h - margins.top - margins.bottom;

  // Default anchor base (content area)
  let baseX = margins.left;
  let baseY = margins.top;

  if (floating?.horzAnchor === 'page') baseX = 0;
  if (floating?.vertAnchor === 'page') baseY = 0;

  // Determine X position
  let x = paginator.getColumnX(state.columnIndex);
  if (floating?.tblpX !== undefined) {
    x = baseX + floating.tblpX;
  } else if (floating?.tblpXSpec) {
    const spec = floating.tblpXSpec;
    if (spec === 'left' || spec === 'inside') {
      x = baseX;
    } else if (spec === 'right' || spec === 'outside') {
      x = baseX + contentWidth - tableWidth;
    } else if (spec === 'center') {
      x = baseX + (contentWidth - tableWidth) / 2;
    }
  } else if (block.justification === 'center') {
    x = baseX + (contentWidth - tableWidth) / 2;
  } else if (block.justification === 'right') {
    x = baseX + contentWidth - tableWidth;
  }

  // Determine Y position
  let y = state.cursorY;
  let usedExplicitY = false;
  if (floating?.tblpY !== undefined) {
    y = baseY + floating.tblpY;
    usedExplicitY = true;
  } else if (floating?.tblpYSpec) {
    usedExplicitY = true;
    const spec = floating.tblpYSpec;
    if (spec === 'top') {
      y = baseY;
    } else if (spec === 'bottom') {
      y = baseY + contentHeight - tableHeight;
    } else if (spec === 'center') {
      y = baseY + (contentHeight - tableHeight) / 2;
    }
  }

  // If not explicitly positioned, ensure it fits on the current page
  if (!usedExplicitY) {
    const fitState = paginator.ensureFits(tableHeight);
    y = fitState.cursorY;
  }

  // Clamp within content area to avoid negative positions
  const minX = margins.left;
  const maxX = margins.left + contentWidth - tableWidth;
  if (Number.isFinite(maxX)) {
    x = Math.max(minX, Math.min(x, maxX));
  }

  const fragment: TableFragment = {
    kind: 'table',
    blockId: block.id,
    x,
    y,
    width: tableWidth,
    height: tableHeight,
    fromRow: 0,
    toRow: block.rows.length,
    pmStart: block.pmStart,
    pmEnd: block.pmEnd,
    isFloating: true,
  };

  // Add directly without advancing cursor
  state.page.fragments.push(fragment);
}

/**
 * Layout an image block onto pages.
 */
function layoutImage(
  block: ImageBlock,
  measure: ImageMeasure,
  paginator: ReturnType<typeof createPaginator>
): void {
  if (measure.kind !== 'image') {
    throw new Error(`layoutImage: expected image measure`);
  }

  // Handle anchored images differently
  if (block.anchor?.isAnchored) {
    layoutAnchoredImage(block, measure, paginator);
    return;
  }

  // Inline image - ensure it fits
  const state = paginator.ensureFits(measure.height);

  const fragment: ImageFragment = {
    kind: 'image',
    blockId: block.id,
    x: paginator.getColumnX(state.columnIndex),
    y: 0, // Will be set by addFragment
    width: measure.width,
    height: measure.height,
    pmStart: block.pmStart,
    pmEnd: block.pmEnd,
  };

  const result = paginator.addFragment(fragment, measure.height, 0, 0);
  fragment.y = result.y;
}

/**
 * Layout an anchored (floating) image.
 */
function layoutAnchoredImage(
  block: ImageBlock,
  measure: ImageMeasure,
  paginator: ReturnType<typeof createPaginator>
): void {
  const state = paginator.getCurrentState();
  const anchor = block.anchor!;

  // Position based on anchor offsets
  const x = anchor.offsetH ?? paginator.getColumnX(state.columnIndex);
  const y = anchor.offsetV ?? state.cursorY;

  const fragment: ImageFragment = {
    kind: 'image',
    blockId: block.id,
    x,
    y,
    width: measure.width,
    height: measure.height,
    pmStart: block.pmStart,
    pmEnd: block.pmEnd,
    isAnchored: true,
    zIndex: anchor.behindDoc ? -1 : 1,
  };

  // Add directly to page without affecting cursor
  state.page.fragments.push(fragment);
}

/**
 * Layout a text box block onto pages.
 */
function layoutTextBox(
  block: TextBoxBlock,
  measure: TextBoxMeasure,
  paginator: ReturnType<typeof createPaginator>
): void {
  if (measure.kind !== 'textBox') {
    throw new Error(`layoutTextBox: expected textBox measure`);
  }

  const state = paginator.ensureFits(measure.height);

  const fragment: TextBoxFragment = {
    kind: 'textBox',
    blockId: block.id,
    x: paginator.getColumnX(state.columnIndex),
    y: 0,
    width: measure.width,
    height: measure.height,
    pmStart: block.pmStart,
    pmEnd: block.pmEnd,
  };

  const result = paginator.addFragment(fragment, measure.height, 0, 0);
  fragment.y = result.y;
}

/**
 * Handle a section break block.
 * @param block - The section break block (current section's properties)
 * @param paginator - The paginator instance
 * @param nextSectionColumns - Column layout for the NEXT section
 * @param nextSectionType - Break type of the NEXT section (how it starts relative to current)
 */
function handleSectionBreak(
  _block: SectionBreakBlock,
  paginator: ReturnType<typeof createPaginator>,
  nextSectionColumns: ColumnLayout,
  nextSectionType?: SectionBreakBlock['type']
): void {
  // ECMA-376 §17.6.22: w:type specifies how the NEXT section starts relative to this one.
  // Default is 'nextPage' when w:type is absent.
  const breakType = nextSectionType ?? 'nextPage';

  switch (breakType) {
    case 'nextPage':
      paginator.forcePageBreak();
      break;

    case 'evenPage': {
      const state = paginator.forcePageBreak();
      // If landed on odd page, add another page
      if (state.page.number % 2 !== 0) {
        paginator.forcePageBreak();
      }
      break;
    }

    case 'oddPage': {
      const state = paginator.forcePageBreak();
      // If landed on even page, add another page
      if (state.page.number % 2 === 0) {
        paginator.forcePageBreak();
      }
      break;
    }

    case 'continuous':
      // No page break, content continues
      break;
  }

  // Update column layout for the next section
  paginator.updateColumns(nextSectionColumns);
}

export type { KeepNextChain } from './keep-together';
export {
  calculateChainHeight,
  computeKeepNextChains,
  getMidChainIndices,
  hasKeepLines,
  hasPageBreakBefore,
} from './keep-together';
export type { PageState, Paginator, PaginatorOptions } from './paginator';
export { createPaginator, createPaginatorFromSnapshot } from './paginator';
export type { BreakDecision, SectionState } from './section-breaks';
export {
  applyPendingToActive,
  createInitialSectionState,
  getEffectiveColumns,
  getEffectiveMargins,
  getEffectivePageSize,
  scheduleSectionBreak,
} from './section-breaks';
// Re-export types
export * from './types';
