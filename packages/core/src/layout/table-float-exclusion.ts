// Floating tables use the same scanline geometry and convergence keys as anchored drawings.
import { autofitContextOf, type TableAutofitContext } from './table-autofit-widths.ts';
import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { hardBreakKind } from '../store/package/hard-break.ts';
import { paragraphBreaksBefore } from './paragraph-style.ts';
import type { PreparedBlock } from './section-prepass-types.ts';
import { framedTokenJoin } from './layout-cache.ts';
import type { ExclusionZone, ExclusionColumnLayout } from './drawing-exclusion.ts';
import type { BlockFragmentRecord, PageRecord, TableFragmentRecord } from './semantic-records.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import {
  positionedTablesByAnchor,
  positionedTableAnchors,
  tableFloatOriginY,
  type PositionedTableAnchor,
  type PositionedTableAnchorSignal,
  type TableVerticalAnchorFrames,
} from './table-float-position.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  measureRowHeight,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import {
  readTableStructure,
  type SemanticTableStructure,
  type TableAnchorFrames,
} from './semantic-table.ts';
import { positionedTableOriginX } from './table-origin.ts';
import { pinnedTableBreak } from './table-pinned-break.ts';
import {
  noOverlapShift,
  tableRefusesOverlap,
  withoutFloatingTableZones,
  type NoOverlapObstacle,
} from './table-float-overlap.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';

/**
 * A table's structure for float placement. A table that floats is read at the widths
 * placement lays it out at; one that does not skips the autofit pass, since these readers
 * only ask whether it floats.
 */
function floatTableStructure(table: OoxmlElement, width: number, deps: TableFlowDeps) {
  const read = (autofit?: TableAutofitContext) =>
    readTableStructure(
      table,
      width,
      0,
      deps.styleCascade,
      deps.displayMode,
      deps.revisionAuthorFilter,
      deps.compatibilityMode,
      autofit
    );
  const base = read();
  return base?.float ? read(autofitContextOf(deps)) : base;
}

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
  pages: readonly Pick<PageRecord, 'fragments'>[],
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

const NO_DISTANCES = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const NO_SHIFT: { readonly dx: number; readonly dy: number; readonly band?: NoOverlapObstacle } =
  Object.freeze({ dx: 0, dy: 0 });

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
  const structure = floatTableStructure(table, width, deps);
  if (!structure?.float || structure.float.vertAnchor !== 'text') return 0;
  // Text-frame alignments need their own admission math; retain the existing row-flow path.
  // `w:tblOverlap` does not: it moves the table off other floating tables at placement.
  if (structure.float.ySpec) return Infinity;
  const band =
    Math.max(0, structure.float.yPt) +
    probeTableHeight(structure, table.id, deps) +
    (structure.float.distances?.bottom ?? 0);
  widths?.set(width, band);
  return band;
}

/** Keep anchor page breaks, authored gaps, and shared anchors on the whole-table path. */
export function anchorBreakPolicy(
  anchors: readonly PositionedTableAnchor[],
  blocks: readonly PreparedBlock[]
): ReadonlyMap<string, boolean> {
  const policy = new Map(anchors.map(({ table }) => [table.id, false]));
  if (!anchors.length) return policy;
  const byParagraph = positionedTablesByAnchor(anchors);
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const tables = byParagraph.get(block.paragraph.id);
    if (tables?.length !== 1 || paragraphBreaksBefore(block.props) || block.spacing.before > 0)
      continue;
    if (paragraphHasPageOrColumnBreak(block.paragraph)) continue;
    policy.set(tables[0]!.table.id, true);
  }
  return policy;
}

function paragraphHasPageOrColumnBreak(paragraph: OoxmlElement): boolean {
  const pending: OoxmlNode[] = [paragraph];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'hardBreak' && ['page', 'column'].includes(hardBreakKind(node))) return true;
    if ('children' in node) for (const child of node.children) pending.push(child);
  }
  return false;
}

export interface PositionedTableFlowPolicy {
  readonly positionedTables: readonly PositionedTableAnchor[];
  readonly positionedTablePolicy: ReadonlyMap<string, boolean>;
}

