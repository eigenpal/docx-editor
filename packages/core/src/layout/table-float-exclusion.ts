// Floating tables use the same scanline geometry and convergence keys as anchored drawings.
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ExclusionZone, ExclusionColumnLayout } from './drawing-exclusion.ts';
import type { BlockFragmentRecord, PageRecord, TableFragmentRecord } from './semantic-records.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import {
  positionedTablesByAnchor,
  tableFloatOriginY,
  type PositionedTableAnchor,
  type TableVerticalAnchorFrames,
} from './table-float-position.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import {
  readTableStructure,
  type SemanticTableStructure,
  type TableAnchorFrames,
} from './semantic-table.ts';
import { positionedTableOriginX } from './table-origin.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';

export function hasFloatingTables(
  blocks: readonly OoxmlElement[],
  width: number,
  styles: StyleCascadeTable | undefined,
  mode: RevisionDisplayMode,
  authors: RevisionAuthorFilter | undefined,
  compatibilityMode?: number
): boolean {
  return blocks.some((block) => {
    if (block.kind !== 'table') return false;
    const float = readTableStructure(
      block,
      width,
      0,
      styles,
      mode,
      authors,
      compatibilityMode
    )?.float;
    return float !== undefined && float.ySpec !== 'inline';
  });
}

/**
 * How far a floating table's own outer rules reach past its grid, per side.
 *
 * Word clears text beside a floating table at the grid edge PLUS the table's authored outer
 * border width PLUS `w:leftFromText`/`w:rightFromText`. The fragment box IS the grid
 * (`columnEdges` run from 0 to `box.width`), so the rule adds a term rather than replacing
 * one, and a table with no authored outer rule adds nothing.
 *
 * Captured against a six-case control over an 8x range of border width: the term is the
 * FULL authored width, not the half a collapsed grid line paints on this side.
 */
function outerRuleWidths(fragment: TableFragmentRecord): {
  readonly left: number;
  readonly right: number;
} {
  const columnCount = Math.max(0, fragment.columnEdges.length - 1);
  let left = 0;
  let right = 0;
  for (const row of fragment.rows) {
    for (const cell of row.cells) {
      const borders = cell.borders;
      if (!borders) continue;
      const first = cell.gridColumn <= 0;
      const last = cell.gridColumn + cell.gridSpan >= columnCount;
      if (first) left = Math.max(left, borders.left?.widthPt ?? 0);
      if (last) right = Math.max(right, borders.right?.widthPt ?? 0);
      for (const segment of borders.edgeSegments ?? []) {
        if (first && segment.side === 'left') left = Math.max(left, segment.edge.widthPt);
        if (last && segment.side === 'right') right = Math.max(right, segment.edge.widthPt);
      }
    }
  }
  return { left, right };
}

export function addFloatingTableExclusions(
  pages: readonly PageRecord[],
  drawingZones: ReadonlyMap<number, readonly ExclusionZone[]>,
  columns: ExclusionColumnLayout
): ReadonlyMap<number, readonly ExclusionZone[]> {
  let result: Map<number, readonly ExclusionZone[]> | undefined;
  for (const [pageIndex, page] of pages.entries()) {
    let pageZones: ExclusionZone[] | undefined;
    for (const block of page.fragments) {
      if (block.kind !== 'table') continue;
      const metadata = block.floatingWrap;
      if (!metadata) continue;
      const grid = block.box;
      const distances = metadata.float.distances ?? { top: 0, right: 0, bottom: 0, left: 0 };
      // A zero authored distance is the one case the control leaves unexplained, so the
      // border term stays off there rather than guessing at Word's minimum separation.
      const rules = outerRuleWidths(block);
      const ruleLeft = distances.left > 0 ? rules.left : 0;
      const ruleRight = distances.right > 0 ? rules.right : 0;
      const box = {
        x: grid.x - ruleLeft,
        y: grid.y,
        width: grid.width + ruleLeft + ruleRight,
        height: grid.height,
      };
      const column = metadata.columnIndex;
      const left = columns.columnLefts?.[column] ?? 0;
      const width = columns.columnWidths?.[column] ?? columns.contentWidth;
      const zone: ExclusionZone = {
        sourceKind: 'table',
        drawingNodeId: `table:${block.tableId}`,
        anchorParagraphId: metadata.anchorId,
        anchorModelStart: 0,
        sourceOrder: metadata.sourceOrder,
        paintLayer: 'inFront',
        relativeHeight: 0,
        allowOverlap: true,
        columnIndex: column,
        y: box.y,
        verticalBand: {
          x: box.x - distances.left,
          y: box.y - distances.top,
          width: box.width + distances.left + distances.right,
          height: box.height + distances.top + distances.bottom,
        },
        input: {
          mode:
            box.x - distances.left <= left && box.x + box.width + distances.right >= left + width
              ? 'topAndBottom'
              : 'square',
          contentBounds: box,
          polygon: null,
          clipPolygon: null,
          wrapDistances: distances,
          effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          textSide: 'bothSides',
          contentLeft: left,
          contentRight: left + width,
        },
      };
      if (!pageZones) {
        result ??= new Map(drawingZones);
        pageZones = [...(drawingZones.get(pageIndex) ?? [])];
        result.set(pageIndex, pageZones);
      }
      pageZones.push(zone);
    }
  }
  return result ?? drawingZones;
}

