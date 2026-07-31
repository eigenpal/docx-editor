// Three-state table/cell borders and Word-like collapsed-edge conflict resolution.
//
// OOXML distinguishes omitted edges (fall through to `tblBorders`), explicit `nil`/`none`
// (suppress), and styled edges. With zero cell spacing the shared grid line picks one
// winner. Layout publishes the final per-cell edges; paint only draws those numbers.

import type { OoxmlElement } from '@docx-editor.dev/core-contract/store';
import { MAX_BORDER_WIDTH_PT } from './paragraph-style.ts';
import { resolveStrictHexFill } from './ooxml-shading.ts';

/** Supported paint styles; unknown authored vals fall back to `single` at resolve time. */
export type TableBorderStyle =
  | 'single'
  | 'dashed'
  | 'dotted'
  | 'double'
  | 'triple'
  | 'thick';

export type TableBorderSide =
  | { readonly state: 'omitted' }
  | { readonly state: 'none' }
  | {
      readonly state: 'edge';
      readonly style: TableBorderStyle;
      /** Validated RRGGBB, or null for auto/missing (paint defaults to black). */
      readonly color: string | null;
      /** Thickness in points (`w:sz` is eighths of a point). */
      readonly widthPt: number;
    };

export interface TableBorderBox {
  readonly top: TableBorderSide;
  readonly left: TableBorderSide;
  readonly bottom: TableBorderSide;
  readonly right: TableBorderSide;
  readonly insideH: TableBorderSide;
  readonly insideV: TableBorderSide;
}

export interface CellBorderBox {
  readonly top: TableBorderSide;
  readonly left: TableBorderSide;
  readonly bottom: TableBorderSide;
  readonly right: TableBorderSide;
}

/** Final paint-ready edge; absent means the side is not drawn. */
export interface ResolvedTableBorderEdge {
  readonly style: TableBorderStyle;
  readonly color: string | null;
  readonly widthPt: number;
}

export interface ResolvedCellBorders {
  readonly top?: ResolvedTableBorderEdge;
  readonly left?: ResolvedTableBorderEdge;
  readonly bottom?: ResolvedTableBorderEdge;
  readonly right?: ResolvedTableBorderEdge;
}

const OMITTED: TableBorderSide = { state: 'omitted' };
const NONE: TableBorderSide = { state: 'none' };

const EMPTY_TABLE_BORDERS: TableBorderBox = {
  top: OMITTED,
  left: OMITTED,
  bottom: OMITTED,
  right: OMITTED,
  insideH: OMITTED,
  insideV: OMITTED,
};

const EMPTY_CELL_BORDERS: CellBorderBox = {
  top: OMITTED,
  left: OMITTED,
  bottom: OMITTED,
  right: OMITTED,
};

/** MS-OE376-ish border numbers for conflict weight. */
const BORDER_NUMBER: Readonly<Record<TableBorderStyle, number>> = {
  single: 1,
  thick: 2,
  double: 3,
  dotted: 4,
  dashed: 5,
  triple: 10,
};