/** Anchor admission is a forward dependency of the earlier table's flow checkpoint. */
export function anchorFlow(
  prepared: readonly PreparedBlock[],
  width: number,
  styles: StyleCascadeTable | undefined,
  mode: RevisionDisplayMode,
  authors: RevisionAuthorFilter | undefined,
  compatibilityMode?: number
): PositionedTableFlowPolicy {
  const positionedTables = positionedTableAnchors(
    prepared,
    width,
    styles,
    mode,
    authors,
    compatibilityMode
  );
  const positionedTablePolicy = anchorBreakPolicy(positionedTables, prepared);
  return { positionedTables, positionedTablePolicy };
}

/** Run before cross-block folds so keep-next chains carry anchor admission changes. */
export function anchorFlowKeys(keys: string[], state: PositionedTableFlowPolicy): string[] {
  if (!state.positionedTables.length) return keys;
  const flowKeys = [...keys];
  for (const anchor of state.positionedTables) {
    flowKeys[anchor.sourceIndex] = framedTokenJoin([
      keys[anchor.sourceIndex]!,
      anchor.anchorId,
      state.positionedTablePolicy.get(anchor.table.id) ? 'split' : 'whole',
    ]);
  }
  return flowKeys;
}

/** Where the body flow stands when it reaches a positioned table. */
export interface FloatAdmissionFlow {
  readonly allowBreak: boolean | undefined;
  readonly zones: ReadonlyMap<number, readonly ExclusionZone[]> | undefined;
  readonly page: number;
  /** The narrowest column. The table must fit whichever column its anchor reaches. */
  readonly width: number;
  readonly frames: TableAnchorFrames;
  /** Vertical frames on this page. The text frame starts at the body cursor. */
  readonly verticalFrames: TableVerticalAnchorFrames;
  readonly bottom: number;
}

const flowTop = (flow: FloatAdmissionFlow): number => flow.verticalFrames.text.top;

/**
 * True when a positioned table waits for its anchor paragraph and is placed there whole.
 *
 * Row pagination places the table instead when earlier objects wrap its cells, or when its
 * band is taller than a page. It also places a text-relative table that spans its column
 * and does not fit the room left, when its opening rows do fit there. That table breaks at
 * the page bottom, and its remaining rows continue at the top of the next page. No text can
 * stand beside it, so the flow resumes below its last row. When the opening rows do not fit,
 * the table still moves whole with its anchor.
 */
export function admitsAtAnchor(
  table: OoxmlElement,
  deps: TableFlowDeps,
  flow: FloatAdmissionFlow
): boolean {
  if (hasEarlierCellExclusions(table, flow.zones, deps, flow.page)) return false;
  if (breaksAcrossPages(table, deps, flow)) return false;
  const band = floatingTableBand(table, flow.width, deps);
  if (band > flow.bottom) return false;
  if (deps.styleCascade?.doNotBreakWrappedTables) return true;
  return (
    band <= flow.bottom - flowTop(flow) ||
    !flow.allowBreak ||
    !breaksAtPageBottom(table, deps, flow)
  );
}

/** A page- or margin-positioned table that reaches below the bottom margin breaks in flow. */
function breaksAcrossPages(
  table: OoxmlElement,
  deps: TableFlowDeps,
  flow: FloatAdmissionFlow
): boolean {
  const structure = readTableStructure(
    table,
    flow.width,
    0,
    deps.styleCascade,
    deps.displayMode,
    deps.revisionAuthorFilter,
    deps.compatibilityMode
  );
  return (
    !!structure &&
    pinnedTableBreak(table, structure, deps, {
      top: flowTop(flow),
      bottom: flow.bottom,
      frames: flow.frames,
      verticalFrames: flow.verticalFrames,
      width: flow.width,
    }) !== undefined
  );
}

