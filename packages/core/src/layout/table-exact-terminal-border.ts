// Reserve the supported terminal exact row's outer rule outside its authored content box.
import { canProbeBorderRows } from './table-border-probe.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import { cellContentInsets, type CellContentInsets } from './table-cell-geometry.ts';
import { withoutFloatingTableZones } from './table-float-overlap.ts';
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

export function tableTerminalDeps(
  structure: SemanticTableStructure,
  flowDeps: TableFlowDeps,
  floatingDeps: TableFlowDeps | undefined,
  outOfFlow: boolean
): TableFlowDeps {
  const deps = floatingDeps ?? (outOfFlow ? withoutFloatingTableZones(flowDeps) : flowDeps);
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
