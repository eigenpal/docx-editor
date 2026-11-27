// Character fill across automatic East Asian/Latin spacing.
//
// `w:autoSpaceDE` and `w:autoSpaceDN` add an advance where East Asian text meets Latin letters
// or digits. Layout places it as a margin before the later span, and a margin takes no fill.
// The run before the advance owns it, in both directions: its highlight (`w:highlight`) or
// character shading (`w:shd` in `w:rPr`) covers the advance, also when the next run has a
// different fill. Screen paint draws that part of the fill as the run's box shadow, and the PDF
// writer widens the fill band by the same width.
import { automaticTextSpacingBefore } from '../layout/cjk-automatic-spacing.ts';
import { runBorderGapBetween, type BorderedText } from '../layout/run-border-advance.ts';

/**
 * The fields of a laid span that {@link automaticGapFillAfter} reads. A `StyleSpanRecord` is one.
 *
 * @internal
 */
export interface AutomaticGapSpan {
  readonly range: { readonly start: number };
  readonly style: { readonly shaping?: { readonly baseLevel?: number } | null };
}

/** Whether a span carries what its border room is read from. */
const placedText = (span: AutomaticGapSpan): span is AutomaticGapSpan & BorderedText =>
  typeof (span as Partial<BorderedText>).text === 'string' &&
  typeof (span as Partial<BorderedText>).range?.end === 'number';

/**
 * The width of the automatic advance before `next` that the fill of `span` covers, in points:
 * the advance layout placed at the start of `next`, at most the painted `gap` between the two
 * spans. Justification slack in the same gap stays unfilled, and so does the room of a
 * character border. Zero when `next` starts with no automatic advance, and on a right-to-left line, where the run order differs from the
 * visual order.
 *
 * @internal
 */
export function automaticGapFillAfter(
  span: AutomaticGapSpan,
  next: AutomaticGapSpan,
  gap: number
): number {
  if (!(gap > 0.001)) return 0;
  if (span.style.shaping?.baseLevel === 1 || next.style.shaping?.baseLevel === 1) return 0;
  // The room of a character border (`w:bdr`, ECMA-376 Part 1, 17.3.2.4) shares the advance
  // before `next`. It belongs to the border, so the fill of `span` stops before it.
  const border = placedText(span) && placedText(next) ? runBorderGapBetween(span, next) : 0;
  const width = Math.min(gap, automaticTextSpacingBefore(next) - border);
  return width > 0.001 ? width : 0;
}

/** At most this many shadow copies tile a gap wider than its run. */
const MAX_GAP_FILL_COPIES = 8;
/**
 * How far, in CSS pixels, a fill runs on under its neighbour. A shadow edge is not snapped to
 * device pixels the way a background edge is, so a fill that ended exactly at the next run's
 * opaque fill left a light seam between them; the next run paints over the overlap. Tiled
 * copies overlap each other by the same amount, so a run the browser draws narrower than
 * layout leaves no hole between them.
 */
const GAP_FILL_OVERLAP_PX = 0.5;

/** An opaque inline colour: hex, or `rgb()` without alpha, the forms the DOM writes back. */
const OPAQUE = /^(#[0-9a-f]{6}|rgb\([^)]*\))$/i;

/**
 * Prepare the character fill of `painted` across `width` points after its box, `runWidth`
 * points wide. The fill is drawn as copies of the run's box shadow, shifted right: a shadow
 * paints in the run's background, under its own text and under the next run's, so no glyph
 * ink is covered. It changes neither layout nor hit testing, and the run's dark-mode treatment
 * applies to it.
 *
 * Returns the step that writes the shadow once the run after the gap is painted: the fill runs
 * on under that run only when its own background is opaque, and ends exactly at the gap's far
 * edge beside unfilled or translucent text. Null when the run has no fill of its own.
 */
export function paintAutomaticGapFill(
  painted: HTMLElement,
  width: number,
  runWidth: number,
  scale: number
): ((next: HTMLElement) => void) | null {
  const fill = painted.style.backgroundColor;
  if (!(width > 0) || !(runWidth > 0) || !(scale > 0) || !fill) return null;
  return (next) => {
    const overlap = OPAQUE.test(next.style.backgroundColor.trim()) ? GAP_FILL_OVERLAP_PX : 0;
    // The copy shifted by the gap ends at its far edge. A gap wider than the run needs more
    // copies, each starting before the previous one ends, to leave no hole.
    const end = width * scale + overlap;
    const step = Math.max(GAP_FILL_OVERLAP_PX, runWidth * scale - GAP_FILL_OVERLAP_PX);
    const offsets = [end];
    for (let at = step; at < end && offsets.length < MAX_GAP_FILL_COPIES; at += step)
      offsets.push(at);
    painted.style.boxShadow = offsets.map((offset) => `${offset}px 0 0 0 ${fill}`).join(', ');
  };
}
