// Ruler indent geometry and drag math.
//
// Pure functions over twips: where each of Word's four indent handles sits, and what a drag
// to a given position makes of the paragraph's indent. Engine-owned and adapter-agnostic for
// the reason `ruler-ticks.ts` is — the hanging-vs-left-box rule is subtle enough that React
// and Vue must not each grow their own copy of it.
//
// The vocabulary is the contract's: twips, and ONE signed first-line offset where negative
// is a hanging indent.

// The unit comes from the tick module rather than being redeclared: the snap grid and the
// tick cadence are the same grid, and two definitions could drift apart.
import type { RulerUnit } from './ruler-ticks.ts';

export const TWIPS_PER_INCH = 1440;
export const TWIPS_PER_CM = 567;

/** Word snaps ruler drags to the eighth-inch grid its ticks already draw. */
export const SNAP_TWIPS_INCH = TWIPS_PER_INCH / 8;
/** The centimetre ruler's grid is the millimetre. */
export const SNAP_TWIPS_CM = TWIPS_PER_CM / 10;

export type { RulerUnit };

/**
 * The four handles Word's ruler carries.
 *
 * `hanging` and `left` sit at the SAME position and differ only in what a drag takes with
 * them — the box moves the whole paragraph, the triangle leaves the first line where it is.
 */
export type RulerIndentHandle = 'firstLine' | 'hanging' | 'left' | 'right';

/** A paragraph's indent as the ruler works with it. Twips; `firstLine` signed. */
export interface RulerIndent {
  readonly left: number;
  readonly right: number;
  readonly firstLine: number;
}

/** The page the handles are placed against. Twips. */
export interface RulerPageMetrics {
  readonly pageWidth: number;
  readonly leftMargin: number;
  readonly rightMargin: number;
}

export interface RulerDragOptions {
  readonly unit?: RulerUnit;
  /** Alt held: continuous, twip-precision drag, bypassing the snap grid — as in Word. */
  readonly precise?: boolean;
}

const clamp = (value: number, low: number, high: number): number =>
  high < low ? low : value < low ? low : value > high ? high : value;

/** Where a handle sits, in twips from the page's LEFT SHEET EDGE (not the margin). */
export function handlePosition(
  handle: RulerIndentHandle,
  indent: RulerIndent,
  page: RulerPageMetrics
): number {
  switch (handle) {
    case 'firstLine':
      return page.leftMargin + indent.left + indent.firstLine;
    // Coincident by design, as in Word.
    case 'hanging':
    case 'left':
      return page.leftMargin + indent.left;
    case 'right':
      return page.pageWidth - page.rightMargin - indent.right;
  }
}

/** Round to the ruler's grid, or to the twip when the drag is precise. */
export function snapTwips(value: number, unit: RulerUnit, precise: boolean): number {
  if (precise) return Math.round(value);
  const step = unit === 'cm' ? SNAP_TWIPS_CM : SNAP_TWIPS_INCH;
  return Math.round(Math.round(value / step) * step);
}

/**
 * The indent a drag of `handle` to `positionTwips` produces.
 *
 * Clamps differ from the MARGIN drags this ruler also carries, and deliberately:
 *
 * - Indents may go NEGATIVE, pulling text into the margin, which Word allows. The floor is
 *   the sheet edge, not the margin.
 * - There is no minimum text width. The 720-twip floor the margin drags use mirrors an
 *   engine refusal that does not exist for indents, and enforcing one here would make a
 *   narrow pull-quote unreachable. Left and right markers may MEET; they may not cross.
 * - The left box needs a first-line clamp of its own. It does not move `firstLine`, so on a
 *   hanging paragraph dragging the box left can push the first-line marker off the sheet
 *   while the box itself is still in range. The drag stops when the LEADING marker lands.
 */
export function dragIndent(
  handle: RulerIndentHandle,
  positionTwips: number,
  indent: RulerIndent,
  page: RulerPageMetrics,
  options: RulerDragOptions = {}
): RulerIndent {
  const x = snapTwips(positionTwips, options.unit ?? 'inch', options.precise ?? false);
  const rightEdge = page.pageWidth - page.rightMargin - indent.right;
  const leadingLeft = page.leftMargin + indent.left + Math.max(0, indent.firstLine);

  switch (handle) {
    case 'firstLine': {
      // The marker itself is what is being placed, so the clamp is on the sheet and on not
      // passing the right indent.
      const placed = clamp(x, 0, rightEdge);
      return { ...indent, firstLine: placed - page.leftMargin - indent.left };
    }
    case 'left': {
      // Both markers move together, so BOTH bound the drag.
      const low = -page.leftMargin - Math.min(0, indent.firstLine);
      const high = rightEdge - page.leftMargin - Math.max(0, indent.firstLine);
      return { ...indent, left: clamp(x - page.leftMargin, low, high) };
    }
    case 'hanging': {
      // The first-line marker is PINNED: `left` absorbs the move and `firstLine` gives back
      // exactly what `left` took, so `leftMargin + left + firstLine` is unchanged.
      const next = clamp(x - page.leftMargin, -page.leftMargin, rightEdge - page.leftMargin);
      return {
        ...indent,
        left: next,
        firstLine: indent.firstLine + (indent.left - next),
      };
    }
    case 'right': {
      const placed = clamp(x, leadingLeft, page.pageWidth);
      return { ...indent, right: page.pageWidth - page.rightMargin - placed };
    }
  }
}
