// A pure placement recipe for an already validated, complete single-line cell.
// It holds source tokens and one baseline cell, never a previous recipe or live layout sinks.
import { ordinaryCellLineEligible, placeOrdinaryCellLine } from './ordinary-cell-line.ts';
import { cellWidthAfterIndents } from './cell-paragraph-inputs.ts';
import { cellFlowBox } from './table-cell-text-direction.ts';
import { sumCols } from './table-cell-spacing.ts';
import { MIN_CELL_BOX_PT } from './semantic-table-layout.ts';
import { lineAlignOffset, lineAlignmentMeasure, type Alignment } from './paragraph-alignment.ts';
import { lineContentX, type PendingLine } from './pending-line.ts';
import { lineTiedToPlacement, LINE_HOLD_TOLERANCE_PT } from './paragraph-cache-width-reuse.ts';
import type { CellWidthConstraint } from './table-width-fit-envelope.ts';
import type { TableCellFragmentRecord } from './semantic-records.ts';

export interface CellWidthPlacement {
  readonly breakKey: string;
  readonly baseline: TableCellFragmentRecord;
  readonly pending: PendingLine;
  readonly constraint: CellWidthConstraint;
  readonly firstLineOffset: number;
  readonly alignment: Alignment;
}

/** The caller has already checked source identity, break inputs, and the original placement. */
export function captureCellWidthPlacement(
  baseline: TableCellFragmentRecord,
  pending: PendingLine,
  constraint: CellWidthConstraint,
  firstLineOffset: number,
  alignment: Alignment,
  breakKey = ''
): CellWidthPlacement | null {
  const block = baseline.blocks[0];
  if (
    baseline.blocks.length !== 1 ||
    block?.kind !== 'paragraph' ||
    block.lines.length !== 1 ||
    baseline.rowSpan !== 1 ||
    baseline.vMergeContinue ||
    baseline.paintInert ||
    !Number.isFinite(firstLineOffset) ||
    pending.spans.some((span) => span.fieldAtom || span.noteNav || span.noteSeparator) ||
    (pending.spans.length
      ? alignment === 'both' || !ordinaryCellLineEligible(pending)
      : lineTiedToPlacement(pending))
  )
    return null;
  return {
    breakKey,
    baseline,
    pending,
    firstLineOffset,
    alignment,
    constraint: {
      gridColumn: constraint.gridColumn,
      gridSpan: constraint.gridSpan,
      insetLeft: constraint.insetLeft,
      insetRight: constraint.insetRight,
      indentLeft: constraint.indentLeft,
      indentRight: constraint.indentRight,
    },
  };
}

/** Rebuild exact horizontal coordinates without a measurer, document, or publication callback. */
export function placeCellFromWidthRecipe(
  recipe: CellWidthPlacement,
  columns: readonly number[],
  left: number
): TableCellFragmentRecord | null {
  const { baseline, pending, constraint: c } = recipe;
  const block = baseline.blocks[0]!;
  if (block.kind !== 'paragraph') return null;
  const old = block.lines[0]!;
  if (
    !Number.isFinite(left) ||
    !Number.isInteger(c.gridColumn) ||
    !Number.isInteger(c.gridSpan) ||
    c.gridColumn < 0 ||
    c.gridSpan < 1 ||
    c.gridColumn + c.gridSpan > columns.length ||
    !columns.every((value) => Number.isFinite(value) && value >= 0)
  )
    return null;
  const x = left + sumCols(columns, 0, c.gridColumn);
  const width = Math.max(
    sumCols(columns, c.gridColumn, c.gridColumn + c.gridSpan) ||
      sumCols(columns, 0, columns.length),
    MIN_CELL_BOX_PT
  );
  const flow = cellFlowBox(false, x, width, 0, Infinity, {
    left: c.insetLeft,
    right: c.insetRight,
    top: 0,
    bottom: 0,
  });
  const available = cellWidthAfterIndents(
    Math.max(1, flow.flowRight - flow.flowLeft),
    c.indentLeft,
    c.indentRight
  );
  if (
    !(
      pending.width + Math.max(0, pending.firstLineOffset ?? 0) <=
      available + LINE_HOLD_TOLERANCE_PT
    )
  )
    return null;
  const lineIndent = flow.flowLeft + c.indentLeft + recipe.firstLineOffset;
  const lineWidth = Math.max(1, available - recipe.firstLineOffset);
  const ordinary = pending.spans.length
    ? placeOrdinaryCellLine(
        pending,
        block.paragraphId,
        flow.flowLeft,
        old.box.y,
        lineIndent,
        lineWidth,
        recipe.alignment
      )
    : null;
  if (pending.spans.length && !ordinary) return null;
  const spans = ordinary?.spans ?? [];
  const measure = ordinary
    ? null
    : lineAlignmentMeasure(pending, flow.flowLeft, lineIndent, lineWidth);
  const offset =
    ordinary?.offset ??
    lineAlignOffset([], [], recipe.alignment, measure!.available, measure!.used);
  const line = {
    ...old,
    spans,
    contentX: lineContentX(spans, [], lineIndent + offset),
    box: { ...old.box, x: flow.flowLeft + c.indentLeft, width: available },
  };
  const moved = {
    ...block,
    lines: [line],
    box: { ...block.box, x: flow.flowLeft + c.indentLeft, width: available },
  };
  return { ...baseline, blocks: [moved], box: { ...baseline.box, x, width } };
}
