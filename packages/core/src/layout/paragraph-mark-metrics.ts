import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot, type FontSlot } from './script-itemization.ts';

/** Explicit mark formatting and script paragraphs retain their ordinary line-height floor. */
export function shouldIncludeParagraphMarkHeight(
  mark: readonly OoxmlProperty[],
  inherited: readonly OoxmlProperty[],
  spans: readonly { readonly style: ResolvedRunStyle }[]
): boolean {
  return !(
    (mark === inherited || (mark.length === 0 && inherited.length === 0)) &&
    spans.every((span) => span.style.verticalAlign === 'baseline')
  );
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