// The deps object belongs to one body pass. Drawing-free probes have no page-relative inputs.
const bandMemos = new WeakMap<TableFlowDeps, WeakMap<OoxmlElement, Map<number, number>>>();

/** Admission keeps long text tables on the existing row-pagination path. */
export function floatingTableBand(table: OoxmlElement, width: number, deps: TableFlowDeps): number {
  let widths: Map<number, number> | undefined;
  if (!deps.inlineDrawingLayout) {
    let tables = bandMemos.get(deps);
    if (!tables) bandMemos.set(deps, (tables = new WeakMap()));
    widths = tables.get(table);
    if (!widths) tables.set(table, (widths = new Map()));
    const cached = widths.get(width);
    if (cached !== undefined) return cached;
  }
  const structure = readTableStructure(
    table,
    width,
    0,
    deps.styleCascade,
    deps.displayMode,
    deps.revisionAuthorFilter,
    deps.compatibilityMode
  );
  if (!structure?.float || structure.float.vertAnchor !== 'text') return 0;
  // Text-frame alignments need their own admission math; retain the existing row-flow path.
  if (structure.float.ySpec) return Infinity;
  const properties = table.children.find((node) => node.kind === 'tableProperties');
  // No-overlap constrains other tables, not the surrounding paragraph text. Multiple
  // positioned tables retain row flow until their collision displacement is supported.
  if (
    deps.isolatedFloatingTableId !== table.id &&
    properties &&
    properties.kind !== 'textValue' &&
    properties.children.some(
      (node) =>
        node.kind !== 'textValue' &&
        node.localName === 'tblOverlap' &&
        node.attributes.some((attr) => attr.localName === 'val' && attr.value === 'never')
    )
  )
    return Infinity;
  const band =
    Math.max(0, structure.float.yPt) +
    probeTableHeight(structure, table.id, deps) +
    (structure.float.distances?.bottom ?? 0);
  widths?.set(width, band);
  return band;
}

function probeTableHeight(
  structure: SemanticTableStructure,
  tableId: string,
  deps: TableFlowDeps
): number {
  let line = 0;
  return layoutTableFragment(structure, 0, 0, 0, tableId, 0, {
    ...stripAnchorSinksForProbe(deps),
    onCellBreakKey: undefined,
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    nextLineId: () => `floating-table-probe-${line++}`,
  }).bottom;
}

/**
 * Room a page- or margin-framed table's anchor needs when the table lands on body lines
 * already placed on the anchor's page.
 *
 * The table's box does not follow the flow, so the lines before its anchor on that page must
 * clear it too. Clearing moves them, and the anchor after them, below the table. When the
 * anchor then no longer fits, the band exceeds the page and the anchor opens the next page:
 * the table follows its anchor there, and the earlier lines keep their places.
 *
 * Only a column-spanning table in single-column flow is priced. Lines beside a narrower table,
 * and earlier columns of the same sheet, are not modeled.
 */
