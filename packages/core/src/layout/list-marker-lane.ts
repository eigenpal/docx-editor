// Which run-formatting lane sizes a list marker: Latin (`w:sz`) or complex script (`w:szCs`).

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { resolveRunStyle, type ResolvedRunStyle, type ThemeFonts } from './run-style.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';

/**
 * Resolve a list marker's run style from its cascaded run properties (the paragraph mark's,
 * then the level's `w:rPr`) and its paragraph's properties.
 *
 * - A right-to-left paragraph (`w:bidi`, `CT_OnOff`, ECMA-376 Part 1 17.3.1.6) sizes its
 *   marker from the complex-script lane: `w:szCs` (17.3.2.39), `w:bCs`, and `w:iCs`, not
 *   `w:sz` (17.3.2.38), `w:b`, and `w:i`. The marker keeps its Latin face, so a symbol
 *   bullet still draws in its symbol font.
 * - `w:cs` (17.3.2.7) on the marker selects the whole complex-script lane, face included, as
 *   it does for text.
 * - `w:rtl` (17.3.2.30) on the paragraph mark or the level does not select the lane for the
 *   marker, so it is ignored here.
 */
export function listMarkerRunStyle(
  runProperties: readonly OoxmlProperty[],
  paragraphProperties: readonly OoxmlProperty[],
  themeFonts: ThemeFonts | undefined
): ResolvedRunStyle {
  const style = resolveRunStyle(
    runProperties.filter((property) => property.localName !== 'rtl'),
    themeFonts
  );
  // `latinLane` is set only when `w:cs` already moved the whole style to the complex lane.
  if (style.latinLane || !paragraphIsRtl(paragraphProperties) || !style.complexLane) return style;
  const { fontSizePt, bold, italic } = style.complexLane;
  return { ...style, fontSizePt, bold, italic };
}
