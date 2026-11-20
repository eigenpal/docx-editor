// Character fill across automatic East Asian/Latin spacing.
//
// `w:autoSpaceDE` and `w:autoSpaceDN` add an advance where East Asian text meets Latin letters
// or digits. Layout places it as a margin before the later span, and a margin takes no fill.
// The run before the advance owns it, in both directions: its highlight or character shading
// covers the advance, also when the next run has a different fill. Screen paint draws that part
// of the fill as an inert backing, and the PDF writer widens the fill band by the same width.
import { automaticTextSpacingBefore } from '../layout/cjk-automatic-spacing.ts';

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

/**
 * Extend the character fill of `painted` across `width` points after its box. The backing is
 * a child of the run, so the run's dark-mode treatment applies to it as well. It holds no
 * text, takes no pointer events, and leaves the run's box, text, and model offsets unchanged.
 * Nothing is painted when the run has no fill of its own.
 */
export function paintAutomaticGapFill(
  document: Document,
  painted: HTMLElement,
  width: number,
  scale: number
): void {
  if (!(width > 0) || !painted.style.backgroundColor) return;
  const backing = document.createElement('span');
  backing.className = 'docx-automatic-gap-fill';
  backing.setAttribute('aria-hidden', 'true');
  backing.setAttribute('contenteditable', 'false');
  backing.style.position = 'absolute';
  backing.style.left = '100%';
  backing.style.top = '0';
  backing.style.width = `${width * scale}px`;
  backing.style.height = '100%';
  backing.style.backgroundColor = painted.style.backgroundColor;
  backing.style.pointerEvents = 'none';
  if (!painted.style.position) painted.style.position = 'relative';
  painted.append(backing);
}
