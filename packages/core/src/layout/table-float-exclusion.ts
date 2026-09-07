// Floating tables use the same scanline geometry and convergence keys as anchored drawings.
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ExclusionZone, ExclusionColumnLayout } from './drawing-exclusion.ts';
import type { BlockFragmentRecord, PageRecord } from './semantic-records.ts';
import { positionedTablesByAnchor, type PositionedTableAnchor } from './table-float-position.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import { readTableStructure, tableFloatOriginX, type TableAnchorFrames } from './semantic-table.ts';
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
      const box = block.box;
      const distances = metadata.float.distances ?? { top: 0, right: 0, bottom: 0, left: 0 };
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
  if (
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
  let line = 0;
  const probe = layoutTableFragment(structure, 0, 0, 0, table.id, 0, {
    ...stripAnchorSinksForProbe(deps),
    onCellBreakKey: undefined,
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    nextLineId: () => `floating-table-probe-${line++}`,
  });
  const band =
    Math.max(0, structure.float.yPt) + probe.bottom + (structure.float.distances?.bottom ?? 0);
  widths?.set(width, band);
  return band;
}

export function requiredAnchorBand(
  anchors: readonly PositionedTableAnchor[],
  pending: ReadonlySet<string>,
  paragraphId: string,
  width: number,
  deps: TableFlowDeps,
  placement: {
    readonly anchorY: number;
    readonly frames: TableAnchorFrames;
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
    height = Math.max(height, band);
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
  const left = tableFloatOriginX(float, tableWidth, frames) - distances.left;
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
    readonly order: number;
  }
>();

/** A floating table needs placement-aware row admission when earlier objects wrap its cells. */
export function hasEarlierCellExclusions(
  table: OoxmlElement,
  zones: ReadonlyMap<number, readonly ExclusionZone[]> | undefined,
  deps: TableFlowDeps
): boolean {
  if (!deps.pageExclusionZones || !zones?.size) return false;
  let memo = earliestExclusions.get(deps);
  if (memo?.zones !== zones) {
    let order = Infinity;
    for (const page of zones.values())
      for (const zone of page)
        order = Math.min(
          order,
          deps.paragraphOrderIndex?.(zone.anchorParagraphId) ?? zone.sourceOrder
        );
    memo = { zones, order };
    earliestExclusions.set(deps, memo);
  }
  const pending = [table];
  let visits = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++visits > 10000) return true;
    if (node.kind === 'paragraph') {
      if (memo.order <= (deps.paragraphOrderIndex?.(node.id) ?? Number.MAX_SAFE_INTEGER))
        return true;
      continue;
    }
    if (visits + pending.length + node.children.length > 10000) return true;
    for (const child of node.children) if (child.kind !== 'textValue') pending.push(child);
  }
  return false;
}
