// Measure a terminal row before admitting it or changing a completed page fragment.
import { canProbeBorderRows, hasTableMerge } from './table-border-probe.ts';
import { lastRowContentDeps } from './table-fragment-content-insets.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import { layoutRowFragment, type TableFlowDeps } from './semantic-table-layout.ts';
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
    cache: undefined,
    borderOwnershipBudget: undefined,
    vMergeResolveBudget: undefined,
    onCellBreakKey: undefined,
    nextLineId: () => `probe-terminal-border-${line++}`,
  };
  const placed = layoutRowFragment(row, structure.columnWidthsPt, left, top, false, 0, probeDeps);
  if (placed.remainder !== null || placed.bottom > bottom + 0.001) return undefined;
  return { height: placed.record.box.height, deps: terminalDeps, probe: placed.record };
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
