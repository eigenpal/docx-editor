// Reserve the supported terminal exact row's outer rule outside its authored content box.
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { canProbeBorderRows } from './table-border-probe.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import { cellContentInsets, type CellContentInsets } from './table-cell-geometry.ts';
import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

interface TerminalBorderBudget {
  readonly row: SemanticTableRow;
  readonly widthPt: number;
}

// Resolved structures are immutable. Keep refused shapes cached as well as supported ones.
const budgets = new WeakMap<SemanticTableStructure, TerminalBorderBudget | null>();

// `deps` is the table's resolved flow deps: float-band deps, or the cell deps from the reader.
export function tableTerminalDeps(
  structure: SemanticTableStructure,
  deps: TableFlowDeps
): TableFlowDeps {
  if (deps.tableNestingOffset || deps.textBoxStory) return deps;
  let budget = budgets.get(structure);
  if (budget === undefined) {
    budget = readTerminalBudget(structure);
    budgets.set(structure, budget);
  }
  return budget ? { ...deps, exactTerminalBorder: budget } : deps;
}

function readTerminalBudget(structure: SemanticTableStructure): TerminalBorderBudget | null {
  const row = structure.rows.at(-1);
  if (
    !row ||
    row.height.rule !== 'exact' ||
    !Number.isFinite(row.height.valuePt) ||
    row.height.valuePt <= 0 ||
    structure.cellSpacingPt !== 0 ||
    structure.float
  )
    return null;

  // Merge continuations still have bounded content. Only this eligibility view clears them.
  const probeRows = structure.rows.map((source) =>
    source.cells.some((cell) => cell.vMergeContinue)
      ? {
          ...source,
          cells: source.cells.map((cell) =>
            cell.vMergeContinue ? { ...cell, vMergeContinue: false } : cell
          ),
        }
      : source
  );
  if (!canProbeBorderRows(probeRows, structure.columnWidthsPt.length)) return null;

  // The terminal rule owns this extent. The table's top rule does not constrain it.
  let width: number | undefined;
  for (const cell of row.cells) {
    const edge = effectiveBorderSide(
      cell.borders.bottom,
      (cell.rowTableBorders ?? structure.tableBorders).bottom
    );
    if (
      edge.state !== 'edge' ||
      edge.style !== 'single' ||
      !Number.isFinite(edge.widthPt) ||
      edge.widthPt <= 0 ||
      edge.widthPt > 12
    )
      return null;
    if (width !== undefined && edge.widthPt !== width) return null;
    width = edge.widthPt;
  }
  return width && width > 0 ? { row, widthPt: width } : null;
}

export function exactTerminalBorderPt(row: SemanticTableRow, deps: TableFlowDeps): number {
  return deps.exactTerminalBorder?.row === row ? deps.exactTerminalBorder.widthPt : 0;
}

/** `heightOf` plus the terminal rule, for pricing rows that must also hold the rule. */
export function withRule(
  heightOf: (row: SemanticTableRow) => number,
  tableDeps: TableFlowDeps
): (row: SemanticTableRow) => number {
  return (row) => heightOf(row) + exactTerminalBorderPt(row, tableDeps);
}

// The room the terminal rule needs when deciding whether the row starts here. A row that does
// not fit with its rule moves to the next page. At a page start (or below repeated headers
// only, which mode 15 omits first: `repeatYieldsToTerminalRule`) moving cannot help, so the
// row stays and its rule crosses the bottom margin. Only the table's terminal row can need
// room, so other rows never build their row deps here.
export function ruleRoomPt(
  row: SemanticTableRow,
  tableDeps: TableFlowDeps,
  rowDeps: () => TableFlowDeps
): number {
  if (exactTerminalBorderPt(row, tableDeps) === 0) return 0;
  const deps = rowDeps();
  return deps.rowAtPageStart ? 0 : exactTerminalBorderPt(row, deps);
}

/**
 * Whether a repeated header group yields to the table's terminal exact row on a continuation
 * page: the row, placed at `bodyTop` below the group, would end past `bottom` with its rule.
 * Equality fits. Mode 15 and later omit the repeat, so the row starts the page; earlier modes
 * keep the repeat and the rule crosses the bottom margin (see `ruleRoomPt`). The omission
 * applies even when the rule also crosses the margin without the repeat.
 */
export function repeatYieldsToTerminalRule(
  row: SemanticTableRow,
  bodyTop: number,
  bottom: number,
  deps: TableFlowDeps
): boolean {
  const rule = exactTerminalBorderPt(row, deps);
  return (
    rule > 0 &&
    row.height.rule === 'exact' &&
    hasCompatibilityRule(deps.compatibilityMode, 'repeatedHeaderYieldsToTerminalRule') &&
    bodyTop + row.height.valuePt + rule > bottom + 0.001
  );
}

export function endRowInsets(
  cell: SemanticTableCell,
  deps: TableFlowDeps,
  terminalBorderPt: number,
  rowTop: number,
  maxBottom: number,
  cellSpacingPt: number
): CellContentInsets {
  const insets =
    deps.cellContentInsets?.get(cell.id) ?? cellContentInsets(cell, cellSpacingPt === 0);
  const height = deps.exactTerminalBorder?.row.height;
  // The caller already checks row identity, repetition, continuation, depth, and spacing.
  const applies =
    terminalBorderPt > 0 &&
    height?.rule === 'exact' &&
    rowTop + height.valuePt <= maxBottom + 0.001;
  // The closing stroke sits below the authored box, outside its bottom margin.
  return applies ? { ...insets, bottom: cell.margins.bottom } : insets;
}