function breaksAtPageBottom(
  table: OoxmlElement,
  deps: TableFlowDeps,
  flow: FloatAdmissionFlow
): boolean {
  const structure = floatTableStructure(table, flow.width, deps);
  const float = structure?.float;
  // A negative offset collides with earlier text. Only anchor placement displaces it.
  if (!structure || float?.vertAnchor !== 'text' || float.ySpec || float.yPt < 0) return false;
  const distances = float.distances ?? { top: 0, right: 0, bottom: 0, left: 0 };
  if (distances.top > 0 || distances.bottom > 0) return false;
  const left = positionedTableOriginX(structure, flow.frames, deps.compatibilityMode);
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const column = flow.frames.text;
  if (
    left - distances.left > column.left ||
    left + width + distances.right < column.left + column.width
  )
    return false;
  // The opening rows are the header prefix, which moves as one group, and the first body row.
  let top = flowTop(flow) + float.yPt;
  for (const [index, row] of structure.rows.entries()) {
    top += measureRowHeight(
      row,
      structure.columnWidthsPt,
      left,
      0,
      index === 0 ? firstRowContentDeps(structure, row, deps) : deps,
      structure.cellSpacingPt
    );
    if (top > flow.bottom + 0.001) return false;
    if (!row.isHeader) return true;
  }
  return false;
}