function pageFramedAnchorBand(
  anchor: PositionedTableAnchor,
  width: number,
  deps: TableFlowDeps,
  placement: {
    readonly anchorY: number;
    readonly anchorExtent: number;
    readonly frames: TableAnchorFrames;
    readonly verticalFrames: TableVerticalAnchorFrames;
    readonly earlier: readonly BlockFragmentRecord[];
  }
): number {
  const column = placement.frames.text;
  if (
    anchor.float.vertAnchor === 'text' ||
    column.left > placement.frames.margin.left + 0.5 ||
    column.width < placement.frames.margin.width - 0.5
  )
    return 0;
  const lineBoxes = placement.earlier.flatMap((block) => {
    if (isOutOfFlowFragment(block) || (block.kind === 'table' && block.floatingWrap)) return [];
    return block.kind === 'table' ? [block.box] : block.lines.map((line) => line.box);
  });
  if (lineBoxes.length === 0) return 0;
  const structure = readTableStructure(
    anchor.table,
    width,
    0,
    deps.styleCascade,
    deps.displayMode,
    deps.revisionAuthorFilter,
    deps.compatibilityMode
  );
  const float = structure?.float;
  if (!structure || !float || float.vertAnchor === 'text' || float.ySpec === 'inline') return 0;
  const distances = float.distances ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const left = positionedTableOriginX(structure, placement.frames, deps.compatibilityMode);
  const tableWidth = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const bandLeft = left - distances.left;
  const bandRight = left + tableWidth + distances.right;
  if (bandLeft > column.left || bandRight < column.left + column.width) return 0;
  // An offset top does not depend on the table height: skip the probe when no line reaches it.
  const inkBottom = lineBoxes.reduce((bottom, box) => Math.max(bottom, box.y + box.height), 0);
  if (
    !float.ySpec &&
    inkBottom <= tableFloatOriginY(float, 0, placement.verticalFrames) - distances.top
  )
    return 0;
  const height = probeTableHeight(structure, anchor.table.id, deps);
  const top = tableFloatOriginY(float, height, placement.verticalFrames);
  const bandTop = top - distances.top;
  const bandBottom = top + height + distances.bottom;
  let firstTop = Infinity;
  for (const box of lineBoxes) {
    if (
      box.y < bandBottom &&
      box.y + box.height > bandTop &&
      box.x < bandRight &&
      box.x + box.width > bandLeft
    )
      firstTop = Math.min(firstTop, box.y);
  }
  if (firstTop > placement.anchorY) return 0;
  return bandBottom - firstTop + placement.anchorExtent;
}

export function requiredAnchorBand(
  anchors: readonly PositionedTableAnchor[],
  pending: ReadonlySet<string>,
  paragraphId: string,
  width: number,
  deps: TableFlowDeps,
  placement: {
    readonly anchorY: number;
    /** Height of the anchor's first line, which must fit below any cleared table. */
    readonly anchorExtent: number;
    readonly frames: TableAnchorFrames;
    readonly verticalFrames: TableVerticalAnchorFrames;
    readonly earlier: readonly BlockFragmentRecord[];
  }
): number {
  if (pending.size === 0) return 0;
  let height = 0;
  for (const anchor of positionedTablesByAnchor(anchors).get(paragraphId) ?? []) {
    if (!pending.has(anchor.table.id)) continue;
    const clearedY = clearEarlierText(
      anchor.table,
      placement.anchorY,
      width,
      placement.frames,
      placement.earlier,
      deps
    );
    const band =
      floatingTableBand(anchor.table, width, deps) +
      clearedY -
      placement.anchorY +
      Math.min(0, anchor.float.yPt);
    height = Math.max(height, band, pageFramedAnchorBand(anchor, width, deps, placement));
  }
  return height;
}

