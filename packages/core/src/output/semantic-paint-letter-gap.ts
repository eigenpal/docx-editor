// Gaps alignment opens between the letters of one split span.
//
// Distributed and East Asian justified lines split a span into one span per character and
// move them apart. Paint draws such a gap inside the letter before it, as `letter-spacing`,
// because the browser decorates and highlights letter spacing but never a margin: underline,
// highlight, and revision marks then run on across the gap.
import { segmentGraphemes } from '../layout/grapheme.ts';
import type { StyleSpanRecord } from '../layout/semantic-records.ts';

/**
 * Whether the gap between `span` and `next` can paint as letter spacing on `span`: `span` is
 * one visible character whose source range `next` continues, at full horizontal scale, and no
 * float advance separates them. The caller also checks that both share one anchor.
 *
 * A span whose painted box has a fixed width cannot grow with letter spacing, so its gap stays
 * a margin on the next span. Compressed East Asian punctuation is such a span: it carries
 * `glyphOffsetPt` and paints its published width (`prepareTextPaintHost`).
 */
export function absorbsLetterGap(span: StyleSpanRecord, next: StyleSpanRecord): boolean {
  if (span.projected || span.equation || span.unsupported || next.projected) return false;
  if (span.glyphOffsetPt !== undefined) return false;
  if (span.range.paragraphId !== next.range.paragraphId) return false;
  if (span.range.end !== next.range.start || span.range.end - span.range.start !== span.text.length)
    return false;
  if (span.style.horizontalScalePercent !== 100) return false;
  if ((next.wrapAdvanceBefore ?? 0) > 0.001) return false;
  if (span.text.trim() === '' || segmentGraphemes(span.text).length !== 1) return false;
  return true;
}

/** The `letter-spacing` that paints `gap` after the character: its own spacing plus the gap. */
export function letterGapSpacing(span: StyleSpanRecord, gap: number, scale: number): string {
  return `${(span.style.characterSpacingPt + gap) * scale}px`;
}
