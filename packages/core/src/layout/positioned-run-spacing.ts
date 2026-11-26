// Auto multiple line spacing on a line that holds raised or lowered (`w:position`) text, or a list
// marker whose face rises above the text.

import { applyLineSpacing, type ParagraphLineSpacing } from './paragraph-style.ts';
import { isHeightlessWhitespace, lineBandText } from './pending-line.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot, type FontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/**
 * Apply an auto multiple to a line whose text is moved by `w:position`.
 *
 * The multiple scales the line's text band as it would stand without the authored offsets,
 * and the offsets add their height unscaled: 12pt text with a 14pt run raised 4.5pt at 1.5
 * spacing grows by half of the 14pt line, not by half of the raised line. Lines without
 * positioned text, grid lines, other rules and multiples up to single keep `spaced` as is.
 */
export function withPositionedRunSpacing(
  spaced: { readonly height: number; readonly baseline: number; readonly trailing?: number },
  spacing: ParagraphLineSpacing,
  naturalHeight: number,
  spans: readonly (Pick<StyleSpanRecord, 'noteSeparator' | 'fieldAtom'> & {
    readonly text: string;
    readonly style: ResolvedRunStyle;
    readonly fontSlot?: FontSlot;
  })[],
  measurer: Pick<TextMeasurer, 'lineMetrics'>
): { readonly height: number; readonly baseline: number; readonly trailing?: number } {
  if (spacing.rule !== 'auto' || spacing.gridPitch !== undefined || spacing.value <= 240) {
    return spaced;
  }
  const visible = spans.filter((span) => span.text && !isHeightlessWhitespace(span.text));
  if (!visible.some((span) => span.style.baselineShiftPt)) return spaced;
  let ascent = 0;
  let descent = 0;
  for (const span of visible) {
    const unshifted = { ...span.style, baselineShiftPt: 0 };
    const metrics = measurer.lineMetrics(
      styleForFontSlot(unshifted, span.fontSlot),
      lineBandText(span, span.text)
    );
    ascent = Math.max(ascent, metrics.baseline);
    descent = Math.max(descent, metrics.height - metrics.baseline);
  }
  const band = Math.min(naturalHeight, ascent + descent);
  if (!(band > 0)) return spaced;
  return { ...spaced, height: naturalHeight + band * (spacing.value / 240 - 1) };
}

/**
 * Raise a first line whose list marker ascends above its text: the baseline moves down to the
 * marker's ascent and the line grows by the same amount. Returns that rise, or 0.
 */
export function raiseLineToMarker(
  line: { height: number; baseline: number },
  markerAscent: number
): number {
  const rise = markerAscent - line.baseline;
  if (!(rise > 0)) return 0;
  line.baseline = markerAscent;
  line.height += rise;
  return rise;
}

/**
 * Apply an auto multiple to a line that a list marker's taller face raised by `rise`: the
 * multiple scales the text band, and the rise adds once, above or below single. A 22pt bullet on
 * 11pt text at 1.5 spacing grows the line by half of the 11pt band plus the bullet's extra
 * ascent; at 0.9 spacing it shrinks the 11pt band alone. Grid lines keep `spaced` as is.
 *
 * `w:spacing` (`CT_Spacing`, ECMA-376 Part 1 17.3.1.33) with `w:lineRule` `auto`
 * (`ST_LineSpacingRule`, 17.18.48).
 */
function withUnscaledRise(
  spaced: ReturnType<typeof applyLineSpacing>,
  spacing: ParagraphLineSpacing,
  rise: number
): ReturnType<typeof applyLineSpacing> {
  if (!(rise > 0) || spacing.rule !== 'auto' || spacing.gridPitch !== undefined) return spaced;
  const extra = rise * (spacing.value / 240 - 1);
  if (extra === 0) return spaced;
  const height = spaced.height - extra;
  // Above single the baseline stays put unless the growth goes above the band. Below single
  // `applyLineSpacing` scales the baseline, so the unscaled rise moves it back down.
  const movesBaseline = spacing.descentAnchored || extra < 0;
  const baseline = movesBaseline ? spaced.baseline - extra : spaced.baseline;
  return { ...spaced, height, baseline: Math.max(0, Math.min(baseline, height)) };
}

/**
 * {@link applyLineSpacing} for a laid-out line, with {@link withPositionedRunSpacing} applied,
 * or else the list marker's `unscaledRise`. A caller passes no rise for a line without text:
 * the marker is then the line's only band, and the multiple scales all of it.
 */
export function spacedLine(
  spacing: ParagraphLineSpacing,
  naturalHeight: number,
  naturalBaseline: number,
  spans: Parameters<typeof withPositionedRunSpacing>[3],
  measurer: Pick<TextMeasurer, 'lineMetrics'>,
  options: { readonly unscaledRise?: number } = {}
): ReturnType<typeof applyLineSpacing> {
  const spaced = applyLineSpacing(spacing, naturalHeight, naturalBaseline);
  const positioned = withPositionedRunSpacing(spaced, spacing, naturalHeight, spans, measurer);
  // A positioned line's band already leaves the marker out of the multiple.
  if (positioned !== spaced) return positioned;
  return withUnscaledRise(spaced, spacing, options.unscaledRise ?? 0);
}
