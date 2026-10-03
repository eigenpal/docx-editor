// A table positioned against the page or margin that does not fit above the bottom margin.
//
// A `w:tblpPr` table with `w:vertAnchor="page"` or `"margin"` normally keeps its sheet
// position and stays out of the text flow. When its authored box would reach below the
// bottom margin, it breaks across pages in the body flow instead:
//
// - Its leading part is what fits between the body cursor and the bottom margin: the whole
//   rows that fit, or, when not even the first row fits, the lines of that row that do.
// - It starts at the higher of two tops: the authored position of a box as tall as the
//   leading part, and the top that puts the leading part's bottom at the bottom page edge.
//   A box that ends above the page edge therefore keeps its `w:tblpY`, and bottom alignment
//   is the page-edge top itself.
// - Its first fragment is no taller than the room the body had below its cursor. Since mode 15
//   it also ends at the bottom margin (`positionedTableBreaksAtMargin`); earlier modes run it
//   to the page edge.
// - Later fragments open at the top of the next page, and the body flow resumes below the last
//   row, after `w:bottomFromText`. Rows split at line boundaries, `w:cantSplit` rows included.
// - When the start lies above the body cursor, the table would cover text already on the
//   page, so it opens the next page and starts there by the same rule.
//
// Limits, each keeping the sheet-pinned placement:
// - A table entirely outside the text column, or one whose rows are all exact heights.
// - A table whose authored top is already in the bottom margin.
// - Multi-column sections, and `w:doNotBreakWrappedTables`.
// Further differences: following text resumes below the last row even beside a narrow table,
// and `inside`/`outside` alignment resolve as top/bottom.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { TableFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type { SemanticTableStructure, TableAnchorFrames } from './semantic-table.ts';
import { tableFloatOriginY, type TableVerticalAnchorFrames } from './table-float-position.ts';
import { positionedTableOriginX } from './table-origin.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import type { TableFlowCursor } from './table-flow-cursor.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

const EPSILON = 0.001;

/** Where the body stands when it reaches a positioned table, in page-content points. */
export interface PinnedTableFlow {
  /** The body cursor. */
  readonly top: number;
  /** Bottom of the page content box. */
  readonly bottom: number;
  readonly frames: TableAnchorFrames;
  readonly verticalFrames: TableVerticalAnchorFrames;
  /** The width the table structure was read against. */
  readonly width: number;
}

/** Where a breaking positioned table's first fragment opens and how far it may reach. */
export interface PinnedTableBreak {
  readonly top: number;
  /** Bottom of the band the first fragment may fill, in page-content points. */
  readonly firstBottom: number;
}

const probes = new WeakMap<
  TableFlowDeps,
  WeakMap<OoxmlElement, Map<number, TableFragmentRecord>>
>();

/** The table laid out whole from 0, without breaks. Memoized per body pass. */
function probeTable(
  table: OoxmlElement,
  structure: SemanticTableStructure,
  width: number,
  deps: TableFlowDeps
): TableFragmentRecord {
  let tables = probes.get(deps);
  if (!tables) probes.set(deps, (tables = new WeakMap()));
  let widths = tables.get(table);
  if (!widths) tables.set(table, (widths = new Map()));
  const cached = widths.get(width);
  if (cached) return cached;
  let line = 0;
  const { fragment } = layoutTableFragment(structure, 0, 0, 0, table.id, 0, {
    ...stripAnchorSinksForProbe(deps),
    onCellBreakKey: undefined,
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    nextLineId: () => `pinned-table-probe-${line++}`,
  });
  widths.set(width, fragment);
  return fragment;
}

/** Bottoms of every line in a row's cells, nested tables included, in probe coordinates. */
function lineBottoms(row: TableRowFragmentRecord, out: number[]): number[] {
  for (const cell of row.cells) {
    for (const block of cell.blocks) {
      if (block.kind === 'table') {
        for (const nested of block.rows) lineBottoms(nested, out);
        continue;
      }
      for (const line of block.lines) out.push(line.box.y + line.box.height);
    }
  }
  return out;
}

