// Measure a terminal row before admitting it or changing a completed page fragment.
import { canProbeBorderRows, hasTableMerge } from './table-border-probe.ts';
import { lastRowContentDeps } from './table-fragment-content-insets.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import { readOnlyBreakCache } from './paragraph-cache-peek.ts';
import { layoutRowFragment, type TableFlowDeps } from './semantic-table-layout.ts';
import { probeRowFragmentProgress } from './table-row-progress-probe.ts';
import {
  MAX_TABLE_COLUMNS,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
import type { TableRowFragmentRecord } from './semantic-records.ts';

export interface TerminalBorderPlan {
  readonly height: number;
  readonly deps: TableFlowDeps;
  readonly probe: TableRowFragmentRecord;
}

export function prepareTerminalBorderPlan(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  left: number,
  top: number,
  bottom: number,
  deps: TableFlowDeps
): TerminalBorderPlan | undefined {
  const measured = measureTerminalRow(structure, row, left, top, bottom, deps);
  return measured && !measured.overflows ? measured.plan : undefined;
}

/** Where a row is being placed: its table, the row, the table's left edge, its top, the bottom. */
export interface TerminalRowAt {
  readonly structure: SemanticTableStructure;
  readonly row: SemanticTableRow;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly deps: TableFlowDeps;
}

/** {@link prepareTerminalBorderPlan} for a placement held as one value. */
export function terminalBorderPlanAt(at: TerminalRowAt): TerminalBorderPlan | undefined {
  return prepareTerminalBorderPlan(at.structure, at.row, at.left, at.top, at.bottom, at.deps);
}

/**
 * Room below a fitting row in which its closing border is checked. Wider than the widest
 * compound border (thick-thin-thick rules reach about 18pt) and narrower than any row that
 * could follow, so a row with more room never ends the page here.
 */
const CLOSING_EDGE_BAND_PT = 18;

/**
 * The extra room a row that fits at `naturalHeight` needs because it ends its page: a row that
 * ends the page closes it with its own bottom border, which must fit above the bottom too.
 * 0 when that border fits, when the row keeps the edge it already has, or when `next` places
 * at least its opening below it, so the row does not end the page.
 */
export function closingEdgePt(
  at: TerminalRowAt,
  naturalHeight: number,
  next: SemanticTableRow | undefined,
  nextDeps: TableFlowDeps,
  heightOf: (row: SemanticTableRow, top: number) => number
): number {
  const room = at.bottom - at.top - naturalHeight;
  if (room < -0.001 || room > CLOSING_EDGE_BAND_PT) return 0;
  const measured = measureTerminalRow(at.structure, at.row, at.left, at.top, at.bottom, at.deps);
  if (!measured?.overflows) return 0;
  const below = at.top + naturalHeight;
  const follows = rowFollowsBelow(next, at.structure, at.left, below, at.bottom, nextDeps, (row) =>
    heightOf(row, below)
  );
  return follows ? 0 : Math.max(0, measured.plan.height - naturalHeight);
}

function measureTerminalRow(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  left: number,
  top: number,
  bottom: number,
  deps: TableFlowDeps
): { readonly plan: TerminalBorderPlan; readonly overflows: boolean } | undefined {
  if (
    structure.cellSpacingPt > 0 ||
    structure.float ||
    hasTableMerge(structure) ||
    structure.columnWidthsPt.length > MAX_TABLE_COLUMNS ||
    ![left, top, bottom].every(Number.isFinite) ||
    (deps.pageExclusionZones?.().length ?? 0) > 0
  )
    return undefined;
  const terminalDeps = lastRowContentDeps(structure, row, deps);
  if (terminalDeps === deps || !canProbeBorderRows([row], structure.columnWidthsPt.length))
    return undefined;
  let line = 0;
  const probeDeps: TableFlowDeps = {
    ...stripAnchorSinksForProbe(terminalDeps),
    // Reads only: a probe never retains a break, but it may reuse one placement measured.
    cache: readOnlyBreakCache(terminalDeps.cache),
    borderOwnershipBudget: undefined,
    vMergeResolveBudget: undefined,
    onCellBreakKey: undefined,
    nextLineId: () => `probe-terminal-border-${line++}`,
  };
  const placed = layoutRowFragment(row, structure.columnWidthsPt, left, top, false, 0, probeDeps);
  return {
    plan: { height: placed.record.box.height, deps: terminalDeps, probe: placed.record },
    overflows: placed.remainder !== null || placed.bottom > bottom + 0.001,
  };
}

/** Changing vertical clearance must not silently add or remove already committed content. */
export function sameTerminalContent(a: TableRowFragmentRecord, b: TableRowFragmentRecord): boolean {
  if (a.cells.length !== b.cells.length) return false;
  return a.cells.every((cell, index) => {
    const other = b.cells[index]!;
    return (
      cell.blocks.length === other.blocks.length &&
      cell.blocks.every((block, bi) => {
        const next = other.blocks[bi]!;
        return (
          block.kind === 'paragraph' &&
          next.kind === 'paragraph' &&
          block.paragraphId === next.paragraphId &&
          block.lines.length === next.lines.length &&
          block.lines.every(
            (line, li) =>
              line.spans.length === next.lines[li]!.spans.length &&
              line.spans.every((span, si) => span.text === next.lines[li]!.spans[si]!.text)
          )
        );
      })
    );
  });
}

/**
 * Whether `next` places at least its opening below `top`, before `bottom`: whole, or, for a
 * row that may split, its first line in every cell. Then the row above does not end the page.
 */
export function rowFollowsBelow(
  next: SemanticTableRow | undefined,
  structure: SemanticTableStructure,
  left: number,
  top: number,
  bottom: number,
  deps: TableFlowDeps,
  heightOf: (row: SemanticTableRow) => number
): boolean {
  if (!next) return false;
  if (heightOf(next) <= bottom - top + 0.001) return true;
  if (next.cantSplit || next.height.rule === 'exact') return false;
  return probeRowFragmentProgress(
    next,
    structure.columnWidthsPt,
    left,
    top,
    bottom,
    false,
    0,
    deps,
    [],
    structure.cellSpacingPt,
    { requireEveryCell: true }
  );
}
