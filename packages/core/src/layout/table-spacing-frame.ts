// The borders of a table with `w:tblCellSpacing` (17.4.45): a frame around the whole table
// and a box around every cell, apart from each other.
//
// Measured on reference renderings, for spacing `s`, outer border widths `bw` and inside
// border widths `cb`:
// - The table's outer borders (`w:top`, `w:left`, `w:bottom`, `w:right`) draw one frame
//   around the table, gaps included. The left rule runs inward from the table's left edge
//   and the right rule outward from its right edge, as in a table without spacing.
// - No cell takes an outer border. Every cell draws all four sides itself, from its own
//   `w:tcBorders` or else `w:insideH` (top, bottom) and `w:insideV` (left, right).
// - The outer cells sit `2s + 1.5 × bw - cb` in from the table's left edge and
//   `2s + 0.5 × bw - cb` in from its right edge, and `2s + 2 × bw - cb` below its top and
//   above its bottom. Neighbouring cell boxes stay `2s` apart; a cell's border lies inside
//   its box, so a row grows by its cells' top and bottom borders.
//
// The insets use the table-level inside borders. A cell whose own `w:tcBorders` differ from
// them takes its own box at the same place.

import {
  borderExtentPt,
  publishFromIntervals,
  type CellBorderBox,
  type RawInterval,
  type ResolvedCellBorders,
  type TableBorderBox,
  type TableBorderSide,
  type TableBorderSideName,
} from './table-borders.ts';
import { cellSpacingGapPt } from './table-cell-spacing.ts';
import type { TableFragmentRecord, TableSpacingFrame } from './semantic-records.ts';
import { shareRowFacts } from './table-row-facts.ts';
import type { SemanticTableRow } from './semantic-table.ts';

/**
 * Each row of a spaced table with its frame insets. Rows share one record per position, so
 * most tables carry three. Returns `rows` unchanged with no spacing.
 */
export function withSpacingFrame(
  rows: readonly SemanticTableRow[],
  borders: TableBorderBox,
  cellSpacingPt: number
): readonly SemanticTableRow[] {
  const gap = cellSpacingGapPt(cellSpacingPt);
  if (gap === 0 || rows.length === 0) return rows;
  const outer = (side: 'top' | 'left' | 'bottom' | 'right') => borderExtentPt(borders[side]);
  const insideH = borderExtentPt(borders.insideH);
  const insideV = borderExtentPt(borders.insideV);
  // The total gap at an edge never goes below zero.
  const inset = (extra: number) => Math.max(-gap, extra);
  const leftPt = inset(1.5 * outer('left') - insideV);
  const rightPt = inset(0.5 * outer('right') - insideV);
  const topPt = inset(2 * outer('top') - insideH);
  const bottomPt = inset(2 * outer('bottom') - insideH);
  const { top, left, bottom, right } = borders;
  const middle: TableSpacingFrame = {
    leftPt,
    rightPt,
    topPt: 0,
    bottomPt: 0,
    borders: { top, left, bottom, right },
  };
  const first: TableSpacingFrame = { ...middle, topPt };
  const last: TableSpacingFrame = { ...middle, bottomPt };
  const only: TableSpacingFrame = { ...first, bottomPt };
  const end = rows.length - 1;
  return rows.map((row, index) => {
    const spacingFrame =
      index === 0 ? (index === end ? only : first) : index === end ? last : middle;
    // The copy keeps the row's memoized facts: none of them reads the frame.
    return shareRowFacts(row, { ...row, spacingFrame });
  });
}

/** A separated cell's border box, drawn whole inside its `width` × `height` box. */
export function separatedCellBorders(
  sides: Pick<CellBorderBox, 'top' | 'left' | 'bottom' | 'right'>,
  width: number,
  height: number
): ResolvedCellBorders {
  return publishSeparatedBox(sides, width, height, true);
}

/**
 * The strokes of the frame a spaced table draws around `fragment`, in the fragment box's own
 * coordinates, or undefined when it has no outer border. The left and top rules run inward
 * from the box, the bottom rule inward from its foot, and the right rule outward. @internal
 */
export function spacedTableFrameBorders(
  fragment: Pick<TableFragmentRecord, 'rows' | 'box'>
): ResolvedCellBorders | undefined {
  const frame = fragment.rows[0]?.spacingFrame;
  if (!frame) return undefined;
  const framed = publishSeparatedBox(frame.borders, fragment.box.width, fragment.box.height);
  return framed.strokes ? framed : undefined;
}

/**
 * Strokes for a box that draws each of its four sides whole, inside a `width` × `height`
 * box: a separated cell of a spaced table, or a spaced table's frame. No conflict, no grid.
 * Each side's rules, compound ones included, lie inside the box against their edge. The
 * right side runs outward from the box's right edge instead, as every vertical rule of a
 * collapsed table does, unless `rightInside`, as in a separated cell.
 */
function publishSeparatedBox(
  sides: Pick<CellBorderBox, TableBorderSideName>,
  width: number,
  height: number,
  rightInside = false
): ResolvedCellBorders {
  const whole = (side: TableBorderSide): RawInterval[] =>
    side.state === 'edge' ? [{ gridStart: 0, gridEnd: 1, edge: side }] : [];
  const box = publishFromIntervals(
    whole(sides.top),
    whole(sides.left),
    whole(sides.bottom),
    whole(sides.right),
    width,
    height,
    [width],
    0,
    [0, height],
    0,
    false,
    false,
    false,
    true
  );
  if (!box.strokes) return box;
  // The collapsed geometry centres compound rules on the grid line; a separated box holds
  // each side's band against its own edge.
  const shift = { top: 0, left: 0, bottom: 0, right: 0 };
  for (const name of ['top', 'left', 'bottom', 'right'] as const) {
    const horizontal = name === 'top' || name === 'bottom';
    let start = Infinity;
    let end = -Infinity;
    for (const stroke of box.strokes) {
      if (stroke.side !== name) continue;
      const from = horizontal ? stroke.y : stroke.x;
      start = Math.min(start, from);
      end = Math.max(end, from + (horizontal ? stroke.height : stroke.width));
    }
    if (start === Infinity) continue;
    shift[name] =
      name === 'top' || name === 'left'
        ? -start
        : name === 'bottom'
          ? height - end
          : rightInside
            ? width - end
            : width - start;
  }
  // Horizontal rules run between the vertical ones, and vertical rules between the
  // horizontal ones: each follows the bands it meets at its ends.
  const strokes = box.strokes.map((stroke) =>
    stroke.side === 'top' || stroke.side === 'bottom'
      ? {
          ...stroke,
          x: stroke.x + shift.left,
          y: stroke.y + shift[stroke.side],
          width: stroke.width + shift.right - shift.left,
        }
      : {
          ...stroke,
          x: stroke.x + shift[stroke.side],
          y: stroke.y + shift.top,
          height: stroke.height + shift.bottom - shift.top,
        }
  );
  return { ...box, strokes };
}
