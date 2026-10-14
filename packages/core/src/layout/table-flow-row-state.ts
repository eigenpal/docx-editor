import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableRowFragmentRecord } from './semantic-records.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import { prepareTerminalBorderPlan, sameTerminalContent } from './table-terminal-border-plan.ts';

/** Enough vertical room to lay a positioned table as one visual object on its anchor sheet. */
export const POSITIONED_TABLE_LAYOUT_BOTTOM_PT = Number.MAX_SAFE_INTEGER / 1024;

/** A row fragment whose rest continues on the next page: the head of a split row. */
export function splitHead(record: TableRowFragmentRecord): TableRowFragmentRecord {
  return { ...record, hasContinuation: true };
}

/** Price each kept row once, with an optional already measured first row. */
export function cachedRowHeights(
  rows: readonly SemanticTableRow[],
  heightOf: (row: SemanticTableRow) => number,
  first?: [number, number]
): (at: number) => number {
  const heights = new Map<number, number>(first ? [first] : []);
  return (at) => {
    let height = heights.get(at);
    if (height === undefined) heights.set(at, (height = heightOf(rows[at]!)));
    return height;
  };
}

/** Correct only the complete terminal row; a split row keeps its consumed content. */
export function refreshTerminalRow(
  structure: SemanticTableStructure,
  rows: TableRowFragmentRecord[],
  sourceRows: readonly SemanticTableRow[],
  completeSourceRows: ReadonlySet<SemanticTableRow>,
  occurrenceInsets: Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>,
  left: number,
  bottom: number,
  currentDeps: TableFlowDeps
): number | undefined {
  const index = rows.length - 1;
  const record = rows[index]!;
  const source = sourceRows[index]!;
  // A split fragment owns only part of its source row. Re-measuring the whole source
  // would repeat already consumed content, so only complete occurrences take this path.
  if (record.isContinuation || !completeSourceRows.has(source)) return undefined;
  const deps = {
    ...currentDeps,
    cellContentInsets: occurrenceInsets.get(record) ?? currentDeps.cellContentInsets,
  };
  const terminal = prepareTerminalBorderPlan(structure, source, left, record.box.y, bottom, deps);
  if (!terminal || !sameTerminalContent(record, terminal.probe)) return undefined;
  const corrected = {
    ...record,
    box: { ...record.box, height: terminal.height },
    cells: record.cells.map((cell) => ({
      ...cell,
      box: { ...cell.box, height: terminal.height - (cell.box.y - record.box.y) },
    })),
  };
  rows[index] = corrected;
  occurrenceInsets.delete(record);
  if (terminal.deps.cellContentInsets)
    occurrenceInsets.set(corrected, terminal.deps.cellContentInsets);
  return terminal.height - record.box.height;
}
