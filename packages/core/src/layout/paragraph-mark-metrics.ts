import type { ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';
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
 * A script run measures at its smaller glyph size, so its line keeps two ordinary floors. One
 * is the mark (`mark`, without its character style) at the size of the paragraph's run
 * cascade, never at the mark's own size. The other is each script run at its full size: under
 * a 24pt or a 12pt mark, a 12pt superscript line is as tall as a 12pt text line, also when the
 * cascade is 8pt. A superscript or subscript mark keeps both at the smaller glyph size.
 */
export function scriptLineFloor(
  spans: readonly {
    readonly text: string;
    readonly style: ResolvedRunStyle;
    readonly fontSlot?: FontSlot;
  }[],
  mark: ResolvedRunStyle,
  cascade: ResolvedRunStyle,
  measurer: Pick<TextMeasurer, 'lineMetrics' | 'hasResolvedFont'>
): number {
  if (spans.every((span) => span.style.verticalAlign === 'baseline')) return 0;
  const ordinary =
    mark.fontSizePt === cascade.fontSizePt ? mark : { ...mark, fontSizePt: cascade.fontSizePt };
  let floor =
    measurer.hasResolvedFont?.(ordinary) === false
      ? 0
      : measurer.lineMetrics(ordinary, paragraphMarkSampleText(spans, ordinary)).height;
  for (const span of spans) {
    if (span.style.verticalAlign === 'baseline' || !TEXT_GLYPH.test(span.text)) continue;
    const fullSize = { ...span.style, verticalAlign: mark.verticalAlign };
    floor = Math.max(
      floor,
      measurer.lineMetrics(styleForFontSlot(fullSize, span.fontSlot), span.text).height
    );
  }
  return floor;
}

/** Hebrew, Arabic, Syriac, Thaana and N'Ko letters, and their presentation forms. */
const RIGHT_TO_LEFT_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;

/**
 * The text a nonempty line measures its paragraph mark with, or undefined for the mark face.
 *
 * A mark after a right-to-left letter its face lacks takes the face that draws the letter:
 * Hebrew in an Arabic face ends on a serif fallback, and the line keeps that face's height
 * rather than the Arabic face's taller one. An empty paragraph keeps the mark face's own.
 * Only a mark in the same face as that letter's run follows it; a mark in another face
 * keeps its own height.
 */
function paragraphMarkSampleText(
  spans: readonly {
    readonly text: string;
    readonly style: ResolvedRunStyle;
    readonly fontSlot?: FontSlot;
  }[],
  markStyle: ResolvedRunStyle
): string | undefined {
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index]!;
    const last = Array.from(span.text.trimEnd()).at(-1);
    if (last === undefined) continue;
    if (!RIGHT_TO_LEFT_LETTER.test(last)) return undefined;
    const face = (style: ResolvedRunStyle) => styleForFontSlot(style, span.fontSlot).fontFamily;
    return face(span.style) === face(markStyle) ? last : undefined;
  }
  return undefined;
}
