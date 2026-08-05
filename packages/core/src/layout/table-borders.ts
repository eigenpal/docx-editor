// Three-state table/cell borders, Word-like collapsed-edge conflict resolution, and
// layout-owned compound stroke geometry.
//
// OOXML distinguishes omitted edges (fall through to `tblBorders`), explicit `nil`/`none`
// (suppress), and styled edges. With zero cell spacing the shared grid line picks one
// winner — per grid interval, so a spanning cell may publish different winners against
// different neighbors. Layout expands double/triple into explicit stroke segments with
// corner-adjusted endpoints in points; paint only scales and draws those records.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { TableBorderStyle } from '@docx-editor.dev/core/store';
import {
  COMPOUND_BORDER_MIN_GAP_PT,
  computeDoubleBorderMetricsPt,
  type CompoundBorderMetrics,
} from './border-metrics.ts';
import { MAX_BORDER_WIDTH_PT } from './paragraph-style.ts';
import { resolveStrictHexFill } from './ooxml-shading.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import {
  buildColumnOwnershipIndexes,
  ownerAt,
  type TableBorderGridResolveWork,
  type TableBorderOwnershipBudget,
} from './table-border-ownership.ts';

export type { TableBorderStyle } from '@docx-editor.dev/core/store';
export type { TableBorderGridResolveWork, TableBorderOwnershipBudget };
export { effectiveBorderSide } from './table-border-cascade.ts';
export {
  createTableBorderOwnershipBudget,
  MAX_BORDER_OWNERSHIP_INTERVALS,
} from './table-border-ownership.ts';
export {
  COMPOUND_BORDER_MIN_GAP_PT,
  COMPOUND_BORDER_MIN_STROKE_PT,
  computeDoubleBorderMetricsPt,
  type CompoundBorderMetrics,
} from './border-metrics.ts';

/** Which physical edge of a box a border sits on. */
export type TableBorderSideName = 'top' | 'right' | 'bottom' | 'left';

/**
 * One border edge in one of three states.
 *
 * `omitted` and `none` are NOT the same: an omitted edge inherits from the table style or the
 * neighbouring cell, while an explicit `none` wins the conflict and draws nothing. Collapsing
 * them would let a style's border reappear where the author removed it.
 */
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

/** A table's six authored border edges: four outer, plus the two interior intervals. */
export interface TableBorderBox {
  readonly top: TableBorderSide;
  readonly left: TableBorderSide;
  readonly bottom: TableBorderSide;
  readonly right: TableBorderSide;
  readonly insideH: TableBorderSide;
  readonly insideV: TableBorderSide;
}

/** The four resolved edges of one cell, after conflict resolution against its neighbours. */
export interface CellBorderBox {
  readonly top: TableBorderSide;
  readonly left: TableBorderSide;
  readonly bottom: TableBorderSide;
  readonly right: TableBorderSide;
}

/** Final edge winner; absent means the side/interval is not drawn. */
export interface ResolvedTableBorderEdge {
  readonly style: TableBorderStyle;
  readonly color: string | null;
  readonly widthPt: number;
}

/**
 * Conflict winner over one grid interval of a cell side.
 *
 * `gridStart`/`gridEnd` are absolute grid column indices for horizontal sides and absolute
 * row indices for vertical sides (half-open). `startPt`/`endPt` are cell-local along-axis
 * positions in layout points.
 */
export interface ResolvedTableBorderEdgeSegment {
  readonly side: TableBorderSideName;
  readonly gridStart: number;
  readonly gridEnd: number;
  readonly startPt: number;
  readonly endPt: number;
  readonly edge: ResolvedTableBorderEdge;
}

/**
 * One published stroke rectangle in cell-local layout points.
 *
 * Paint multiplies x/y/width/height by scale and draws — no metrics, gaps, or corner math.
 */
