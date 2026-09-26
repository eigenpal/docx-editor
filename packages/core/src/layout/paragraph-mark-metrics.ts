import type { ResolvedRunStyle } from './run-style.ts';
import { lineBandText } from './pending-line.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { styleForFontSlot, type FontSlot } from './script-itemization.ts';

/** A character that draws text: not a space, tab, break, or object placeholder. */
const TEXT_GLYPH = /[^ \t\n\r\f\v\uFFFC]/u;

/**
 * The height a paragraph's last line keeps below its glyphs when it holds super- or subscript
 * text, or 0 when it holds none.
 *
 * A paragraph mark never grows a line that holds content, whether its size is direct or comes
 * from its character style. Under a 24pt mark, 12pt text keeps a 12pt line in body text and
 * in a table cell, in compatibility modes 14 and 15 and with no mode set. So do 12pt
 * superscript, subscript and mixed text, a 10pt inline picture, and an equation. Only a line
 * with nothing on it takes the mark's height, and the caller sizes that line from the mark.
 *
 * A script run measures at its smaller glyph size, so its line keeps one ordinary floor: each
 * script run at its full size. Under a 24pt or a 12pt mark, a 12pt superscript line is as tall
 * as a 12pt text line, also when the cascade is 8pt. The paragraph's run cascade is no floor:
 * 8pt text with an 8pt superscript keeps the 8pt line under a 12pt cascade, with an 8pt mark,
 * a 24pt mark or no mark. A superscript or subscript mark (`markVerticalAlign`) keeps the
 * smaller glyph size.
 */
export function scriptLineFloor(
  spans: readonly (Pick<StyleSpanRecord, 'noteSeparator' | 'fieldAtom'> & {
    readonly text: string;
    readonly style: ResolvedRunStyle;
    readonly fontSlot?: FontSlot;
  })[],
  markVerticalAlign: ResolvedRunStyle['verticalAlign'],
  measurer: Pick<TextMeasurer, 'lineMetrics'>
): number {
  let floor = 0;
  for (const span of spans) {
    if (span.style.verticalAlign === 'baseline' || !TEXT_GLYPH.test(span.text)) continue;
    const fullSize = { ...span.style, verticalAlign: markVerticalAlign };
    floor = Math.max(
      floor,
      measurer.lineMetrics(styleForFontSlot(fullSize, span.fontSlot), lineBandText(span, span.text))
        .height
    );
  }
  return floor;
}