/** Preserve offsets whose padded box clears earlier ink; displacement avoids circular reflow. */
export function clearEarlierText(
  table: OoxmlElement,
  anchorY: number,
  width: number,
  frames: TableAnchorFrames,
  earlier: readonly BlockFragmentRecord[],
  deps: TableFlowDeps
): number {
  const structure = readTableStructure(
    table,
    width,
    0,
    deps.styleCascade,
    deps.displayMode,
    deps.revisionAuthorFilter,
    deps.compatibilityMode
  );
  const float = structure?.float;
  if (!structure || !float || float.vertAnchor !== 'text' || float.ySpec) return anchorY;
  const tableWidth = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const distances = float.distances ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const left = positionedTableOriginX(structure, frames, deps.compatibilityMode) - distances.left;
  const height = floatingTableBand(table, width, deps) - Math.max(0, float.yPt) + distances.top;
  let top = anchorY + float.yPt - distances.top;
  const ink = earlier
    .flatMap((block) => {
      if (block.kind === 'table') return block.floatingWrap ? [] : [block.box];
      return block.lines.flatMap((line) => [
        ...line.spans.filter((span) => span.text.trim()).map((span) => span.box),
        ...(line.drawings ?? []).map((drawing) => drawing.paintBounds),
      ]);
    })
    .sort((a, b) => a.y - b.y);
  for (const box of ink) {
    if (
      left < box.x + box.width &&
      left + tableWidth + distances.left + distances.right > box.x &&
      top < box.y + box.height &&
      top + height > box.y
    )
      top = box.y + box.height;
  }
  return top + distances.top - float.yPt;
}

/** Continuous sections resume below text-relative tables and their requested trailing clearance. */
export function floatingTextTableBottom(blocks: readonly BlockFragmentRecord[]): number {
  let bottom = 0;
  for (const block of blocks) {
    if (block.kind !== 'table' || block.floatingWrap?.float.vertAnchor !== 'text') continue;
    bottom = Math.max(
      bottom,
      block.box.y + block.box.height + (block.floatingWrap.float.distances?.bottom ?? 0)
    );
  }
  return bottom;
}

const earliestExclusions = new WeakMap<
  TableFlowDeps,
  {
    readonly zones: ReadonlyMap<number, readonly ExclusionZone[]>;
    readonly remainingOrders: readonly (readonly [page: number, order: number])[];
  }
>();

/** A floating table needs placement-aware row admission when earlier objects wrap its cells. */
export function hasEarlierCellExclusions(
  table: OoxmlElement,
  zones: ReadonlyMap<number, readonly ExclusionZone[]> | undefined,
  deps: TableFlowDeps,
  firstPage = 0
): boolean {
  if (!deps.pageExclusionZones || !zones?.size) return false;
  let memo = earliestExclusions.get(deps);
  if (memo?.zones !== zones) {
    const remainingOrders: [number, number][] = [];
    for (const [pageIndex, page] of zones) {
      let order = Infinity;
      for (const zone of page)
        order = Math.min(
          order,
          deps.paragraphOrderIndex?.(zone.anchorParagraphId) ?? zone.sourceOrder
        );
      remainingOrders.push([pageIndex, order]);
    }
    remainingOrders.sort((a, b) => a[0] - b[0]);
    for (let index = remainingOrders.length - 2; index >= 0; index--)
      remainingOrders[index]![1] = Math.min(
        remainingOrders[index]![1],
        remainingOrders[index + 1]![1]
      );
    memo = { zones, remainingOrders };
    earliestExclusions.set(deps, memo);
  }
  // Completed pages cannot wrap this table's cells. Retain later-page exclusions
  // because an inline table can continue there; query the suffix without rescanning
  // all pages for every table in a long document.
  let low = 0;
  let high = memo.remainingOrders.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (memo.remainingOrders[middle]![0] < firstPage) low = middle + 1;
    else high = middle;
  }
  const earliestOrder = memo.remainingOrders[low]?.[1];
  if (earliestOrder === undefined || earliestOrder === Infinity) return false;
  const pending = [table];
  let visits = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++visits > 10000) return true;
    if (node.kind === 'paragraph') {
      if (earliestOrder <= (deps.paragraphOrderIndex?.(node.id) ?? Number.MAX_SAFE_INTEGER))
        return true;
      continue;
    }
    if (visits + pending.length + node.children.length > 10000) return true;
    for (const child of node.children) if (child.kind !== 'textValue') pending.push(child);
  }
  return false;
}
