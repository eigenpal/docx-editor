// Character distribution for the closing lines of a distributed paragraph.
//
// When the styles part authors a `w:rPrDefault`, a distributed paragraph (`w:jc
// w:val="distribute"`) sets its last line, and every line a break closes, across the whole
// measure character by character: each space first takes up to SPACE_SHARE_LIMIT of its own
// advance, and the rest of the slack goes in equal steps after every character. The gaps are
// real span geometry, as in East Asian justification, so paint, PDF export, the caret and hit
// testing read one layout.
import { segmentGraphemes } from './grapheme.ts';
import { isSplittableSpan, splitSpanParts } from './span-parts.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** How much of its own advance a U+0020 takes from the slack before any character gap does. */
export const SPACE_SHARE_LIMIT = 0.45;

const VISIBLE_WIDTH_PT = 1e-6;

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
 * its hanging whitespace and closing breaks. Spaces before the first character and after the
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
  contentEnd: number
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
  let spaceCapacity = 0;
  for (let index = first + 1; index <= last; index++) {
    const piece = pieces[index]!;
    if (!isVisible(piece)) continue;
    gaps += 1;
    if (isSpace(piece)) spaceCapacity += SPACE_SHARE_LIMIT * piece.box.width;
  }
  // Spaces fill first, in proportion to their advance, up to their limit.
  const spaceShare = spaceCapacity > 0 ? Math.min(1, slack / spaceCapacity) : 0;
  const step = (slack - spaceShare * spaceCapacity) / gaps;
  let shift = 0;
  const placed = pieces.map((piece, index) => {
    if (index > first && index <= last && isVisible(piece)) shift += step;
    const moved = shift === 0 ? piece : { ...piece, box: { ...piece.box, x: piece.box.x + shift } };
    if (index > first && index < last && isSpace(piece)) {
      shift += spaceShare * SPACE_SHARE_LIMIT * piece.box.width;
    }
    return moved;
  });
  for (let index = contentEnd; index < spans.length; index++) {
    const span = spans[index]!;
    placed.push({ ...span, box: { ...span.box, x: span.box.x + shift } });
  }
  return placed;
}