export interface TableBorderStrokeRecord {
  readonly side: TableBorderSideName;
  readonly role: 'outer' | 'inner' | 'middle' | 'edge';
  readonly color: string | null;
  /** CSS keyword for this stroke (compound strokes are always solid). */
  readonly cssStyle: 'solid' | 'dashed' | 'dotted';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Layout-owned cell borders after conflict resolution and compound expansion.
 *
 * Convenience `top`/`left`/`bottom`/`right` are set when that side has a single uniform
 * full-span winner (existing consumers / CSS simple edges). Multi-interval winners live
 * only on `edgeSegments`. Compound geometry is always on `strokes`.
 */
export interface ResolvedCellBorders {
  readonly top?: ResolvedTableBorderEdge;
  readonly left?: ResolvedTableBorderEdge;
  readonly bottom?: ResolvedTableBorderEdge;
  readonly right?: ResolvedTableBorderEdge;
  readonly edgeSegments?: readonly ResolvedTableBorderEdgeSegment[];
  readonly strokes?: readonly TableBorderStrokeRecord[];
}

/** Soft cap on published stroke rectangles per cell (security / pathological spans). */
export const MAX_TABLE_BORDER_STROKES = 256;

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

/** Style rank, used only to break a conflict between two rules of the SAME width. */
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
  const result: {
    top: TableBorderSide;
    left: TableBorderSide;
    bottom: TableBorderSide;
    right: TableBorderSide;
  } = {
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

/**
 * Read a table's `w:tblBorders`, dropping or clamping hostile values.
 *
 * Widths and colours come from a file: an out-of-range `w:sz` becomes a layout dimension, so it is
 * bounded here rather than downstream.
 */
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

/** Read one cell's `w:tcBorders`, under the same bounds {@link readTableBorders} applies. */
export function readCellBorders(tcPr: OoxmlElement | undefined): CellBorderBox {
  return readBox(tcPr && childNamed(tcPr, 'tcBorders'), ['top', 'left', 'bottom', 'right']);
}

/**
 * Conflict weight: the authored width in eighths of a point, and nothing else.
 *
 * Word-matching, not conformance — §17.4.39 (`w:tblBorders`) and §17.4.66 (`w:tcBorders`)
 * describe the elements and specify no conflict algorithm. Word picks the heavier RULE, so
 * a 6pt dashed rule beats a hairline single. Folding the style rank into the weight (an
 * `sz × border-number` product) made a 0.5pt double outrank a 1pt single and made every
 * dashed or dotted rule weigh 1 regardless of `w:sz`, which erased its width entirely.
 */
export function borderWeight(side: TableBorderSide): number {
  if (side.state !== 'edge') return 0;
  return Math.max(1, Math.round(side.widthPt * 8));
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
 * `none` loses to any edge; two `none`/omitted yield omitted (no paint). Width decides;
 * equal widths rank by style, then prefer the darker color, then `preferFirst`
 * (reading-order / first candidate).
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
  const s1 = BORDER_NUMBER[first.style];
  const s2 = BORDER_NUMBER[second.style];
  if (s1 !== s2) return s1 > s2 ? first : second;
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

export interface BorderGridCell {
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly vMergeContinue: boolean;
  readonly borders: CellBorderBox;
  /** Set on restart cells that visually span into later rows. */
  readonly mergeRowSpan?: number;
}

interface RawInterval {
  gridStart: number;
  gridEnd: number;
  edge: ResolvedTableBorderEdge | undefined;
}

function edgesEqual(
  a: ResolvedTableBorderEdge | undefined,
  b: ResolvedTableBorderEdge | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (!a || !b) return false;
  return a.style === b.style && a.color === b.color && a.widthPt === b.widthPt;
}

function mergeRawIntervals(raw: readonly RawInterval[]): RawInterval[] {
  if (raw.length === 0) return [];
  const out: RawInterval[] = [];
  let current = { ...raw[0]! };
  for (let i = 1; i < raw.length; i += 1) {
    const next = raw[i]!;
    if (current.gridEnd === next.gridStart && edgesEqual(current.edge, next.edge)) {
      current = { ...current, gridEnd: next.gridEnd };
    } else {
      out.push(current);
      current = { ...next };
    }
  }
  out.push(current);
  return out;
}

function convenienceEdge(
  intervals: readonly RawInterval[],
  fullStart: number,
  fullEnd: number
): ResolvedTableBorderEdge | undefined {
  const painted = intervals.filter((interval) => interval.edge !== undefined);
  if (painted.length !== 1) return undefined;
  const only = painted[0]!;
  if (only.gridStart !== fullStart || only.gridEnd !== fullEnd) return undefined;
  return only.edge;
}

/**
 * The absolute grid a table's borders are drawn on: column widths, and per-row tops and heights.
 *
 * Shared by every edge so adjacent cells resolve to the SAME line, rather than each computing its
 * own and leaving a hairline gap between them.
 */
export interface BorderGridGeometry {
  /** Absolute column widths for the whole table (points). */
  readonly columnWidthsPt: readonly number[];
  /**
   * Per laid-out row: absolute top and height in the same coordinate space as cell boxes
   * (only relative differences matter for vertical edge segmentation).
   */
  readonly rowBands: readonly { readonly y: number; readonly height: number }[];
  /** Per laid-out cell: width/height after vMerge expansion (cell-local stroke space). */
  readonly cellBoxes: readonly (readonly { readonly width: number; readonly height: number }[])[];
}

function sumRange(values: readonly number[], start: number, end: number): number {
  let total = 0;
  const last = Math.min(end, values.length);
  for (let i = Math.max(0, start); i < last; i += 1) total += values[i]!;
  return total;
}

function doubleMetricsOf(
  edge: ResolvedTableBorderEdge | undefined
): CompoundBorderMetrics | undefined {
  if (!edge || edge.style !== 'double') return undefined;
  return computeDoubleBorderMetricsPt(edge.widthPt);
}

function cssStyleForEdge(style: TableBorderStyle): 'solid' | 'dashed' | 'dotted' {
  if (style === 'dashed') return 'dashed';
  if (style === 'dotted') return 'dotted';
  return 'solid';
}

function horizStart(which: 'outer' | 'inner', left: CompoundBorderMetrics | undefined): number {
  if (!left) return 0;
  if (which === 'outer') return left.insetPt;
  return left.insetPt + left.strokePt + left.gapPt;
}

function horizEnd(
  which: 'outer' | 'inner',
  cellW: number,
  right: CompoundBorderMetrics | undefined
): number {
  if (!right) return cellW;
  if (which === 'outer') return cellW - right.insetPt;
  return cellW - right.insetPt - right.strokePt - right.gapPt;
}

function vertStart(which: 'outer' | 'inner', top: CompoundBorderMetrics | undefined): number {
  if (!top) return 0;
  if (which === 'outer') return top.insetPt + top.strokePt;
  return top.insetPt + top.extentPt;
}

function vertEnd(
  which: 'outer' | 'inner',
  cellH: number,
  bottom: CompoundBorderMetrics | undefined
): number {
  if (!bottom) return cellH;
  if (which === 'outer') return cellH - bottom.insetPt - bottom.strokePt;
  return cellH - bottom.insetPt - bottom.extentPt;
}

function pushStroke(strokes: TableBorderStrokeRecord[], stroke: TableBorderStrokeRecord): void {
  if (strokes.length >= MAX_TABLE_BORDER_STROKES) return;
  if (!(stroke.width > 0) || !(stroke.height > 0)) return;
  strokes.push(stroke);
}

function expandDoubleInterval(
  strokes: TableBorderStrokeRecord[],
  side: TableBorderSideName,
  edge: ResolvedTableBorderEdge,
  startPt: number,
  endPt: number,
  cellW: number,
  cellH: number,
  leftM: CompoundBorderMetrics | undefined,
  rightM: CompoundBorderMetrics | undefined,
  topM: CompoundBorderMetrics | undefined,
  bottomM: CompoundBorderMetrics | undefined
): void {
  const metrics = computeDoubleBorderMetricsPt(edge.widthPt);
  const { strokePt, gapPt, extentPt, insetPt } = metrics;
  const touchesLeft = Math.abs(startPt) < 1e-6;
  const touchesRight = Math.abs(endPt - cellW) < 1e-6;
  const touchesTop = Math.abs(startPt) < 1e-6;
  const touchesBottom = Math.abs(endPt - cellH) < 1e-6;

  if (side === 'top' || side === 'bottom') {
    const yOuter = side === 'top' ? insetPt : cellH - insetPt - strokePt;
    const yInner = side === 'top' ? insetPt + strokePt + gapPt : cellH - insetPt - extentPt;
    for (const which of ['outer', 'inner'] as const) {
      // Corner-adjusted endpoints may extend past the interval (negative inset).
      let x0 = startPt;
      let x1 = endPt;
      if (touchesLeft) x0 = horizStart(which, leftM);
      if (touchesRight) x1 = horizEnd(which, cellW, rightM);
      pushStroke(strokes, {
        side,
        role: which,
        color: edge.color,
        cssStyle: 'solid',
        x: x0,
        y: which === 'outer' ? yOuter : yInner,
        width: x1 - x0,
        height: strokePt,
      });
    }
    return;
  }

  const xOuter = side === 'left' ? insetPt : cellW - insetPt - strokePt;
  const xInner = side === 'left' ? insetPt + strokePt + gapPt : cellW - insetPt - extentPt;
  for (const which of ['outer', 'inner'] as const) {
    let y0 = startPt;
    let y1 = endPt;
    if (touchesTop) y0 = vertStart(which, topM);
    if (touchesBottom) y1 = vertEnd(which, cellH, bottomM);
    pushStroke(strokes, {
      side,
      role: which,
      color: edge.color,
      cssStyle: 'solid',
      x: which === 'outer' ? xOuter : xInner,
      y: y0,
      width: strokePt,
      height: y1 - y0,
    });
  }
}

function expandTripleInterval(
  strokes: TableBorderStrokeRecord[],
  side: TableBorderSideName,
  edge: ResolvedTableBorderEdge,
  startPt: number,
  endPt: number,
  cellW: number,
  cellH: number
): void {
  const strokePt = edge.widthPt;
  const gapPt = Math.max(COMPOUND_BORDER_MIN_GAP_PT, strokePt);
  const extentPt = strokePt * 3 + gapPt * 2;
  if (side === 'top' || side === 'bottom') {
    const y0 = side === 'top' ? 0 : cellH - extentPt;
    for (let i = 0; i < 3; i += 1) {
      const role = i === 0 ? 'outer' : i === 1 ? 'middle' : 'inner';
      pushStroke(strokes, {
        side,
        role,
        color: edge.color,
        cssStyle: 'solid',
        x: startPt,
        y: y0 + i * (strokePt + gapPt),
        width: endPt - startPt,
        height: strokePt,
      });
    }
    return;
  }
  const x0 = side === 'left' ? 0 : cellW - extentPt;
  for (let i = 0; i < 3; i += 1) {
    const role = i === 0 ? 'outer' : i === 1 ? 'middle' : 'inner';
    pushStroke(strokes, {
      side,
      role,
      color: edge.color,
      cssStyle: 'solid',
      x: x0 + i * (strokePt + gapPt),
      y: startPt,
      width: strokePt,
      height: endPt - startPt,
    });
  }
}

function expandSimpleInterval(
  strokes: TableBorderStrokeRecord[],
  side: TableBorderSideName,
  edge: ResolvedTableBorderEdge,
  startPt: number,
  endPt: number,
  cellW: number,
  cellH: number
): void {
  // Partial intervals cannot use CSS border-*; publish an axis-aligned stroke instead.
  const w = edge.widthPt;
  if (side === 'top') {
    pushStroke(strokes, {
      side,
      role: 'edge',
      color: edge.color,
      cssStyle: cssStyleForEdge(edge.style),
      x: startPt,
      y: 0,
      width: endPt - startPt,
      height: w,
    });
  } else if (side === 'bottom') {
    pushStroke(strokes, {
      side,
      role: 'edge',
      color: edge.color,
      cssStyle: cssStyleForEdge(edge.style),
      x: startPt,
      y: cellH - w,
      width: endPt - startPt,
      height: w,
    });
  } else if (side === 'left') {
    pushStroke(strokes, {
      side,
      role: 'edge',
      color: edge.color,
      cssStyle: cssStyleForEdge(edge.style),
      x: 0,
      y: startPt,
      width: w,
      height: endPt - startPt,
    });
  } else {
    pushStroke(strokes, {
      side,
      role: 'edge',
      color: edge.color,
      cssStyle: cssStyleForEdge(edge.style),
      x: cellW - w,
      y: startPt,
      width: w,
      height: endPt - startPt,
    });
  }
}

function cornerDoubleMetrics(
  intervals: readonly RawInterval[],
  atStart: boolean
): CompoundBorderMetrics | undefined {
  if (intervals.length === 0) return undefined;
  const interval = atStart ? intervals[0]! : intervals[intervals.length - 1]!;
  return doubleMetricsOf(interval.edge);
}

function publishFromIntervals(
  top: readonly RawInterval[],
  left: readonly RawInterval[],
  bottom: readonly RawInterval[],
  right: readonly RawInterval[],
  cellW: number,
  cellH: number,
  columnWidthsPt: readonly number[],
  gridColumn: number,
  rowOffsetsPt: readonly number[],
  rowIndex: number
): ResolvedCellBorders {
  const toSegments = (
    side: TableBorderSideName,
    raw: readonly RawInterval[],
    axisIsHorizontal: boolean
  ): ResolvedTableBorderEdgeSegment[] => {
    const segments: ResolvedTableBorderEdgeSegment[] = [];
    for (const interval of raw) {
      if (!interval.edge) continue;
      let startPt: number;
      let endPt: number;
      if (axisIsHorizontal) {
        startPt = sumRange(columnWidthsPt, gridColumn, interval.gridStart);
        endPt = sumRange(columnWidthsPt, gridColumn, interval.gridEnd);
      } else {
        // rowOffsetsPt[i] = offset of row (rowIndex+i) from cell top; length mergeSpan+1
        startPt = rowOffsetsPt[interval.gridStart - rowIndex] ?? 0;
        endPt = rowOffsetsPt[interval.gridEnd - rowIndex] ?? cellH;
      }
      segments.push({
        side,
        gridStart: interval.gridStart,
        gridEnd: interval.gridEnd,
        startPt,
        endPt,
        edge: interval.edge,
      });
    }
    return segments;
  };

  const topSegs = toSegments('top', top, true);
  const leftSegs = toSegments('left', left, false);
  const bottomSegs = toSegments('bottom', bottom, true);
  const rightSegs = toSegments('right', right, false);
  const edgeSegments = [...topSegs, ...rightSegs, ...bottomSegs, ...leftSegs];

  const leftM = cornerDoubleMetrics(left, true);
  const rightM = cornerDoubleMetrics(right, true);
  const topM = cornerDoubleMetrics(top, true);
  const bottomM = cornerDoubleMetrics(bottom, true);

  const isFull = (segments: readonly ResolvedTableBorderEdgeSegment[], extent: number): boolean =>
    segments.length === 1 &&
    Math.abs(segments[0]!.startPt) < 1e-6 &&
    Math.abs(segments[0]!.endPt - extent) < 1e-6;

  const topIsFull = isFull(topSegs, cellW);
  const leftIsFull = isFull(leftSegs, cellH);
  const bottomIsFull = isFull(bottomSegs, cellW);
  const rightIsFull = isFull(rightSegs, cellH);

  const strokes: TableBorderStrokeRecord[] = [];
  const expandSide = (
    side: TableBorderSideName,
    segments: readonly ResolvedTableBorderEdgeSegment[],
    fullSide: boolean
  ): void => {
    for (const segment of segments) {
      const { edge, startPt, endPt } = segment;
      if (edge.style === 'double') {
        expandDoubleInterval(
          strokes,
          side,
          edge,
          startPt,
          endPt,
          cellW,
          cellH,
          side === 'top' || side === 'bottom' ? leftM : undefined,
          side === 'top' || side === 'bottom' ? rightM : undefined,
          side === 'left' || side === 'right' ? topM : undefined,
          side === 'left' || side === 'right' ? bottomM : undefined
        );
      } else if (edge.style === 'triple') {
        expandTripleInterval(strokes, side, edge, startPt, endPt, cellW, cellH);
      } else if (!fullSide) {
        // Multi-interval simple edges cannot use CSS border-*; publish stroke geometry.
        expandSimpleInterval(strokes, side, edge, startPt, endPt, cellW, cellH);
      }
    }
  };

  expandSide('top', topSegs, topIsFull);
  expandSide('left', leftSegs, leftIsFull);
  expandSide('bottom', bottomSegs, bottomIsFull);
  expandSide('right', rightSegs, rightIsFull);

  const result: {
    top?: ResolvedTableBorderEdge;
    left?: ResolvedTableBorderEdge;
    bottom?: ResolvedTableBorderEdge;
    right?: ResolvedTableBorderEdge;
    edgeSegments?: ResolvedTableBorderEdgeSegment[];
    strokes?: TableBorderStrokeRecord[];
  } = {};

  if (topIsFull && topSegs[0]) result.top = topSegs[0].edge;
  if (leftIsFull && leftSegs[0]) result.left = leftSegs[0].edge;
  if (bottomIsFull && bottomSegs[0]) result.bottom = bottomSegs[0].edge;
  if (rightIsFull && rightSegs[0]) result.right = rightSegs[0].edge;

  if (edgeSegments.length > 0) result.edgeSegments = edgeSegments;
  if (strokes.length > 0) result.strokes = strokes;
  return result;
}

/**
 * Resolve borders for every cell in a laid-out table fragment.
 *
 * Shared vertical edges: conflict(left.right, right.left) → assigned to the left cell,
 * segmented per row when a vMerge restart faces differing neighbors.
 * Shared horizontal edges: conflict(above.bottom, below.top) → assigned to the above cell,
 * segmented per grid column when a gridSpan cell faces differing below neighbors; vMerge
 * interior seams are suppressed per interval.
 *
 * When `geometry` is provided, compound edges expand into explicit stroke records with
 * corner-adjusted endpoints in cell-local points.
 */
export function resolveTableCellBorderGrid(
  rows: readonly (readonly BorderGridCell[])[],
  table: TableBorderBox,
  columnCount: number,
  geometry?: BorderGridGeometry,
  work?: TableBorderGridResolveWork,
  ownershipBudget?: TableBorderOwnershipBudget
): ResolvedCellBorders[][] {
  const rowCount = rows.length;
  const result: ResolvedCellBorders[][] = rows.map((row) => row.map(() => ({})));
  if (work) {
    work.ownershipSlotsWritten = 0;
    work.columnLookups = 0;
  }
  const ownership = buildColumnOwnershipIndexes(rows, columnCount, work, ownershipBudget);

  const effective = (
    cell: BorderGridCell,
    side: keyof CellBorderBox,
    interior: boolean
  ): TableBorderSide =>
    effectiveBorderSide(cell.borders[side], tableFallback(table, side, interior), {
      interior,
    });

  /**
   * Conflict over a shared interior grid line, honouring where each side came from.
   *
   * An explicit `w:val="nil"` is a statement, not an omission — it is what Word writes when
   * a cell is given "No Border" — so it suppresses the line even though the neighbour, by
   * omitting its own side, still inherits `insideH`/`insideV`. Only a neighbour that
   * AUTHORS an edge of its own overrides the nil, and then the ordinary weight fight
   * decides. Word-matching: §17.4.39 / §17.4.66 specify no algorithm.
   */
  const interiorConflict = (
    mine: TableBorderSide,
    theirs: TableBorderSide,
    mineEffective: TableBorderSide,
    theirsEffective: TableBorderSide
  ): TableBorderSide => {
    if (mine.state === 'none' && theirs.state !== 'edge') return NONE;
    if (theirs.state === 'none' && mine.state !== 'edge') return NONE;
    return resolveBorderConflict(mineEffective, theirsEffective);
  };

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

      // --- top (outer only; interior owned by row above) — per grid column ---
      const topRaw: RawInterval[] = [];
      if (isTop) {
        for (let col = cell.gridColumn; col <= lastCol; col += 1) {
          topRaw.push({
            gridStart: col,
            gridEnd: col + 1,
            edge: asResolved(effective(cell, 'top', false)),
          });
        }
      }

      // --- left (outer only; interior owned by cell to the left) — per merge row ---
      const leftRaw: RawInterval[] = [];
      if (isLeft) {
        for (let r = rowIndex; r <= lastMergeRow; r += 1) {
          leftRaw.push({
            gridStart: r,
            gridEnd: r + 1,
            edge: asResolved(effective(cell, 'left', false)),
          });
        }
      }

      // --- bottom (owned here; conflict with below.top per grid column) ---
      const bottomRaw: RawInterval[] = [];
      for (let col = cell.gridColumn; col <= lastCol; col += 1) {
        let edge: TableBorderSide;
        if (isBottom) {
          edge = effective(cell, 'bottom', false);
        } else {
          const below = ownerAt(ownership, lastMergeRow + 1, col, work);
          // Suppress only intervals whose below cell is a vMerge continue covering this col.
          if (below?.cell.vMergeContinue) {
            edge = OMITTED;
          } else {
            edge = interiorConflict(
              cell.borders.bottom,
              below ? below.cell.borders.top : OMITTED,
              effective(cell, 'bottom', true),
              below ? effective(below.cell, 'top', true) : table.insideH
            );
          }
        }
        bottomRaw.push({ gridStart: col, gridEnd: col + 1, edge: asResolved(edge) });
      }

      // --- right (owned here; conflict with neighbor.left per merge row) ---
      const rightRaw: RawInterval[] = [];
      for (let r = rowIndex; r <= lastMergeRow; r += 1) {
        let edge: TableBorderSide;
        if (isRight) {
          edge = effective(cell, 'right', false);
        } else {
          const neighbor = ownerAt(ownership, r, lastCol + 1, work);
          edge = interiorConflict(
            cell.borders.right,
            neighbor ? neighbor.cell.borders.left : OMITTED,
            effective(cell, 'right', true),
            neighbor ? effective(neighbor.cell, 'left', true) : table.insideV
          );
        }
        rightRaw.push({ gridStart: r, gridEnd: r + 1, edge: asResolved(edge) });
      }

      const top = mergeRawIntervals(topRaw);
      const left = mergeRawIntervals(leftRaw);
      const bottom = mergeRawIntervals(bottomRaw);
      const right = mergeRawIntervals(rightRaw);

      if (!geometry) {
        // Geometry-free path (unit tests of conflict only): publish convenience edges when
        // the side collapses to one uniform full-span winner.
        const resolved: {
          top?: ResolvedTableBorderEdge;
          left?: ResolvedTableBorderEdge;
          bottom?: ResolvedTableBorderEdge;
          right?: ResolvedTableBorderEdge;
          edgeSegments?: ResolvedTableBorderEdgeSegment[];
        } = {};
        const topEdge = convenienceEdge(top, cell.gridColumn, lastCol + 1);
        const leftEdge = convenienceEdge(left, rowIndex, lastMergeRow + 1);
        const bottomEdge = convenienceEdge(bottom, cell.gridColumn, lastCol + 1);
        const rightEdge = convenienceEdge(right, rowIndex, lastMergeRow + 1);
        if (topEdge) resolved.top = topEdge;
        if (leftEdge) resolved.left = leftEdge;
        if (bottomEdge) resolved.bottom = bottomEdge;
        if (rightEdge) resolved.right = rightEdge;

        const edgeSegments: ResolvedTableBorderEdgeSegment[] = [];
        const pushGeomFree = (
          side: TableBorderSideName,
          intervals: readonly RawInterval[]
        ): void => {
          for (const interval of intervals) {
            if (!interval.edge) continue;
            edgeSegments.push({
              side,
              gridStart: interval.gridStart,
              gridEnd: interval.gridEnd,
              startPt: interval.gridStart,
              endPt: interval.gridEnd,
              edge: interval.edge,
            });
          }
        };
        pushGeomFree('top', top);
        pushGeomFree('left', left);
        pushGeomFree('bottom', bottom);
        pushGeomFree('right', right);
        if (edgeSegments.length > 0) resolved.edgeSegments = edgeSegments;
        result[rowIndex]![cellIndex] = resolved;
        continue;
      }

      const cellBox = geometry.cellBoxes[rowIndex]![cellIndex]!;
      const rowOffsets: number[] = [0];
      let acc = 0;
      for (let r = rowIndex; r <= lastMergeRow; r += 1) {
        const band = geometry.rowBands[r]!;
        acc += band.height;
        rowOffsets.push(acc);
      }
      // Prefer the expanded cell height when floating-point drift appears.
      if (rowOffsets.length > 1) {
        rowOffsets[rowOffsets.length - 1] = cellBox.height;
      }

      result[rowIndex]![cellIndex] = publishFromIntervals(
        top,
        left,
        bottom,
        right,
        cellBox.width,
        cellBox.height,
        geometry.columnWidthsPt,
        cell.gridColumn,
        rowOffsets,
        rowIndex
      );
    }
  }

  return result;
}

/** Width contribution of a resolved edge for content inset / row sizing. */
export function borderExtentPt(
  edge: ResolvedTableBorderEdge | TableBorderSide | undefined
): number {
  if (!edge) return 0;
  if ('state' in edge) {
    return edge.state === 'edge' ? edge.widthPt : 0;
  }
  return edge.widthPt;
}

export const EMPTY_TABLE_BORDER_BOX = EMPTY_TABLE_BORDERS;
export const EMPTY_CELL_BORDER_BOX = EMPTY_CELL_BORDERS;
