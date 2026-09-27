// Table fragments that meet a wrapping float.
//
// A table does not wrap its cell text beside a float that crosses it. When a fragment of a
// top-level table opens on a page (the table start, or its continuation after a break), and
// its rows would reach a crossing float's wrap band, the whole fragment starts below the band.
// A table that ends above the band stays where it is. Rows never move inside a fragment that
// is already open, so a fragment never gets a gap between its rows.
//
// Obstacles are pictures in the page header or footer, and body pictures anchored before the
// table in document order. In a multi-column section a body picture reaches only its own
// column. A picture clear of the table's horizontal extent, wrap distances included, does not
// move it. Paragraphs keep wrapping beside every float as before.
//
// The band is the float's wrap outline: a tight or through outline ends at its polygon, not
// at the picture's extent, plus the wrap distances. Floats anchored inside the table keep
// their own rules (`table-out-of-cell-floats.ts`, cell flow), and floats anchored after the
// table cannot reach back to it. Floating tables and frames are not obstacles here.
//
// Known difference: a `w:cantSplit` row that fits a page, but not the room below the band on
// the page it opens, keeps its place under the band instead of starting below it and splitting.

import type { ExclusionZone } from './drawing-exclusion.ts';
import { squareExclusionBounds } from './drawing-wrap.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

const EPSILON = 0.001;
const MAX_CLEARANCE_STEPS = 16;

/** A float's wrap outline, in page-content points. */
interface CollisionBand {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * Whether a fragment opened at `top` extends below `limit`, and whether its first row can
 * start at a given top. Both describe the rows the fragment opens with.
 */
export interface PendingTableFragment {
  readonly reaches: (top: number, limit: number) => boolean;
  readonly fitsAt: (top: number) => boolean;
}

/** What the clearance reads from, and moves, in the paginator that owns the table. */
export interface TableFloatClearanceHost {
  readonly flow: { cursorY: number; readonly flowColumn?: () => number | undefined };
  /** Left edge of the table in page-content points, which moves between fragments. */
  readonly left: () => number;
  /** Bottom of the band the page being filled offers the table. */
  readonly bottom: () => number;
  /** Whether only repeated header rows precede the cursor on the page being filled. */
  readonly opensPage: () => boolean;
  /**
   * The cursor moved to `top`, where the fragment, which has no rows yet, opens. `opensPage`
   * tells that nothing but the band is above it on its page.
   */
  readonly moved: (top: number, opensPage: boolean) => void;
  /** One row's natural height at `top`. */
  readonly heightOf: (row: SemanticTableRow, top: number) => number;
}

export interface TableFloatClearance {
  /** The body row being placed, which a page break carries to its next fragment. */
  pending: PendingTableFragment | undefined;
  /**
   * Opens the fragment below every band it would reach; true when the cursor moved. Call it
   * only while the fragment holds no rows.
   */
  clear(fragment: PendingTableFragment): boolean;
  /** Opens a continuation fragment for the pending row below `repeat` points of header rows. */
  clearPending(repeat: number): void;
  /** The fragment that opens with table row `from`; see {@link tableFragmentReach}. */
  fragment(
    from: number,
    fitsAt: (top: number) => boolean,
    lead?: (top: number) => number,
    continued?: () => boolean
  ): PendingTableFragment;
}

/**
 * Whether rows `from` onward, placed at `top` after `lead(top)` points of header rows, extend
 * below `limit`. A continued first row counts as 1 point: only its remainder is left.
 */
export function tableFragmentReach(
  rows: readonly SemanticTableRow[],
  from: number,
  heightOf: (row: SemanticTableRow, top: number) => number,
  lead: (top: number) => number = () => 0,
  continued: () => boolean = () => false
): (top: number, limit: number) => boolean {
  return (top, limit) => {
    if (limit <= top + EPSILON) return true;
    let y = top + lead(top);
    let index = from;
    if (continued()) {
      y += 1;
      index += 1;
    }
    if (y > limit + EPSILON) return true;
    for (; index < rows.length; index += 1) {
      y += heightOf(rows[index]!, y);
      if (y > limit + EPSILON) return true;
    }
    return false;
  };
}

function collisionBand(zone: ExclusionZone): CollisionBand {
  const input = zone.input;
  if (input.mode === 'topAndBottom') {
    const band = zone.verticalBand;
    return { top: band.y, bottom: band.y + band.height, left: -Infinity, right: Infinity };
  }
  if (input.mode === 'square' || !input.polygon || input.polygon.length < 3) {
    const box = squareExclusionBounds(input.contentBounds, input.effectInsets, input.wrapDistances);
    return { top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width };
  }
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const point of input.polygon) {
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
  }
  const insets = input.effectInsets;
  const distances = input.wrapDistances;
  return {
    top: top - insets.top - distances.top,
    bottom: bottom + insets.bottom + distances.bottom,
    left: left - insets.left - distances.left,
    right: right + insets.right + distances.right,
  };
}

