import type { ResolvedFont } from './font-resource.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { ShapedRun } from './shaped-run.ts';

/**
 * Extra advance of each inked glyph when bold is synthesized, as a fraction of the font size.
 *
 * A face without a bold style draws bold by thickening its outlines, and each glyph that has
 * ink then advances 1/50 em further. Blank glyphs such as spaces keep their advance. Measured
 * on Arabic text at 10, 20, 30, and 36 pt: the extra width matched this rule to the pixel.
 *
 * @public
 */
export const SYNTHETIC_BOLD_ADVANCE_EM = 1 / 50;

/** Whether a bold run is drawn with a face that has no bold style. */
export function isSyntheticBold(style: ResolvedRunStyle, font: ResolvedFont): boolean {
  return style.bold === true && font.request.weight < 600;
}

/** Whether a shaped glyph draws ink and advances: the glyphs synthesized bold widens. */
function inked(glyph: ShapedRun['glyphs'][number]): boolean {
  return glyph.advanceX > 0 && glyph.outline.path.length > 0;
}

/** How many glyphs of a run synthesized bold widens. */
export function syntheticBoldGlyphCount(run: ShapedRun): number {
  let count = 0;
  for (const glyph of run.glyphs) if (inked(glyph)) count++;
  return count;
}

/**
 * Caret advances with the synthesized bold extra added: the advance at each UTF-16 offset
 * grows by `extraPt` for every widened glyph whose cluster starts before that offset.
 */
export function withSyntheticBoldCaretAdvances(
  advances: readonly number[],
  run: ShapedRun,
  extraPt: number
): readonly number[] {
  if (extraPt <= 0) return advances;
  const perOffset = new Array<number>(advances.length).fill(0);
  for (const glyph of run.glyphs) {
    if (!inked(glyph)) continue;
    const at = Math.min(Math.max(glyph.cluster + 1, 1), advances.length - 1);
    perOffset[at]! += extraPt;
  }
  let added = 0;
  return advances.map((advance, offset) => {
    added += perOffset[offset]!;
    return advance + added;
  });
}
