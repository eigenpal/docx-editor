import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot, type FontSlot } from './script-itemization.ts';

/** A character that draws text: not a space, tab, break, or object placeholder. */
const TEXT_GLYPH = /[^ \t\n\r\f\v\uFFFC]/u;

/** Whether a paragraph piece draws text, so a line holding it never grows from the mark. */
export function pieceDrawsText(piece: {
  readonly text: string;
  readonly equation?: unknown;
  readonly inlineDrawing?: unknown;
}): boolean {
  return piece.equation === undefined && !piece.inlineDrawing && TEXT_GLYPH.test(piece.text);
}

/**
 * Whether the last line's paragraph mark adds its own height below the line's glyphs.
 *
 * A mark never grows a line that holds text, whether its size is direct or comes from its
 * character style: 12pt text under a 24pt mark keeps a 12pt line in body text and in a table
 * cell, in compatibility modes 14 and 15 and with no mode set. Only a line with nothing on
 * it takes the mark's height, and the caller sizes that line from the mark directly.
 *
 * Two floors remain. A super- or subscript line keeps the mark as its ordinary line-height
 * floor, and a line holding only an inline picture or an equation keeps the floor of a
 * directly formatted mark. Neither has a reference measurement that removes it.
 */
export function shouldIncludeParagraphMarkHeight(
  mark: readonly OoxmlProperty[],
  inherited: readonly OoxmlProperty[],
  spans: readonly { readonly text: string; readonly style: ResolvedRunStyle }[]
): boolean {
  if (spans.some((span) => span.style.verticalAlign !== 'baseline')) return true;
  if (spans.some((span) => TEXT_GLYPH.test(span.text))) return false;
  return !(mark === inherited || (mark.length === 0 && inherited.length === 0));
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
export function paragraphMarkSampleText(
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