/** Document order of the table's first own paragraph, or undefined when none is indexed. */
function tableStartOrder(
  structure: SemanticTableStructure,
  orderOf: (paragraphId: string) => number | undefined
): number | undefined {
  let start: number | undefined;
  for (const row of structure.rows) {
    for (const cell of row.cells) {
      for (const block of cell.blocks) {
        if (block.localName !== 'p') continue;
        const order = orderOf(block.id);
        if (order !== undefined && (start === undefined || order < start)) start = order;
      }
    }
    if (start !== undefined) return start;
  }
  return start;
}

/**
 * Clearance for an in-flow table's fragments, or null when the flow publishes no wrap zones.
 * Zones are read per call: each page the table reaches has its own.
 *
 * Bounds: a band that reaches the page bottom is not an obstacle. On a page the table opens,
 * a fragment whose first row cannot start below the band keeps its place, so no band pushes
 * a fragment from page to page.
 */
export function tableFloatClearance(
  structure: SemanticTableStructure,
  tableId: string,
  deps: TableFlowDeps,
  host: TableFloatClearanceHost
): TableFloatClearance | null {
  const zonesOf = deps.pageExclusionZones;
  if (!zonesOf) return null;
  const orderOf = deps.paragraphOrderIndex;
  const start = orderOf ? tableStartOrder(structure, orderOf) : undefined;
  const ownPrefix = `${tableId}.`;
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const reaches = (zone: ExclusionZone, column: number | undefined): boolean => {
    if (zone.sourceKind === 'furniture') return true;
    if (zone.sourceKind !== undefined || start === undefined || !orderOf) return false;
    if (column !== undefined && zone.columnIndex !== column) return false;
    if (zone.anchorParagraphId.startsWith(ownPrefix)) return false;
    const order = orderOf(zone.anchorParagraphId);
    return order !== undefined && order < start;
  };
  let bandsFor: readonly ExclusionZone[] | undefined;
  let bandsColumn: number | undefined;
  let bands: readonly CollisionBand[] = [];
  const clearedTop = (top: number, fragment: PendingTableFragment): number => {
    const zones = zonesOf();
    const column = host.flow.flowColumn?.();
    if (zones !== bandsFor || column !== bandsColumn) {
      bandsFor = zones;
      bandsColumn = column;
      bands = zones
        .filter((zone) => reaches(zone, column))
        .map(collisionBand)
        .sort((a, b) => a.top - b.top);
    }
    const left = host.left();
    const bottom = host.bottom();
    const crossing = bands.filter(
      (band) =>
        band.bottom < bottom - EPSILON &&
        band.left < left + width - EPSILON &&
        band.right > left + EPSILON
    );
    let y = top;
    for (let step = 0; step < MAX_CLEARANCE_STEPS; step += 1) {
      // Sorted by top: when the fragment does not reach the first band still below it, it
      // reaches none of the later ones.
      const band = crossing.find((candidate) => candidate.bottom > y + EPSILON);
      if (!band || !fragment.reaches(y, band.top)) return y;
      y = band.bottom;
    }
    return y;
  };
  const clearance: TableFloatClearance = {
    pending: undefined,
    clear(fragment) {
      const top = host.flow.cursorY;
      const cleared = clearedTop(top, fragment);
      if (cleared <= top + EPSILON || cleared >= host.bottom() - EPSILON) return false;
      const opensPage = host.opensPage();
      if (opensPage && !fragment.fitsAt(cleared)) return false;
      host.flow.cursorY = cleared;
      host.moved(cleared, opensPage);
      return true;
    },
    clearPending(repeat) {
      const pending = clearance.pending;
      if (!pending) return;
      clearance.clear({
        reaches: (top, limit) => limit <= top + EPSILON || pending.reaches(top + repeat, limit),
        fitsAt: (top) => pending.fitsAt(top + repeat),
      });
    },
    fragment: (from, fitsAt, lead, continued) => ({
      reaches: tableFragmentReach(structure.rows, from, host.heightOf, lead, continued),
      fitsAt,
    }),
  };
  return clearance;
}
