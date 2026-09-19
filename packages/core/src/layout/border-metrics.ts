// Layout-owned compound border metrics shared by paragraph `w:pBdr` and table borders.
//
// WordprocessingML double borders specify each stroke in eighths of a point.
// The gap has the same width; the complete band therefore spans three strokes.
// Paint only scales these points — it must not reinterpret the authored width.

/** Minimum stroke width for a compound (double/triple) band, in points. */
export const COMPOUND_BORDER_MIN_STROKE_PT = 0.25;
/** Minimum gap between compound strokes, in points. */
export const COMPOUND_BORDER_MIN_GAP_PT = 0.25;

/**
 * How a multi-line border style (double, triple) is drawn: stroke width, gap, and total extent.
 *
 * Table stroke coordinates centre the painted band on the authored edge box.
 * Content insets must also account for the portion that extends inward.
 */
export interface CompoundBorderMetrics {
  readonly strokePt: number;
  readonly gapPt: number;
  readonly extentPt: number;
  /** Centers the compound band on the authored width; negative extends outward. */
  readonly insetPt: number;
}

/**
 * Double strokes use the authored width, with a quarter-point minimum.
 * The complete band is centred on the authored edge box. Device pixel rounding
 * belongs to rendering; these layout metrics remain in continuous points.
 */
export function computeDoubleBorderMetricsPt(widthPt: number): CompoundBorderMetrics {
  const strokePt = Math.max(widthPt, COMPOUND_BORDER_MIN_STROKE_PT);
  const gapPt = Math.max(widthPt, COMPOUND_BORDER_MIN_GAP_PT);
  const extentPt = strokePt * 2 + gapPt;
  return { strokePt, gapPt, extentPt, insetPt: (widthPt - extentPt) / 2 };
}

/**
 * OOXML `ST_Border` values whose painted band is wider than a single `w:sz` hairline.
 *
 * Decorative art borders are out of scope — callers treat them as a solid single.
 */
const COMPOUND_BORDER_VALS = new Set([
  'double',
  'triple',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'thinThickThinSmallGap',
  'thinThickMediumGap',
  'thickThinMediumGap',
  'thinThickThinMediumGap',
  'thinThickLargeGap',
  'thickThinLargeGap',
  'thinThickThinLargeGap',
  'doubleWave',
]);

/** True when `ST_Border` paints as more than one parallel stroke. */
export function isCompoundBorderVal(val: string): boolean {
  return COMPOUND_BORDER_VALS.has(val);
}

/**
 * Visual thickness of one border edge in points — the stroke box height/width layout
 * publishes. Double borders include both strokes and their gap. Other compound styles
 * retain their existing double-band approximation; everything else uses `w:sz`.
 */
export function borderStrokeWidthPt(val: string, widthPt: number): number {
  if (isCompoundBorderVal(val)) return computeDoubleBorderMetricsPt(widthPt).extentPt;
  return widthPt;
}

/**
 * Every `ST_Border` value that is a LINE (ECMA-376 §17.18.2), `nil` / `none` excluded.
 *
 * The rest of the enumeration — `apples`, `cabins`, `iceCreamCones`, another ninety of them —
 * are ART borders: repeated bitmap tiles, not strokes. They carry a `w:sz` and a `w:color`
 * like any other edge, so nothing about the attributes says which kind an edge is, and a
 * reader that only checks for `none` paints a row of apples as a plain black rule.
 *
 * Page borders are where this bites: art borders are legal ONLY on `w:pgBorders`, and a
 * decorative frame silently degraded to a box is a worse answer than no frame at all.
 * Paragraph and table borders keep their existing fall-through-to-solid behaviour, which for
 * them is unreachable by the schema anyway.
 */
const LINE_BORDER_VALS = new Set([
  'single',
  'thick',
  'double',
  'dotted',
  'dashed',
  'dotDash',
  'dotDotDash',
  'triple',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'thinThickThinSmallGap',
  'thinThickMediumGap',
  'thickThinMediumGap',
  'thinThickThinMediumGap',
  'thinThickLargeGap',
  'thickThinLargeGap',
  'thinThickThinLargeGap',
  'wave',
  'doubleWave',
  'dashSmallGap',
  'dashDotStroked',
  'threeDEmboss',
  'threeDEngrave',
  'outset',
  'inset',
]);

/** True when `ST_Border` names a line style rather than a decorative art border. */
export function isLineBorderVal(val: string): boolean {
  return LINE_BORDER_VALS.has(val);
}
