import type { SemanticTableRow } from './semantic-table.ts';

const cache = new WeakMap<readonly SemanticTableRow[], { columns: number; value: boolean }>();

/**
 * A complete grid with omitted side rules and one width for every visible simple rule.
 * Its missing frame edges do not define a uniform outer-frame offset, but the remaining
 * rules still share their grid lines with cell margins.
 */
export function hasPartialSimpleSideGrid(
  rows: readonly SemanticTableRow[],
  columns: number
): boolean {
  const known = cache.get(rows);
  if (known?.columns === columns) return known.value;
  const read = () => {
    let width: number | undefined;
    let missing = false;
    for (const row of rows) {
      let next = 0;
      for (const cell of row.cells) {
        if (cell.gridColumn !== next) return false;
        next += cell.gridSpan;
        if (cell.vMergeContinue) continue;
        const borders = cell.contentBorders ?? cell.borders;
        for (const side of [borders.left, borders.right]) {
          if (side.state !== 'edge') {
            missing = true;
            continue;
          }
          if (
            (side.style !== 'single' && side.style !== 'thick') ||
            side.widthPt <= 0 ||
            (width !== undefined && side.widthPt !== width)
          )
            return false;
          width = side.widthPt;
        }
      }
      if (next !== columns) return false;
    }
    return missing && width !== undefined;
  };
  const value = read();
  cache.set(rows, { columns, value });
  return value;
}

/** Carry the answer when a row copy changes only its side-rule layout flags. */
export function carryPartialSimpleSideGrid(
  source: readonly SemanticTableRow[],
  copy: readonly SemanticTableRow[]
): void {
  const known = cache.get(source);
  if (known) cache.set(copy, known);
}
