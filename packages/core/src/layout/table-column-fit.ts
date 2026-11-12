// How a table's columns give way when their cells must fit a smaller total than they ask:
// for a stated table width, or for the spacing gaps a spaced table takes from its width.
import type { SemanticTableRow } from './semantic-table.ts';
import type { TableBorderBox } from './table-borders.ts';
import { spacingGapsPt } from './table-cell-spacing.ts';
import { withSpacingFrame } from './table-spacing-frame.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

const EPSILON_PT = 0.001;

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Widths that total `targetPt`. A wider total grows every column in proportion to its width.
 * A narrower one takes from each column in proportion to its width above its minimum, so a
 * column at its minimum keeps it. Past every minimum, the minimums scale down together.
 *
 * Measured with fixed layout in modes 11, 14 and 15, spaced and not: the minimum is a column's
 * left and right cell margins. 1000/3000 twips with 108-twip margins under a 3000-twip width
 * lay out as 39.0/111.0pt, not 37.5/112.5; with 300-twip margins as 42.9/107.1pt; and the
 * gaps of a spaced table come out the same way. Under 6000 twips the same columns grow to
 * 75/225pt. An autofit table measures each column's minimum from its content instead.
 * `proportionalPt` of the shrink, a spaced table's frame, comes out in proportion to width
 * first: equal 120pt cells under 6pt outer rules stay equal whatever their content.
 */
export function fitColumnsAboveMinimums(
  widths: readonly number[],
  targetPt: number,
  minimums: readonly number[],
  proportionalPt = 0
): readonly number[] {
  let total = sum(widths);
  if (!(total > 0) || !(targetPt > 0) || Math.abs(total - targetPt) <= EPSILON_PT) return widths;
  if (targetPt > total) return widths.map((width) => (width * targetPt) / total);
  if (proportionalPt > 0) {
    const scale = (total - Math.min(proportionalPt, total - targetPt)) / total;
    widths = widths.map((width) => width * scale);
    total *= scale;
    if (total - targetPt <= EPSILON_PT) return widths;
  }
  const floors = widths.map((width, column) => Math.min(width, Math.max(0, minimums[column] ?? 0)));
  const slack = total - sum(floors);
  const need = total - targetPt;
  if (need < slack - EPSILON_PT)
    return widths.map((width, column) => width - (need * (width - floors[column]!)) / slack);
  const floorTotal = sum(floors);
  return floorTotal > 0
    ? floors.map((floor) => (floor * targetPt) / floorTotal)
    : widths.map((width) => (width * targetPt) / total);
}

/** Each column's fixed-layout minimum: the widest left and right margins of a cell in it. */
export function cellMarginMinimumsPt(
  rows: readonly SemanticTableRow[],
  columnCount: number
): readonly number[] {
  const minimums = new Array<number>(columnCount).fill(0);
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.gridSpan !== 1 || cell.gridColumn >= columnCount) continue;
      const margins = cell.margins.left + cell.margins.right;
      if (margins > minimums[cell.gridColumn]!) minimums[cell.gridColumn] = margins;
    }
  }
  return minimums;
}

/** What a spaced table's gaps take from its width, and how much of that is its frame. */
export interface SpacingTake {
  readonly gapsPt: number;
  readonly framePt: number;
}

/** The width a spaced table's gaps and frame take, before its columns are resolved. */
export function spacingGapsBeforeColumns(
  rows: readonly SemanticTableRow[],
  borders: TableBorderBox,
  cellSpacingPt: number,
  columnCount: number
): SpacingTake {
  if (!(cellSpacingPt > 0) || columnCount < 1) return { gapsPt: 0, framePt: 0 };
  const framed = withSpacingFrame(rows.slice(0, 1), borders, cellSpacingPt);
  const gapsPt = spacingGapsPt({
    columnWidthsPt: new Array<number>(columnCount).fill(0),
    cellSpacingPt,
    rows: framed,
  });
  return { gapsPt, framePt: spacingFramePt(framed[0]?.spacingFrame) };
}

/** The part of a spaced table's gaps its frame adds: its left and right insets, if wider. */
export function spacingFramePt(
  frame: { readonly leftPt: number; readonly rightPt: number } | undefined
): number {
  return frame ? Math.max(0, frame.leftPt + frame.rightPt) : 0;
}

/**
 * The cell widths of an autofit table whose content already fits, when its cells' stated
 * widths had to give way to a narrower total: each column gives way above its content
 * minimum (`fitColumnsAboveMinimums`). Undefined when a column states no absolute width,
 * nothing gave way, or a column cannot keep its minimum. Measured in modes 11, 14 and 15: 50/100/50pt cells in a 200pt spaced
 * table lay out near 45/69/45pt, not in proportion to their widths.
 */
export function autofitCellsAboveMinimums(
  preferredWidths: readonly (number | undefined)[],
  cellWidths: readonly number[],
  minimums: readonly number[],
  framePt = 0,
  spans: readonly { readonly from: number; readonly count: number; readonly minimum: number }[] = []
): readonly number[] | undefined {
  if (preferredWidths.length !== cellWidths.length) return undefined;
  const preferred: number[] = [];
  for (const width of preferredWidths) {
    if (width === undefined || !(width > 0)) return undefined;
    preferred.push(width);
  }
  const target = sum(cellWidths);
  if (sum(preferred) <= target + EPSILON_PT) return undefined;
  const cells = fitColumnsAboveMinimums(preferred, target, minimums, framePt);
  // Content wider than its column, or minimums past the total, widen in their own way.
  if (!cells.every((width, column) => width + EPSILON_PT >= (minimums[column] ?? 0)))
    return undefined;
  for (const span of spans) {
    let held = 0;
    for (let column = span.from; column < span.from + span.count; column++)
      held += cells[column] ?? 0;
    if (held + EPSILON_PT < span.minimum) return undefined;
  }
  return cells;
}

