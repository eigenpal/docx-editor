// The text band that multiple line spacing scales on a line that holds an equation.
import { equationTextBand, type EquationTextBand } from './equation-line-extent.ts';
import type { ParagraphLineSpacing } from './paragraph-style.ts';
import type { PendingLine } from './pending-line.ts';
import { textBandWithBorders } from './run-border-strokes.ts';
import type { TextMeasurer } from './semantic-records.ts';

/**
 * The band that `auto` line spacing scales on a line with an equation and no drawing.
 *
 * The line keeps the equation's own extent, and the multiple adds or removes its share of the
 * text band only, as for an inline picture: above single spacing the extra goes below the
 * line, and below single spacing the line loses that share. The text band is the taller of
 * the line's text and the font box that each equation gives its line (`equationTextBand`), so
 * an equation that opens with a 48pt run scales by that run's box, not by the text around it.
 *
 * Undefined for any other line, for a line grid, and for an equation whose extent was not
 * fitted.
 */
export function equationSpacingBand(
  line: Pick<PendingLine, 'spans' | 'drawings'>,
  spacing: ParagraphLineSpacing,
  measurer: TextMeasurer,
  pageBreaksIgnored: boolean
): EquationTextBand | undefined {
  if (spacing.rule !== 'auto' || spacing.gridPitch !== undefined || line.drawings.length > 0)
    return undefined;
  let band: EquationTextBand | undefined;
  for (const span of line.spans) {
    if (span.unsupported !== undefined) return undefined;
    const own = span.equation ? equationTextBand(span.equation.geometry) : undefined;
    if (span.equation && !own) return undefined;
    if (own && own.height > (band?.height ?? 0)) band = own;
  }
  if (!band) return undefined;
  // The equation span carries the style of the text around it, which is not text on the line.
  const text = textBandWithBorders(
    line.spans.filter((span) => span.equation === undefined),
    measurer,
    pageBreaksIgnored
  );
  return text.height > band.height ? text : band;
}
