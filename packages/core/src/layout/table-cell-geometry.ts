// Cell-box geometry shared by row layout and fragment finalize: where a cell's content box
// sits inside its border box, and which rules a mid-row page cut suppresses.

import { borderExtentPt, type CellBorderBox } from './table-borders.ts';
import type { BlockFragmentRecord } from './semantic-records.ts';
import type { CellMarginsPt, SemanticTableCell, SemanticTableRow } from './semantic-table.ts';

/** Per-side content inset: authored margins plus the extent of the rule on that side. */
export interface CellContentInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export function contentInsets(
  margins: CellMarginsPt,
  borders: SemanticTableCell['borders']
): CellContentInsets {
  // Border extents shrink the content box (border-box model) so thick rules do not cover text.
  return {
    top: margins.top + borderExtentPt(borders.top),
    right: margins.right + borderExtentPt(borders.right),
    bottom: margins.bottom + borderExtentPt(borders.bottom),
    left: margins.left + borderExtentPt(borders.left),
  };
}

function suppressSplitBorders(
  borders: CellBorderBox,
  omitTop: boolean,
  omitBottom: boolean
): CellBorderBox {
  return {
    top: omitTop ? { state: 'none' } : borders.top,
    left: borders.left,
    bottom: omitBottom ? { state: 'none' } : borders.bottom,
    right: borders.right,
  };
}

/** Clone a structure row with top/bottom borders suppressed for mid-row page cuts. */
export function rowWithSplitBorders(
  row: SemanticTableRow,
  omitTop: boolean,
  omitBottom: boolean
): SemanticTableRow {
  if (!omitTop && !omitBottom) return row;
  return {
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      borders: suppressSplitBorders(cell.borders, omitTop, omitBottom),
    })),
  };
}

/**
 * Drop what a cell's blocks put below `bottomPt`, whole lines at a time.
 *
 * The merged head of a vertical span flows against the PAGE, because its span's real extent
 * is not known until every row of the span has been placed. Where the placer then has to cut
 * the span short — a `w:cantSplit` covered row that will not fit, or a fragment that placed
 * nothing and must recover — the box the span actually made can end above content the head
 * already flowed. This is the last word on "content stays inside its box": it is applied to
 * measured geometry, so it cannot be wrong about where the box is.
 *
 * Returns the same array when nothing crosses the line, which is every ordinary placement.
 */
export function blocksClippedTo(
  blocks: readonly BlockFragmentRecord[],
  bottomPt: number
): readonly BlockFragmentRecord[] {
  if (!blocks.some((block) => block.box.y + block.box.height > bottomPt + 0.001)) return blocks;
  const kept: BlockFragmentRecord[] = [];
  for (const block of blocks) {
    if (block.box.y >= bottomPt - 0.001) continue;
    if (block.box.y + block.box.height <= bottomPt + 0.001) {
      kept.push(block);
      continue;
    }
    // A nested table cannot be cut here without re-laying it out, so it goes whole or not
    // at all; a paragraph keeps the lines that fit.
    if (block.kind !== 'paragraph') continue;
    const lines = block.lines.filter((line) => line.box.y + line.box.height <= bottomPt + 0.001);
    if (lines.length === 0) continue;
    const last = lines[lines.length - 1]!;
    kept.push({
      ...block,
      lines,
      box: { ...block.box, height: Math.max(0, last.box.y + last.box.height - block.box.y) },
    });
  }
  return kept;
}
