// Rows of a top-level table that meet a wrapping float.
//
// A table row does not wrap its cell text beside a float that crosses the table. The row moves
// below the float's wrap band, and the rows after it follow. This holds for a picture in the
// page header as well as for a body float anchored before the table, and on every page the
// table continues onto. A float that stays clear of the table's horizontal extent does not
// move it, and paragraphs keep wrapping beside every float as before.
//
// The band is the float's wrap outline: a tight or through outline ends at its polygon, not
// at the picture's extent, plus the bottom wrap distance. Floats anchored inside the table
// keep their own rules (`table-out-of-cell-floats.ts`, cell flow), and floats anchored after
// the table cannot reach back to it. Floating tables and frames are not obstacles here.

import type { ExclusionZone } from './drawing-exclusion.ts';
import { squareExclusionBounds } from './drawing-wrap.ts';
import type { SemanticTableStructure } from './semantic-table.ts';
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

/** A row, or rows, about to be placed: its height and whether it can start at a top. */
export interface PendingTableBand {
  readonly heightAt: (top: number) => number;
  readonly fitsAt: (top: number) => boolean;
}

/** What the clearance reads from, and moves, in the paginator that owns the table. */
export interface TableFloatClearanceHost {
  readonly flow: { cursorY: number };
  /** Left edge of the table in page-content points, which moves between fragments. */
  readonly left: () => number;
  /** Bottom of the band the page being filled offers the table. */
  readonly bottom: () => number;
  /** Whether only repeated header rows precede the cursor on the page being filled. */
  readonly opensPage: () => boolean;
  /** The cursor moved to `top`; a fragment without rows opens there. */
  readonly moved: (top: number) => void;
}

export interface TableFloatClearance {
  /** The body row being placed, which a page break carries to its next fragment. */
  pending: PendingTableBand | undefined;
  /** Moves the cursor below every float the band crosses; true when it moved. */
  clear(heightAt: PendingTableBand['heightAt'], fitsAt: PendingTableBand['fitsAt']): boolean;
  /** Clears the pending row below `repeat` points of repeated header rows. */
  clearPending(repeat: number): void;
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
 * Clearance for an in-flow table's rows, or null when the flow publishes no wrap zones. Zones
 * are read per call: each page the table reaches has its own.
 *
 * On a page the table opens, a band that cannot start below the float keeps its place, so a
 * float taller than the room it leaves never pushes a row from page to page. A float whose
 * band reaches the page bottom moves nothing.
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
  const reaches = (zone: ExclusionZone): boolean => {
    if (zone.sourceKind === 'furniture') return true;
    if (zone.sourceKind !== undefined || start === undefined || !orderOf) return false;
    if (zone.anchorParagraphId.startsWith(ownPrefix)) return false;
    const order = orderOf(zone.anchorParagraphId);
    return order !== undefined && order < start;
  };
  let bandsFor: readonly ExclusionZone[] | undefined;
  let bands: readonly CollisionBand[] = [];
  const clearedTop = (top: number, heightAt: (top: number) => number): number => {
    const zones = zonesOf();
    if (zones !== bandsFor) {
      bandsFor = zones;
      bands = zones.filter(reaches).map(collisionBand);
    }
    const left = host.left();
    const crossing = bands.filter(
      (band) => band.left < left + width - EPSILON && band.right > left + EPSILON
    );
    let y = top;
    for (let step = 0; step < MAX_CLEARANCE_STEPS; step += 1) {
      const below = crossing.filter((band) => band.bottom > y + EPSILON);
      if (below.length === 0) return y;
      const bottom = y + heightAt(y);
      let next = y;
      for (const band of below) {
        if (band.top < bottom - EPSILON) next = Math.max(next, band.bottom);
      }
      if (next <= y + EPSILON) return y;
      y = next;
    }
    return y;
  };
  const clearance: TableFloatClearance = {
    pending: undefined,
    clear(heightAt, fitsAt) {
      const top = host.flow.cursorY;
      const cleared = clearedTop(top, heightAt);
      // A band reaching the page bottom keeps the row in place rather than emptying the page.
      if (cleared <= top + EPSILON || cleared >= host.bottom() - EPSILON) return false;
      if (host.opensPage() && !fitsAt(cleared)) return false;
      host.flow.cursorY = cleared;
      host.moved(cleared);
      return true;
    },
    clearPending(repeat) {
      const pending = clearance.pending;
      if (!pending) return;
      clearance.clear(
        (top) => repeat + pending.heightAt(top + repeat),
        (top) => pending.fitsAt(top + repeat)
      );
    },
  };
  return clearance;
}