/** Columns in display order: reversed for a visually right-to-left table. */
export function visualOrder(widths: readonly number[], reversed: boolean): readonly number[] {
  return reversed ? [...widths].reverse() : widths;
}

/**
 * The refit of an autofit table's stated cell widths above its content minimums
 * (`autofitCellsAboveMinimums`), from the widths its cells and spans state. Measured at the
 * top level and in headers, spaced or not, and nested in mode 15: 3000/3000 twips under a
 * 4000-twip width with one long word lay out as 126.5/73.5pt, not 100/100. Undefined for a
 * nested legacy table, which keeps its cell's room (measured in mode 0).
 */
export function autofitRefit(
  structure: {
    readonly statedColumnWidthsPt?: readonly number[];
    readonly rows?: readonly { readonly spacingFrame?: SpacedTableFrameInsets }[];
  },
  content: {
    readonly preferredWidths: readonly (number | undefined)[];
    readonly spans: readonly {
      readonly from: number;
      readonly count: number;
      readonly minimum: number;
    }[];
  },
  cellWidths: readonly number[],
  minimums: readonly number[],
  nested: { readonly depth: number; readonly compatibilityMode?: number }
): readonly number[] | undefined {
  if (
    nested.depth > 0 &&
    !hasCompatibilityRule(nested.compatibilityMode, 'autofitRefitsNestedCells')
  )
    return undefined;
  const stated = structure.statedColumnWidthsPt;
  // A column no cell states keeps blocking the refit; stated columns take any span's excess.
  const preferred =
    stated && stated.length === content.preferredWidths.length
      ? content.preferredWidths.map((width, column) =>
          width === undefined ? undefined : stated[column]
        )
      : content.preferredWidths;
  return autofitCellsAboveMinimums(
    preferred,
    cellWidths,
    minimums,
    spacingFramePt(structure.rows?.[0]?.spacingFrame),
    content.spans
  );
}

/**
 * The stated cell widths to widen from instead, when a stated table width stretched them and
 * the widened columns still pass that width: columns the content does not widen keep what
 * their cells state. Measured in mode 15 past the text column: 11158 twips of cells under an
 * 11263-twip width whose content widens it to 639pt keep their stated widths.
 */
export function unstretchedBase(
  structure: { readonly statedColumnWidthsPt?: readonly number[] },
  cellWidths: readonly number[],
  widened: readonly number[],
  targetPt: number
): readonly number[] | undefined {
  const stated = structure.statedColumnWidthsPt;
  if (!stated || stated.length !== cellWidths.length) return undefined;
  const statedPt = sum(stated);
  return statedPt < sum(cellWidths) - EPSILON_PT && sum(widened) > targetPt + EPSILON_PT
    ? stated
    : undefined;
}

/**
 * A stated table width that stretches stated cell widths stretches each column from the larger
 * of its stated width and its content minimum. Measured in modes 14 and 15: a 942-twip column
 * whose word needs 55.3pt takes 55.3pt times the stretch, not its own minimum. Undefined when
 * no column needs more than its stated width or the minimums pass the stretched width.
 */
export function stretchAboveMinimums(
  stated: readonly number[] | undefined,
  cellWidths: readonly number[],
  minimums: readonly number[]
): readonly number[] | undefined {
  if (!stated || stated.length !== cellWidths.length) return undefined;
  const targetPt = sum(cellWidths);
  const statedPt = sum(stated);
  if (statedPt >= targetPt - EPSILON_PT) return undefined;
  const base = stated.map((width, column) => Math.max(width, minimums[column] ?? 0));
  const basePt = sum(base);
  if (basePt <= statedPt + EPSILON_PT || basePt > targetPt + EPSILON_PT) return undefined;
  return base.map((width) => (width * targetPt) / basePt);
}

/** Minimums where a column only spanning cells cover keeps the given width instead. */
export function keepUnmeasured(
  minimums: readonly number[],
  measured: readonly boolean[],
  widths: readonly number[]
): readonly number[] {
  return minimums.map((minimum, column) =>
    measured[column] ? minimum : (widths[column] ?? minimum)
  );
}

/**
 * Only a column that has to widen itself keeps the first-line indent of a word after spaces
 * that open its paragraph; the other columns of a widening table take that word without it.
 * Measured in mode 15 with an 18pt first-line indent: a 1466-twip column holding
 * "  6,746,091" keeps 73.3pt while another column widens, and a 942-twip column holding it
 * widens to the word plus the indent. `plain` fills the minimums without the indent.
 */
export function keepFirstLineWhereWidening(
  ifWidened: number[],
  minimums: readonly number[],
  cellWidths: readonly number[],
  plain: (into: number[]) => void
): void {
  let own: number[] | undefined;
  for (let column = 0; column < ifWidened.length; column++) {
    if ((minimums[column] ?? 0) > (cellWidths[column] ?? 0) + EPSILON_PT) continue;
    if (!own) plain((own = []));
    ifWidened[column] = Math.min(ifWidened[column]!, own[column] ?? ifWidened[column]!);
  }
}

type SpacedTableFrameInsets = { readonly leftPt: number; readonly rightPt: number };