function probeTableHeight(
  structure: SemanticTableStructure,
  tableId: string,
  deps: TableFlowDeps
): number {
  let line = 0;
  // Measured as placed: a floating table's cells never wrap around another floating table.
  return layoutTableFragment(structure, 0, 0, 0, tableId, 0, {
    ...stripAnchorSinksForProbe(withoutFloatingTableZones(deps)),
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
  const structure = floatTableStructure(anchor.table, width, deps);
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
    /** Anchors already laid on this page whose tables wait for the page flush. */
    readonly signals?: readonly PositionedTableAnchorSignal[];
  }
): number {
  if (pending.size === 0) return 0;
  let height = 0;
  const byParagraph = positionedTablesByAnchor(anchors);
  const pendingOf = (anchorId: string) =>
    (byParagraph.get(anchorId) ?? []).filter((anchor) => pending.has(anchor.table.id));
  const here = pendingOf(paragraphId);
  // Tables of earlier anchors on this page are placed first, at the flush, in anchor order.
  const before = here.length > 0 ? (placement.signals ?? []) : [];
  const waiting = before.flatMap((signal) =>
    pendingOf(signal.anchorId).map((anchor) => ({ anchor, anchorY: signal.anchorY }))
  );
  const placed = here.length > 0 ? placedFloatObstacles(placement.earlier, deps) : [];
  // Overlap avoidance only runs when a table involved refuses overlap.
  const avoids =
    [...here, ...waiting.map((entry) => entry.anchor)].some((anchor) =>
      tableRefusesOverlap(anchor.table)
    ) || placed.some((obstacle) => obstacle.refusesOverlap);
  const prospective: NoOverlapObstacle[] = [];
  if (avoids) {
    for (const { anchor, anchorY } of waiting) {
      const y = clearEarlierText(
        anchor.table,
        anchorY,
        width,
        placement.frames,
        placement.earlier,
        deps
      );
      const shift = noOverlapPlacement(anchor.table, y, width, placement.frames, deps, [
        ...placed,
        ...prospective,
      ]);
      if (shift.band) prospective.push(shift.band);
    }
  }
  for (const anchor of here) {
    const clearedY = clearEarlierText(
      anchor.table,
      placement.anchorY,
      width,
      placement.frames,
      placement.earlier,
      deps
    );
    // Tables sharing this anchor are placed in order, so each one meets the ones before it.
    const shift = avoids
      ? noOverlapPlacement(anchor.table, clearedY, width, placement.frames, deps, [
          ...placed,
          ...prospective,
        ])
      : NO_SHIFT;
    if (shift.band) prospective.push(shift.band);
    const band =
      floatingTableBand(anchor.table, width, deps) +
      clearedY +
      shift.dy -
      placement.anchorY +
      Math.min(0, anchor.float.yPt);
    height = Math.max(height, band, pageFramedAnchorBand(anchor, width, deps, placement));
  }
  return height;
}

/**
 * Where a text-anchored table placed at its anchor starts: below the earlier text it would
 * cover, then off the floating tables already on the page. `dx` moves it sideways.
 */
export function positionedTableStart(
  table: OoxmlElement,
  anchorY: number,
  width: number,
  frames: TableAnchorFrames,
  pageFragments: readonly BlockFragmentRecord[],
  anchorFragmentIndex: number,
  deps: TableFlowDeps,
  /** The page content bottom. A move down never takes the table past it. */
  bottom: number
): { readonly anchorY: number; readonly dx: number } {
  const earlier = pageFragments.slice(0, anchorFragmentIndex);
  const clearedY = clearEarlierText(table, anchorY, width, frames, earlier, deps);
  const obstacles = placedFloatObstacles(pageFragments, deps);
  if (!tableRefusesOverlap(table) && !obstacles.some((obstacle) => obstacle.refusesOverlap))
    return { anchorY: clearedY, dx: 0 };
  const shift = noOverlapPlacement(table, clearedY, width, frames, deps, obstacles);
  // The anchor's band priced the moves it could see. A table that a later move would push
  // below the page keeps its authored place rather than painting into the bottom margin.
  if (shift.dy > 0 && (shift.band?.bottom ?? 0) > bottom + 0.001)
    return { anchorY: clearedY, dx: 0 };
  return { anchorY: clearedY + shift.dy, dx: shift.dx };
}

/** Floating tables already placed among `fragments`, as obstacles for a later table. */
export function placedFloatObstacles(
  fragments: readonly BlockFragmentRecord[],
  deps: TableFlowDeps
): NoOverlapObstacle[] {
  const obstacles: NoOverlapObstacle[] = [];
  // Floating tables an earlier section left on this sheet. Their own setting is not known
  // here, so only a table that itself refuses overlap moves off them.
  for (const zone of deps.pageExclusionZones?.() ?? []) {
    if (!zone.earlierSection || zone.sourceKind !== 'table') continue;
    const band = zone.verticalBand;
    obstacles.push({
      left: band.x,
      top: band.y,
      right: band.x + band.width,
      bottom: band.y + band.height,
      refusesOverlap: false,
    });
  }
  for (const fragment of fragments) {
    if (fragment.kind !== 'table' || !fragment.floatingWrap) continue;
    const distances = fragment.floatingWrap.float.distances ?? NO_DISTANCES;
    obstacles.push({
      left: fragment.box.x - distances.left,
      top: fragment.box.y - distances.top,
      right: fragment.box.x + fragment.box.width + distances.right,
      bottom: fragment.box.y + fragment.box.height + distances.bottom,
      refusesOverlap: deps.floatRefusesOverlap?.(fragment.tableId) ?? false,
    });
  }
  return obstacles;
}

/**
 * How far a text-anchored floating table placed at `anchorY` moves off earlier floating
 * tables (`table-float-overlap.ts`), with the band it then occupies. No move without one.
 */
export function noOverlapPlacement(
  table: OoxmlElement,
  anchorY: number,
  width: number,
  frames: TableAnchorFrames,
  deps: TableFlowDeps,
  obstacles: readonly NoOverlapObstacle[]
): { readonly dx: number; readonly dy: number; readonly band?: NoOverlapObstacle } {
  const structure = floatTableStructure(table, width, deps);
  const float = structure?.float;
  if (!structure || !float || float.vertAnchor !== 'text' || float.ySpec) return NO_SHIFT;
  const band = floatingTableBand(table, width, deps);
  if (!Number.isFinite(band)) return NO_SHIFT;
  const distances = float.distances ?? NO_DISTANCES;
  const refusesOverlap = tableRefusesOverlap(table);
  const candidate = {
    left: positionedTableOriginX(structure, frames, deps.compatibilityMode),
    top: anchorY + float.yPt,
    width: structure.columnWidthsPt.reduce((sum, column) => sum + column, 0),
    height: band - Math.max(0, float.yPt) - distances.bottom,
    distances,
    refusesOverlap,
  };
  const shift = noOverlapShift(
    candidate,
    obstacles,
    { left: frames.margin.left, right: frames.margin.left + frames.margin.width },
    hasCompatibilityRule(deps.compatibilityMode, 'floatingTableOverlapMovesLeft')
  );
  const left = candidate.left + shift.dx;
  const top = candidate.top + shift.dy;
  return {
    ...shift,
    band: {
      left: left - distances.left,
      top: top - distances.top,
      right: left + candidate.width + distances.right,
      bottom: top + candidate.height + distances.bottom,
      refusesOverlap,
    },
  };
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
  const structure = floatTableStructure(table, width, deps);
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
      // Another floating table never wraps this table's cells: the two overlap, or
      // `w:tblOverlap` moves this one off it at placement.
      for (const zone of page)
        if (zone.sourceKind !== 'table')
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
