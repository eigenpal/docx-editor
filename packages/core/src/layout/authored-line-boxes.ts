import { layoutRunHalfPointsOf } from './layout-run-shape.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from './run-style.ts';

// The single-spaced line box of an authored family that hosts rarely have.
//
// With no face of its own, a run measures its line on whatever face the fallback picks, and
// that face's ascent and descent move every line and every page break. The authored face's
// box is a property of the family, so it is recorded here and kept whatever face draws the
// glyphs, the way a packaged plan's `lineMetrics` keeps it for its substitute. Widths are not
// recorded: they need the face, and a face that is not metric-compatible would trade one
// error for another. Values are `hhea` ascent, descent and line gap in 2048ths of an em, the
// same for every style of the family. Numbers only; no font data.
const LINE_BOXES: ReadonlyMap<string, readonly [number, number, number]> = new Map([
  ['garamond', [1765, 539, 0]],
]);

/**
 * The authored family's line box at the run's size, or undefined when the family is not
 * recorded. Only for a run whose family resolved to no face: a face the host supplied for
 * the family carries its own box.
 */
export function authoredLineBox(
  style: ResolvedRunStyle
): { readonly height: number; readonly baseline: number } | undefined {
  const box = LINE_BOXES.get(style.fontFamily?.trim().toLowerCase() ?? '');
  if (!box) return undefined;
  const [ascent, descent, gap] = box;
  const sizePt = (layoutRunHalfPointsOf(style) / 2) * glyphSizeFactorOf(style);
  if (!(sizePt > 0)) return undefined;
  return {
    height: ((ascent + descent + gap) / 2048) * sizePt,
    baseline: ((ascent + gap) / 2048) * sizePt,
  };
}