/**
 * Height of the leading part of a probed table that fits `room`: the whole rows that fit, or
 * the lines of the first row that fit when it does not fit whole. A split row keeps the space
 * its cells leave below their last line. Every box of the probe shares one frame, with the
 * table top at 0.
 */
export function leadingPartHeight(fragment: TableFragmentRecord, room: number): number {
  let whole = 0;
  for (const row of fragment.rows) {
    const bottom = row.box.y + row.box.height;
    if (bottom > room + EPSILON) break;
    whole = bottom;
  }
  if (whole > 0) return whole;
  const first = fragment.rows[0];
  if (!first) return 0;
  const bottoms = lineBottoms(first, []);
  const lastLine = bottoms.reduce((max, bottom) => Math.max(max, bottom), first.box.y);
  const below = first.box.y + first.box.height - lastLine;
  let fit = 0;
  for (const bottom of bottoms) {
    if (bottom + below <= room + EPSILON) fit = Math.max(fit, bottom + below);
  }
  return fit;
}

/**
 * Where a page- or margin-positioned table that breaks across pages opens, or `undefined`
 * when the table keeps its sheet position. See the module comment.
 */
export function pinnedTableBreak(
  table: OoxmlElement,
  structure: SemanticTableStructure,
  deps: TableFlowDeps,
  flow: PinnedTableFlow
): PinnedTableBreak | undefined {
  const float = structure.float;
  if (
    !float ||
    float.vertAnchor === 'text' ||
    float.ySpec === 'inline' ||
    // One column spans the margins; a narrower text frame is one of several columns.
    flow.frames.text.width < flow.frames.margin.width - 0.5 ||
    deps.styleCascade?.doNotBreakWrappedTables ||
    structure.rows.length === 0 ||
    structure.rows.every((row) => row.height.rule === 'exact')
  )
    return undefined;
  const distances = float.distances ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const left = positionedTableOriginX(structure, flow.frames, deps.compatibilityMode);
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const column = flow.frames.text;
  if (
    left + width + distances.right <= column.left + EPSILON ||
    left - distances.left >= column.left + column.width - EPSILON
  )
    return undefined;
  const probe = probeTable(table, structure, flow.width, deps);
  const height = probe.box.height;
  const authored = tableFloatOriginY(float, height, flow.verticalFrames);
  if (authored >= flow.bottom - EPSILON || authored + height <= flow.bottom + EPSILON)
    return undefined;
  const leading = leadingPartHeight(probe, flow.bottom - flow.top);
  const pageEdge = flow.verticalFrames.page.top + flow.verticalFrames.page.height;
  const top = Math.min(tableFloatOriginY(float, leading, flow.verticalFrames), pageEdge - leading);
  const reach = top + flow.bottom - flow.top;
  return {
    top,
    firstBottom: Math.min(
      hasCompatibilityRule(deps.compatibilityMode, 'positionedTableBreaksAtMargin')
        ? flow.bottom
        : pageEdge,
      reach
    ),
  };
}

/**
 * {@link pinnedTableBreak} for the paginator's cursor, after moving to the next page when the
 * start would cover body content already above the cursor.
 */
export function pinnedBreakAtCursor(
  table: OoxmlElement,
  structure: SemanticTableStructure,
  flow: TableFlowCursor
): PinnedTableBreak | undefined {
  const at = (): PinnedTableFlow => ({
    top: flow.cursorY,
    bottom: flow.contentHeight(),
    frames: flow.anchorFrames(),
    verticalFrames: flow.verticalAnchorFrames(),
    width: flow.columnWidth(),
  });
  const placed = pinnedTableBreak(table, structure, flow.deps, at());
  if (!placed || placed.top >= flow.cursorY - EPSILON || !flow.pageHoldsContent(flow.cursorY))
    return placed;
  flow.advancePage();
  return pinnedTableBreak(table, structure, flow.deps, at());
}

/** The structure a breaking positioned table paginates with: its rows may all split. */
export function withSplittableRows(structure: SemanticTableStructure): SemanticTableStructure {
  if (!structure.rows.some((row) => row.cantSplit)) return structure;
  return {
    ...structure,
    rows: structure.rows.map((row) => (row.cantSplit ? { ...row, cantSplit: false } : row)),
  };
}
