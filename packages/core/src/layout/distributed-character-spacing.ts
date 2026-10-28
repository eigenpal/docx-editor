// Character distribution for the lines of a distributed paragraph.
//
// When the document selects it (`distributed-spacing.ts`), a distributed paragraph (`w:jc
// w:val="distribute"`) sets every line across its measure character by character: each space
// first takes a bounded share of the slack, and the rest goes in equal steps after every
// character. A line whose slack its spaces can absorb therefore sets as a justified line. The
// gaps are real span geometry, as in East Asian justification, so paint, PDF export, the caret
// and hit testing read one layout.
import { authoredCjkGapMetric } from './cjk-auto-spacing-metric-port.ts';
import { knownFamilyReverseGap } from './authored-average-widths.ts';
import type { DistributedSpacing } from './distributed-spacing.ts';
import { segmentGraphemes } from './grapheme.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { isSplittableSpan, splitSpanParts } from './span-parts.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** In `'characters'` spacing, how much of its own advance a U+0020 takes from the slack first. */
export const SPACE_SHARE_LIMIT = 0.45;

/**
 * How much of the slack one U+0020 takes before any character gap does. In
 * `'legacyCharacters'` spacing it is the face's average character width less the space's own
 * advance; a face with no known average width takes the `'characters'` share instead.
 */
function spaceCapacity(
  space: StyleSpanRecord,
  own: number,
  measurer: TextMeasurer,
  spacing: Exclude<DistributedSpacing, 'spaces'>
): number {
  if (spacing === 'characters') return SPACE_SHARE_LIMIT * own;
  const style = styleForFontSlot(space.style, space.fontSlot);
  // The average width is twice the reverse automatic-spacing gap, which is half of it.
  const half = authoredCjkGapMetric(measurer, style) ?? knownFamilyReverseGap(style);
  return half === undefined ? SPACE_SHARE_LIMIT * own : Math.max(0, 2 * half - own);
}

const VISIBLE_WIDTH_PT = 1e-6;

/** Characters that take no room and open no gap. */
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/u;

/**
 * Whether the spaces of `spans[0, contentEnd)` can take all of `slack` within their share. The
 * line then sets as a justified line with no character gap, so the caller stretches its spaces
 * and splits nothing. Reads the spans as {@link distributeLineCharacters} would split them.
 */
export function spacesAbsorbSlack(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  slack: number,
  contentEnd: number,
  spacing: Exclude<DistributedSpacing, 'spaces'>
): boolean {
  let capacity = 0;
  let pending = 0;
  let seen = false;
  for (let index = 0; index < contentEnd; index++) {
    const span = spans[index]!;
    if (!isSplittableSpan(span) || span.style.shaping?.direction === 'rtl') {
      if (span.box.width > VISIBLE_WIDTH_PT) {
        if (seen) capacity += pending;
        pending = 0;
        seen = true;
      }
      continue;
    }
    let own: number | undefined;
    for (const character of span.text) {
      if (character === ' ') {
        if (!seen) continue;
        own ??= measureDisplayText(' ', styleForFontSlot(span.style, span.fontSlot), measurer);
        pending += spaceCapacity(span, own, measurer, spacing);
      } else if (!ZERO_WIDTH.test(character)) {
        if (seen) capacity += pending;
        pending = 0;
        seen = true;
      }
    }
  }
  return capacity > 0 && slack <= capacity;
}

/** Only U+0020 takes a space share; other spaces act as characters. */
function isSpace(span: StyleSpanRecord): boolean {
  return span.text === ' ';
}

function isVisible(span: StyleSpanRecord): boolean {
  return span.box.width > VISIBLE_WIDTH_PT;
}

/**
 * Split each span into its grapheme clusters. Right-to-left text keeps its letters joined, and
 * spans that cannot split ({@link isSplittableSpan}) stay whole and act as one character.
 */
function characterPieces(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer
): StyleSpanRecord[] {
  const pieces: StyleSpanRecord[] = [];
  for (const span of spans) {
    const clusters =
      isSplittableSpan(span) && span.style.shaping?.direction !== 'rtl'
        ? segmentGraphemes(span.text)
        : [];
    if (clusters.length < 2) {
      pieces.push(span);
      continue;
    }
    const parts = clusters.map((cluster, index) => ({
      from: cluster.utf16From,
      to: clusters[index + 1]?.utf16From ?? span.text.length,
    }));
    pieces.push(...splitSpanParts(span, parts, measurer));
  }
  return pieces;
}

/**
 * Spread `slack` over the characters of `spans[0, contentEnd)`, the line's content without
 * its hanging whitespace and closing breaks, with the space share `spacing` selects. Spaces before the first character and after the
 * last one keep their natural advance. The spans from `contentEnd` on move with the last
 * character.
 *
 * Returns null when the content has no gap between two characters, such as a single
 * character or a single right-to-left word. The caller then centers the line.
 */
export function distributeLineCharacters(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  slack: number,
  contentEnd: number,
  spacing: Exclude<DistributedSpacing, 'spaces'> = 'characters'
): readonly StyleSpanRecord[] | null {
  const pieces = characterPieces(spans.slice(0, contentEnd), measurer);
  let first = -1;
  let last = -1;
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!;
    if (!isVisible(piece) || isSpace(piece)) continue;
    if (first < 0) first = index;
    last = index;
  }
  if (first < 0 || first === last) return null;
  // A gap opens before every visible character after the first.
  let gaps = 0;
  const capacities = new Map<number, number>();
  let totalCapacity = 0;
  for (let index = first + 1; index <= last; index++) {
    const piece = pieces[index]!;
    if (!isVisible(piece)) continue;
    gaps += 1;
    if (index < last && isSpace(piece)) {
      const capacity = spaceCapacity(piece, piece.box.width, measurer, spacing);
      capacities.set(index, capacity);
      totalCapacity += capacity;
    }
  }
  // Spaces fill first, in proportion to their capacity, up to it.
  const spaceShare = totalCapacity > 0 ? Math.min(1, slack / totalCapacity) : 0;
  const step = (slack - spaceShare * totalCapacity) / gaps;
  let shift = 0;
  const placed = pieces.map((piece, index) => {
    if (index > first && index <= last && isVisible(piece)) shift += step;
    const moved = shift === 0 ? piece : { ...piece, box: { ...piece.box, x: piece.box.x + shift } };
    shift += spaceShare * (capacities.get(index) ?? 0);
    return moved;
  });
  for (let index = contentEnd; index < spans.length; index++) {
    const span = spans[index]!;
    placed.push({ ...span, box: { ...span.box, x: span.box.x + shift } });
  }
  return placed;
}
