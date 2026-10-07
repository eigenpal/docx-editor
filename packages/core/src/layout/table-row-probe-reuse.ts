import { ordinaryTableParagraph } from './table-ordinary-paragraph.ts';
import { measuringFlowDeps } from './table-probe-deps.ts';
import {
  layoutRowFragment,
  measureRowHeight,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import type { TableRowFragmentRecord } from './semantic-records.ts';
import { placementFromPrevious, rememberRowPlacement } from './table-row-placement-reuse.ts';

type Placement = ReturnType<typeof layoutRowFragment>;

/** Keep only the latest ordinary row probe until its placement, without retaining prior rows. */
export function createRowProbeReuse(
  cols: readonly number[],
  cellSpacingPt: number,
  /** The previous layout's rows of this table, offered after a refused table update. */
  previous?: ReadonlyMap<string, TableRowFragmentRecord>
) {
  let probe:
    | { row: SemanticTableRow; result: Placement; deps: TableFlowDeps; left: number; top: number }
    | undefined;
  const ordinaryRows = new WeakMap<SemanticTableRow, boolean>();
  const ordinary = (row: SemanticTableRow, deps: TableFlowDeps): boolean => {
    let safe = ordinaryRows.get(row);
    if (safe === undefined) {
      safe =
        !row.isHeader &&
        row.cells.every(
          (cell) =>
            !cell.vMergeContinue &&
            cell.textDirection === 'horizontal' &&
            cell.blocks.every((b) => b.kind === 'paragraph' && ordinaryTableParagraph(b))
        );
      ordinaryRows.set(row, safe);
    }
    return safe && !row.cells.some((c) => c.blocks.some((b) => deps.listItems?.has(b.id)));
  };
  return {
    measure(row: SemanticTableRow, left: number, top: number, deps: TableFlowDeps): number {
      probe = undefined;
      const zones = !!deps.pageExclusionZones?.().length;
      if (zones || !ordinary(row, deps)) {
        return measureRowHeight(
          row,
          cols,
          left,
          0,
          deps,
          cellSpacingPt,
          undefined,
          zones ? top : undefined
        );
      }
      // An unchanged row at its old top: the exact probe result, rebuilt for the new widths.
      const before = cellSpacingPt === 0 ? previous?.get(row.id) : undefined;
      const reused = before ? placementFromPrevious(row, before, cols, left, top, deps) : null;
      // Keep the real origin: translating a zero-origin probe changes floating-point geometry.
      const result =
        reused ??
        layoutRowFragment(
          row,
          cols,
          left,
          top,
          false,
          0,
          measuringFlowDeps(deps, false),
          cellSpacingPt
        );
      if (!reused && cellSpacingPt === 0) rememberRowPlacement(row, result, top, deps);
      if (result.remainder === null) probe = { row, result, deps, left, top };
      return result.record.box.height;
    },
    take(row: SemanticTableRow, left: number, top: number, deps: TableFlowDeps): Placement | null {
      const known = probe;
      probe = undefined;
      if (
        !known ||
        known.row !== row ||
        known.left !== left ||
        known.top !== top ||
        deps.pageExclusionZones?.().length
      )
        return null;
      for (const key of new Set([...Object.keys(deps), ...Object.keys(known.deps)]) as Set<
        keyof TableFlowDeps
      >) {
        if (key === 'pageExclusionZones') continue;
        if (key === 'rowAtPageStart' && !!deps[key] === !!known.deps[key]) continue;
        if (deps[key] !== known.deps[key]) return null;
      }
      // A prior finalized row already carries the same paragraph-local line ids. Keep its
      // records when no id changes; remapping must still call nextLineId for every line.
      let cells: (typeof known.result.record.cells)[number][] | undefined;
      for (let cellIndex = 0; cellIndex < known.result.record.cells.length; cellIndex++) {
        const cell = known.result.record.cells[cellIndex]!;
        let blocks: (typeof cell.blocks)[number][] | undefined;
        for (let blockIndex = 0; blockIndex < cell.blocks.length; blockIndex++) {
          const block = cell.blocks[blockIndex]!;
          if (block.kind !== 'paragraph') throw new Error('Ordinary row probe contains a table');
          let lines: (typeof block.lines)[number][] | undefined;
          for (let index = 0; index < block.lines.length; index++) {
            const line = block.lines[index]!;
            const id = deps.nextLineId(line.range.paragraphId, line.range.start, index);
            if (id !== line.id) (lines ??= block.lines.slice())[index] = { ...line, id };
          }
          if (lines) (blocks ??= cell.blocks.slice())[blockIndex] = { ...block, lines };
        }
        if (blocks) (cells ??= known.result.record.cells.slice())[cellIndex] = { ...cell, blocks };
      }
      return cells ? { ...known.result, record: { ...known.result.record, cells } } : known.result;
    },
  };
}