const STYLE_FROM_VAL = new Map<string, TableBorderStyle>([
  ['single', 'single'],
  ['thick', 'thick'],
  ['double', 'double'],
  ['dotted', 'dotted'],
  ['dashed', 'dashed'],
  ['dashSmallGap', 'dashed'],
  ['dotDash', 'dashed'],
  ['dotDotDash', 'dashed'],
  ['triple', 'triple'],
  // Common Word aliases → nearest CSS-representable style.
  ['wave', 'single'],
  ['hairline', 'single'],
  ['inset', 'single'],
  ['outset', 'single'],
]);

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function integer(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

function clampWidthPt(eighths: number | null): number {
  if (eighths === null) return 0.5;
  const pt = eighths / 8;
  if (!Number.isFinite(pt) || pt <= 0) return 0.5;
  return pt > MAX_BORDER_WIDTH_PT ? MAX_BORDER_WIDTH_PT : pt;
}

/** Read one OOXML border child into the three-state model. */
export function readBorderSide(node: OoxmlElement | undefined): TableBorderSide {
  if (!node) return OMITTED;
  const val = attributeValue(node, 'val');
  if (!val) return OMITTED;
  if (val === 'nil' || val === 'none') return NONE;
  const style = STYLE_FROM_VAL.get(val) ?? 'single';
  const colorRaw = attributeValue(node, 'color');
  // Hostile non-hex colors become null (paint defaults to black); style/width still count.
  const color =
    colorRaw === undefined || colorRaw === 'auto' ? null : (resolveStrictHexFill(colorRaw) ?? null);
  return {
    state: 'edge',
    style,
    color,
    widthPt: clampWidthPt(integer(attributeValue(node, 'sz'))),
  };
}

function readBox(
  container: OoxmlElement | undefined,
  sides: readonly (keyof CellBorderBox)[]
): CellBorderBox {
  if (!container) return EMPTY_CELL_BORDERS;
  const result: { top: TableBorderSide; left: TableBorderSide; bottom: TableBorderSide; right: TableBorderSide } = {
    top: OMITTED,
    left: OMITTED,
    bottom: OMITTED,
    right: OMITTED,
  };
  for (const side of sides) {
    result[side] = readBorderSide(childNamed(container, side));
  }
  return result;
}

export function readTableBorders(tblPr: OoxmlElement | undefined): TableBorderBox {
  const container = tblPr && childNamed(tblPr, 'tblBorders');
  if (!container) return EMPTY_TABLE_BORDERS;
  const cell = readBox(container, ['top', 'left', 'bottom', 'right']);
  return {
    ...cell,
    insideH: readBorderSide(childNamed(container, 'insideH')),
    insideV: readBorderSide(childNamed(container, 'insideV')),
  };
}

export function readCellBorders(tcPr: OoxmlElement | undefined): CellBorderBox {
  return readBox(tcPr && childNamed(tcPr, 'tcBorders'), ['top', 'left', 'bottom', 'right']);
}

export function borderWeight(side: TableBorderSide): number {
  if (side.state !== 'edge') return 0;
  // Dotted/dashed family: MS-OE376 forces weight 1 regardless of sz.
  if (side.style === 'dotted' || side.style === 'dashed') return 1;
  const eighths = Math.max(1, Math.round(side.widthPt * 8));
  return eighths * BORDER_NUMBER[side.style];
}

function colorBrightness(color: string | null): number {
  if (!color) return 0; // auto → black → darkest → wins ties toward black
  const r = Number.parseInt(color.slice(0, 2), 16);
  const g = Number.parseInt(color.slice(2, 4), 16);
  const b = Number.parseInt(color.slice(4, 6), 16);
  return r + g + b;
}

/**
 * Pick the winner between two candidates on a shared grid line (zero cell spacing).
 *
 * `none` loses to any edge; two `none`/omitted yield omitted (no paint). Equal weights
 * prefer the darker color, then `preferFirst` (reading-order / first candidate).
 */
export function resolveBorderConflict(
  first: TableBorderSide,
  second: TableBorderSide,
  preferFirst = true
): TableBorderSide {
  if (first.state === 'omitted') return second.state === 'omitted' ? OMITTED : second;
  if (second.state === 'omitted') return first;
  if (first.state === 'none') return second.state === 'none' ? NONE : second;
  if (second.state === 'none') return first;

  const w1 = borderWeight(first);
  const w2 = borderWeight(second);
  if (w1 > w2) return first;
  if (w2 > w1) return second;
  const b1 = colorBrightness(first.color);
  const b2 = colorBrightness(second.color);
  if (b1 < b2) return first;
  if (b2 < b1) return second;
  return preferFirst ? first : second;
}

function asResolved(side: TableBorderSide): ResolvedTableBorderEdge | undefined {
  if (side.state !== 'edge') return undefined;
  return { style: side.style, color: side.color, widthPt: side.widthPt };
}

function tableFallback(
  table: TableBorderBox,
  side: keyof CellBorderBox,
  interior: boolean
): TableBorderSide {
  if (!interior) return table[side];
  if (side === 'top' || side === 'bottom') return table.insideH;
  return table.insideV;
}

/**
 * Effective edge before adjacent-cell / outer conflict.
 *
 * - omitted → table fallback
 * - edge → cell wins outright (no weight fight with table)
 * - none → on outer edges, table may still show; on interior edges, explicit none stays
 *   none so `none`/`none` neighbors suppress the grid line (Word §5.3 mid-vertical).
 */
export function effectiveBorderSide(
  authored: TableBorderSide,
  tableSide: TableBorderSide,
  options: { readonly interior?: boolean } = {}
): TableBorderSide {
  if (authored.state === 'omitted') return tableSide;
  if (authored.state === 'none') {
    return options.interior ? NONE : resolveBorderConflict(NONE, tableSide);
  }
  return authored;
}

export interface BorderGridCell {
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly vMergeContinue: boolean;
  readonly borders: CellBorderBox;
  /** Set on restart cells that visually span into later rows. */
  readonly mergeRowSpan?: number;
}

/**
 * Resolve borders for every cell in a laid-out table fragment.
 *
 * Shared vertical edges: conflict(left.right, right.left) → assigned to the left cell.
 * Shared horizontal edges: conflict(above.bottom, below.top) → assigned to the above cell,
 * unless the above cell is a vMerge restart whose span covers the below continue (suppressed).
 */
export function resolveTableCellBorderGrid(
  rows: readonly (readonly BorderGridCell[])[],
  table: TableBorderBox,
  columnCount: number
): ResolvedCellBorders[][] {
  const rowCount = rows.length;
  const result: ResolvedCellBorders[][] = rows.map((row) => row.map(() => ({})));

  const cellAt = (
    rowIndex: number,
    gridColumn: number
  ): { cell: BorderGridCell; cellIndex: number } | undefined => {
    const row = rows[rowIndex];
    if (!row) return undefined;
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const cell = row[cellIndex]!;
      if (gridColumn >= cell.gridColumn && gridColumn < cell.gridColumn + cell.gridSpan) {
        return { cell, cellIndex };
      }
    }
    return undefined;
  };

  const effective = (
    cell: BorderGridCell,
    side: keyof CellBorderBox,
    interior: boolean
  ): TableBorderSide =>
    effectiveBorderSide(cell.borders[side], tableFallback(table, side, interior), {
      interior,
    });

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = rows[rowIndex]!;
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const cell = row[cellIndex]!;
      if (cell.vMergeContinue) {
        result[rowIndex]![cellIndex] = {};
        continue;
      }

      const mergeSpan = cell.mergeRowSpan ?? 1;
      const lastMergeRow = rowIndex + mergeSpan - 1;
      const isTop = rowIndex === 0;
      const isBottom = lastMergeRow === rowCount - 1;
      const isLeft = cell.gridColumn === 0;
      const lastCol = cell.gridColumn + cell.gridSpan - 1;
      const isRight = lastCol >= columnCount - 1;
      const resolved: ResolvedCellBorders = {};

      // --- top (outer only; interior owned by row above) ---
      if (isTop) {
        const pub = asResolved(effective(cell, 'top', false));
        if (pub) (resolved as { top?: ResolvedTableBorderEdge }).top = pub;
      }

      // --- left (outer only; interior owned by cell to the left) ---
      if (isLeft) {
        const pub = asResolved(effective(cell, 'left', false));
        if (pub) (resolved as { left?: ResolvedTableBorderEdge }).left = pub;
      }

      // --- bottom (owned here; conflict with below.top when interior) ---
      {
        let edge: TableBorderSide;
        if (isBottom) {
          edge = effective(cell, 'bottom', false);
        } else {
          const below = cellAt(lastMergeRow + 1, cell.gridColumn);
          // A continue below is paint-inert; suppress the seam inside the merge.
          if (below?.cell.vMergeContinue) {
            edge = OMITTED;
          } else {
            const belowTop = below ? effective(below.cell, 'top', true) : table.insideH;
            edge = resolveBorderConflict(effective(cell, 'bottom', true), belowTop);
          }
        }
        const pub = asResolved(edge);
        if (pub) (resolved as { bottom?: ResolvedTableBorderEdge }).bottom = pub;
      }

      // --- right (owned here; conflict with neighbor.left when interior) ---
      {
        let edge: TableBorderSide;
        if (isRight) {
          edge = effective(cell, 'right', false);
        } else {
          const neighbor = cellAt(rowIndex, lastCol + 1);
          const neighborLeft = neighbor
            ? effective(neighbor.cell, 'left', true)
            : table.insideV;
          edge = resolveBorderConflict(effective(cell, 'right', true), neighborLeft);
        }
        const pub = asResolved(edge);
        if (pub) (resolved as { right?: ResolvedTableBorderEdge }).right = pub;
      }

      result[rowIndex]![cellIndex] = resolved;
    }
  }

  return result;
}

/** Width contribution of a resolved edge for content inset / row sizing. */
export function borderExtentPt(edge: ResolvedTableBorderEdge | TableBorderSide | undefined): number {
  if (!edge) return 0;
  if ('state' in edge) {
    return edge.state === 'edge' ? edge.widthPt : 0;
  }
  return edge.widthPt;
}

export const EMPTY_TABLE_BORDER_BOX = EMPTY_TABLE_BORDERS;
export const EMPTY_CELL_BORDER_BOX = EMPTY_CELL_BORDERS;
