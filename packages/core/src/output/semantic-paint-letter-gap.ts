// Which span owns the gap alignment opens after it.
//
// Justified lines open gaps after spaces, and distributed and East Asian justified lines split
// a span into one span per character and move them apart. Screen paint draws a gap the span
// before it owns inside that span, as `word-spacing` or `letter-spacing`, because the browser
// decorates and highlights both but never a margin: underline, strike, highlight, shading, and
// revision marks then run on across the gap. The PDF writer extends the same marks over the
// same gaps, so both outputs read one rule, {@link followingGapPaint}.
import { segmentGraphemes } from '../layout/grapheme.ts';
import type { StyleSpanRecord } from '../layout/semantic-records.ts';
import { withoutTrailingZeroWidthSpaces } from '../layout/trailing-spaces.ts';

/**
 * The fields of a laid span that decide whether it owns the gap after it. A
 * `StyleSpanRecord` is one.
 *
 * @internal
 */
export interface GapSpan {
  readonly text: string;
  readonly range: { readonly paragraphId: string; readonly start: number; readonly end: number };
  readonly style: { readonly horizontalScalePercent: number };
  readonly link?: { readonly id: string };
  readonly fieldAtom?: { readonly resultStart?: number };
  readonly wrapAdvanceBefore?: number;
  readonly glyphOffsetPt?: number;
  readonly projected?: boolean;
  readonly equation?: unknown;
  readonly unsupported?: unknown;
}

/**
 * How a span paints the gap after it, before `next`: `'wordSpacing'` stretches its trailing
 * space, `'letterSpacing'` widens its one character, and null leaves the gap a margin on
 * `next`, which marks do not cover. A span that owns the gap draws its marks across it.
 *
 * @internal
 */
export function followingGapPaint(
  span: GapSpan,
  next: GapSpan
): 'wordSpacing' | 'letterSpacing' | null {
  if (absorbsFollowingGap(span, next)) return 'wordSpacing';
  return sharesAnchor(span, next) && absorbsLetterGap(span, next) ? 'letterSpacing' : null;
}

/**
 * Whether the gap between `span` and `next` can paint as letter spacing on `span`: `span` is
 * one visible character whose source range `next` continues, at full horizontal scale, and no
 * float advance separates them. The caller also checks that both share one anchor.
 *
 * A span whose painted box has a fixed width cannot grow with letter spacing, so its gap stays
 * a margin on the next span. Compressed East Asian punctuation is such a span: it carries
 * `glyphOffsetPt` and paints its published width (`prepareTextPaintHost`).
 */
export function absorbsLetterGap(span: GapSpan, next: GapSpan): boolean {
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

/**
 * Every character an engine's `word-spacing` may move. U+0020 and NBSP expand in Chromium,
 * WebKit and Gecko alike; a tab expands in Chromium and Gecko (fourfold — it is four
 * advances). The rest is the CSS Text 3 word-separator list, kept in case an engine starts
 * honouring it; U+3000 is deliberately absent — no engine expands it, and refusing it would
 * forfeit the stretch on CJK text for nothing.
 */
const WORD_SEPARATOR = /[\t\n\r \u00A0\u1361\u{10100}-\u{10102}\u{1039F}\u{1091F}]/u;

/**
 * Whether the justify gap AFTER this span can be painted as `word-spacing` on the span
 * itself, stretching its trailing space, instead of as a margin on the next span.
 *
 * The stretch must move ONLY the trailing space. Layout puts justify slack after expandable
 * U+0020s (and any U+200B after) and word-breaks after each, so an ordinary span qualifies —
 * including a projected field result, whose box was reserved from the drawn text like any
 * other. A span carrying any OTHER word separator keeps the margin, whose only cost is a
 * seam in the native selection band. A span with a forced width (`w:w` horizontal scaling)
 * cannot grow its box, so it keeps the margin too.
 *
 * The stretch also lives inside the span's ANCHOR and on its side of a float. A link's last
 * span stretching over the gap would extend the `<a>` hit target across blank slack — a
 * click there would follow the link — so both spans must share one anchor, or have none.
 * And a wrap advance is painted BETWEEN the spans, so stretching across it would draw the
 * slack (and this span's underline and shading) inside the float's exclusion zone.
 */
function absorbsFollowingGap(span: GapSpan, next: GapSpan): boolean {
  const text = withoutTrailingZeroWidthSpaces(span.text);
  if (!text.endsWith(' ')) return false;
  if (span.style.horizontalScalePercent !== 100) return false;
  if (!sharesAnchor(span, next)) return false;
  if ((next.wrapAdvanceBefore ?? 0) > 0.001) return false;
  return !WORD_SEPARATOR.test(text.slice(0, -1));
}

/**
 * Whether two adjacent spans land in the same painted anchor, mirroring the anchor-opening
 * rules in {@link paintLine}: both linkless, or the same link id — and for field atoms the
 * same field (same model start), because two discrete fields share a content-keyed id.
 */
export function sharesAnchor(a: GapSpan, b: GapSpan): boolean {
  if (!a.link && !b.link) return true;
  if (!a.link || !b.link || a.link.id !== b.link.id) return false;
  if (Boolean(a.fieldAtom) !== Boolean(b.fieldAtom)) return false;
  return !a.fieldAtom || fieldAnchorStart(a) === fieldAnchorStart(b);
}

/** The model offset that identifies a field's link anchor: its result's start, or its unit. */
export function fieldAnchorStart(span: GapSpan): number {
  return span.fieldAtom?.resultStart ?? span.range.start;
}
