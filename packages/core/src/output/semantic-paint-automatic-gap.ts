// Character fill across automatic East Asian/Latin spacing.
//
// `w:autoSpaceDE` and `w:autoSpaceDN` add an advance where East Asian text meets Latin letters
// or digits. Layout places it as a margin before the later span, and a margin takes no fill.
// The run before the advance owns it, in both directions: its highlight or character shading
// covers the advance, also when the next run has a different fill. Screen paint draws that part
// of the fill as the run's box shadow, and the PDF writer widens the fill band by the same width.
import { automaticTextSpacingBefore } from '../layout/cjk-automatic-spacing.ts';
import type { ResolvedRunStyle } from '../layout/run-style.ts';
import { HIGHLIGHT_COLOR_HEX } from './semantic-paint.ts';

const HEX = /^[0-9A-Fa-f]{6}$/;

/**
 * The fields of a laid span that {@link automaticGapFillAfter} reads. A `StyleSpanRecord` is one.
 *
 * @internal
 */
export interface AutomaticGapSpan {
  readonly range: { readonly start: number };
  readonly style: { readonly shaping?: { readonly baseLevel?: number } | null };
}

/**
 * The width of the automatic advance before `next` that the fill of `span` covers, in points:
 * the advance layout placed at the start of `next`, at most the painted `gap` between the two
 * spans. Justification slack in the same gap stays unfilled. Zero when `next` starts with no
 * automatic advance, and on a right-to-left line, where the run order differs from the
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
  const width = Math.min(gap, automaticTextSpacingBefore(next));
  return width > 0.001 ? width : 0;
}

/** At most this many shadow copies tile a gap wider than its run. */
const MAX_GAP_FILL_COPIES = 8;
/**
 * How far, in CSS pixels, the fill runs on under a next run that has a fill of its own. A
 * shadow edge is not snapped to device pixels the way a background edge is, so a fill that
 * ended exactly at the next fill left a light seam between them. The next run paints over the
 * overlap. Beside unfilled text the fill ends exactly at the gap's far edge.
 */
const GAP_FILL_OVERLAP_PX = 0.5;

/** Whether a run style paints a character fill: a known highlight, or character shading. */
function hasCharacterFill(style: Pick<ResolvedRunStyle, 'highlight' | 'shading'>): boolean {
  return (
    (!!style.highlight && HIGHLIGHT_COLOR_HEX.has(style.highlight)) ||
    (!!style.shading && HEX.test(style.shading))
  );
}

/**
 * Extend the character fill of `painted` across `width` points after its box, `runWidth`
 * points wide, up to the `next` run. The fill is drawn as copies of the run's box shadow,
 * shifted right: a shadow paints in the run's background, under its own text and under the
 * next run's, so no glyph ink is covered. It changes neither layout nor hit testing, and the
 * run's dark-mode treatment applies to it. Nothing is painted when the run has no fill.
 */
export function paintAutomaticGapFill(
  painted: HTMLElement,
  next: { readonly style: Pick<ResolvedRunStyle, 'highlight' | 'shading'> },
  width: number,
  runWidth: number,
  scale: number
): void {
  const fill = painted.style.backgroundColor;
  if (!(width > 0) || !(runWidth > 0) || !(scale > 0) || !fill) return;
  // The copy shifted by the gap ends at its far edge. A gap wider than the run needs more
  // copies, one run width apart, to leave no hole.
  const end = width * scale + (hasCharacterFill(next.style) ? GAP_FILL_OVERLAP_PX : 0);
  const step = runWidth * scale;
  const offsets = [end];
  for (let at = step; at < end && offsets.length < MAX_GAP_FILL_COPIES; at += step)
    offsets.push(at);
  painted.style.boxShadow = offsets.map((offset) => `${offset}px 0 0 0 ${fill}`).join(', ');
}
