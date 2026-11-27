import type { ResolvedRunStyle } from './run-style.ts';
import { lineBandText } from './pending-line.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { styleForFontSlot, type FontSlot } from './script-itemization.ts';

/** A character that draws text: not a space, tab, break, or object placeholder. */
const TEXT_GLYPH = /[^ \t\n\r\f\v\uFFFC]/u;

/** One full-size style per script span style, so a measurer that keys on the style keeps its entry. */
const lineBoxStyles = new WeakMap<ResolvedRunStyle, ResolvedRunStyle>();

/**
 * The style that sizes the line box of a run or of a paragraph mark.
 *
 * `w:vertAlign` (CT_VerticalAlignRun, ECMA-376 17.3.2.42) repositions text as superscript or
 * subscript "without altering the font size of the run properties", and ST_VerticalAlignRun
 * (22.9.2.17) only draws the glyphs smaller. So the line box of script text is the line box of
 * the same run on the baseline at its own `w:sz`. The paragraph mark is a character with run
 * properties (CT_ParaRPr, 17.3.1.29), and the same holds for the line it sizes.
 *
 * Returns `style` itself when it is not superscript or subscript.
 */
export function lineBoxStyleOf(style: ResolvedRunStyle): ResolvedRunStyle {
  if (style.verticalAlign === 'baseline') return style;
  let fullSize = lineBoxStyles.get(style);
  if (!fullSize) {
    fullSize = { ...style, verticalAlign: 'baseline' };
    lineBoxStyles.set(style, fullSize);
  }
  return fullSize;
}

/**
 * Grow a line that holds super- or subscript text to each script run's full-size metrics.
 *
 * A script run draws at its smaller glyph size, raised or lowered, but its line keeps the
 * run's full-size ascent above the baseline and full-size descent below it, as if the run sat
 * on the baseline at its own size ({@link lineBoxStyleOf}). Superscript and subscript count the
 * same, on every line of the paragraph, whether or not the paragraph mark is superscript or
 * subscript too. Returns how far the baseline moved down, so the caller can move the glyph
 * band with it.
 *
 * A paragraph mark never grows a line that holds content, whether its size is direct or comes
 * from its character style; only a line with nothing on it takes the mark's height, and the
 * caller sizes that line from the mark. The paragraph's run cascade is no floor either: 8pt
 * text with an 8pt superscript keeps the 8pt line under a 12pt cascade.
 */
export function growScriptLineMetrics(
  line: {
    height: number;
    baseline: number;
    readonly spans: readonly (Pick<StyleSpanRecord, 'noteSeparator' | 'fieldAtom'> & {
      readonly text: string;
      readonly style: ResolvedRunStyle;
      readonly fontSlot?: FontSlot;
    })[];
  },
  measurer: Pick<TextMeasurer, 'lineMetrics'>
): number {
  let ascent = line.baseline;
  let descent = line.height - line.baseline;
  for (const span of line.spans) {
    if (span.style.verticalAlign === 'baseline' || !TEXT_GLYPH.test(span.text)) continue;
    const metrics = measurer.lineMetrics(
      styleForFontSlot(lineBoxStyleOf(span.style), span.fontSlot),
      lineBandText(span, span.text)
    );
    ascent = Math.max(ascent, metrics.baseline);
    descent = Math.max(descent, metrics.height - metrics.baseline);
  }
  const raised = ascent - line.baseline;
  line.baseline = ascent;
  line.height = ascent + descent;
  return raised;
}
