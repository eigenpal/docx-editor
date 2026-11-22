// The compressed trailing blank of a hanging line-end mark.
//
// With punctuation compression (`w:characterSpacingControl`), a full-width mark that hangs past
// the margin (`w:overflowPunct`) gives up its trailing blank: its highlight (`w:highlight`),
// shading (`w:shd`), underline (`w:u`), strike (`w:strike`), and tracked-change (`w:ins`,
// `w:del`) formatting stops before that blank, while the glyph, the span box, and caret edges keep their places.
// Screen paint clips the formatting and the PDF writer shortens it, so both outputs read one
// rule, {@link hangingMarkBlankAt}.
import type { StyleSpanRecord } from '../layout/semantic-records.ts';

/**
 * The span fields {@link hangingMarkBlankAt} reads: a `StyleSpanRecord` satisfies it.
 *
 * @internal
 */
export interface HangingMarkSpan {
  readonly box: { readonly width: number };
  readonly lineEndWhitespace?: true;
  readonly style: { readonly shaping?: { readonly baseLevel?: number } | null };
}

/**
 * The line fields {@link hangingMarkBlankAt} reads: a `LineRecord` satisfies it.
 *
 * @internal
 */
export interface HangingMarkLine {
  readonly spans: readonly HangingMarkSpan[];
  readonly hangingMarkBlank?: number;
}

/**
 * The width, in points, at the end of `span` that its formatting leaves unpainted: the
 * compressed trailing blank of the hanging mark that ends `line` (`LineRecord.hangingMarkBlank`).
 * Zero for every other span and on lines in a right-to-left paragraph (`w:bidi`).
 *
 * @internal
 */
export function hangingMarkBlankAt(line: HangingMarkLine, span: HangingMarkSpan): number {
  const blank = line.hangingMarkBlank;
  if (!blank || line.spans.some((each) => each.style.shaping?.baseLevel === 1)) return 0;
  for (let index = line.spans.length - 1; index >= 0; index -= 1) {
    const each = line.spans[index]!;
    // Clipped authored spaces and zero-width spans, such as a manual break, follow the mark.
    if (each.lineEndWhitespace || each.box.width <= 0.001) continue;
    return each === span ? Math.min(blank, span.box.width) : 0;
  }
  return 0;
}

/**
 * Clip a painted span's formatting to the part before its compressed trailing `blank`. The clip is
 * measured from the span's left edge, so the browser's own advance cannot move it. Layout keeps
 * the blank clear of the glyph's ink, and the vertical and left insets stay open for glyph
 * overhang and underlines.
 *
 * The clip also ends the native selection band and pointer hits on the run before the blank.
 * The caret and hit-testing read layout geometry, so a click there still lands after the mark.
 */
export function clipHangingMarkBlank(
  painted: HTMLElement,
  span: StyleSpanRecord,
  blank: number,
  scale: number
): void {
  // A horizontally scaled span clips in its own unscaled coordinates.
  const horizontalScale = painted.style.transform ? span.style.horizontalScalePercent / 100 : 1;
  const kept = Math.max(0, ((span.box.width - blank) * scale) / horizontalScale);
  painted.style.clipPath = `inset(-1em calc(100% - ${kept}px) -1em -1em)`;
}
