// Layout-owned compound border metrics shared by paragraph `w:pBdr` and table borders.
//
// Word's `w:sz` for a multi-line style is the TOTAL band including gaps. Thin authored
// doubles (e.g. sz="3" → 0.375pt) still paint as a visible double, so layout inflates to a
// minimum stroke/gap band. Paint only scales these points — it must not re-derive mins.

/** Minimum stroke width for a compound (double/triple) band, in points. */
export const COMPOUND_BORDER_MIN_STROKE_PT = 1;
/** Minimum gap between compound strokes, in points. */
export const COMPOUND_BORDER_MIN_GAP_PT = 1;

/**
 * How a multi-line border style (double, triple) is drawn: stroke width, gap, and total extent.
 *
 * The band is CENTRED on the authored width, so a double border occupies the space Word gives it
 * rather than growing the cell it surrounds.
 */
export interface CompoundBorderMetrics {
  readonly strokePt: number;
  readonly gapPt: number;
  readonly extentPt: number;
  /** Centers the compound band on the authored width; negative extends outward. */
  readonly insetPt: number;
}

/**
 * Deterministic double stroke / gap / extent in layout points (scale-independent).
 *
 * Thin authored widths inflate to a 1+1+1 point compound so a `w:sz="3"` double remains
 * visible at paint scale 1 — matching Word's hairline-double floor.
 */
export function computeDoubleBorderMetricsPt(widthPt: number): CompoundBorderMetrics {
  const bandPt = Math.max(widthPt, COMPOUND_BORDER_MIN_STROKE_PT);
  const minExtent = 2 * COMPOUND_BORDER_MIN_STROKE_PT + COMPOUND_BORDER_MIN_GAP_PT;
  if (bandPt >= minExtent) {
    const unit = bandPt / 3;
    if (unit >= COMPOUND_BORDER_MIN_STROKE_PT) {
      return { strokePt: unit, gapPt: unit, extentPt: bandPt, insetPt: 0 };
    }
  }
  const strokePt = COMPOUND_BORDER_MIN_STROKE_PT;
  const gapPt = COMPOUND_BORDER_MIN_GAP_PT;
  const extentPt = Math.max(bandPt, minExtent);
  return { strokePt, gapPt, extentPt, insetPt: (bandPt - extentPt) / 2 };
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
 * publishes. Compound styles use the inflated double band; everything else uses `w:sz`.
 */
export function borderStrokeWidthPt(val: string, widthPt: number): number {
  if (isCompoundBorderVal(val)) return computeDoubleBorderMetricsPt(widthPt).extentPt;
  return widthPt;
}
