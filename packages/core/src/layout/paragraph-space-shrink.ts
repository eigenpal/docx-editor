// Space compression adapted from PR #707's paragraph-justify.ts (2ce89f6e7).
// Publish spacing in Core so PDF, browser paint, and caret measurement agree.
// The format's producers use a 75% space floor and prefer expansion near natural spacing.
// An open reference implementation of the same rule:
// https://github.com/LibreOffice/core/commit/529755f0919217a84a12daad0fddfddd1124f0e9
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { isSpaceShrinkWordPiece } from './space-shrink-piece.ts';
import { withoutTrailingZeroWidthSpaces } from './trailing-spaces.ts';

// No-break spaces join their neighbours into one word. They have width, never break the
// line, and never hang, so the word-shape tests read them as word characters.
const WORD_CHARACTER = String.raw`[\S\u00a0\u2007\u202f]`;
// A span holding U+00A0 lends none of its space: screen paint applies `word-spacing` to
// U+00A0 as well, so its shrink would be painted twice. The narrow forms are unaffected.
const SPACED_SPAN = /^[\S\u2007\u202f]* \u200b*$/u;
const SPACED_WORD = new RegExp(`^${WORD_CHARACTER}+ \u200b*$`, 'u');
const BARE_WORD = new RegExp(`^${WORD_CHARACTER}+$`, 'u');

/**
 * The text before its space slot: the final U+0020 and any zero-width spaces after it. A
 * zero-width space after the space takes no room, so the space still lends, and the word
 * before it is still a spaced word.
 */
const withoutSpaceSlot = (text: string): string =>
  withoutTrailingZeroWidthSpaces(text).slice(0, -1);

/**
 * Whether a candidate ends at the break after a hyphen inside a word ("well-" of
 * "well-known"). That fragment can borrow inter-word space as a whole word does.
 */
export function endsAtHyphenBreak(candidate: string): boolean {
  return /\p{L}[-‐]$/u.test(candidate);
}

/**
 * Probe the current passage of a left-to-right paragraph without borrowing spaces across a
 * float. Right-to-left runs inside the paragraph do not change the passage; only a
 * right-to-left paragraph keeps its existing alignment path across floats.
 */
export function createShrinkProbe<Zone>(
  zones: () => readonly Zone[],
  intervals: (
    zones: readonly Zone[]
  ) => readonly { readonly start: number; readonly end: number }[],
  paragraphRtl: boolean
): (penX: number) => number | undefined {
  return (penX) => {
    const active = zones();
    if (active.length === 0) return undefined;
    if (paragraphRtl) return Infinity;
    return (
      intervals(active).find(
        (interval) => penX >= interval.start - 0.001 && penX <= interval.end + 0.001
      )?.start ?? Infinity
    );
  };
}

/**
 * The first span whose space can shrink. Only the text after a line's last tab is
 * justified; a tab and everything before it keep their positions.
 */
function firstShrinkSlot(spans: readonly StyleSpanRecord[]): number {
  for (let index = spans.length - 1; index >= 0; index -= 1)
    if (spans[index]!.text.includes('\t')) return index + 1;
  return 0;
}

function capacity(span: StyleSpanRecord, measurer: TextMeasurer): number {
  if (
    (!span.style.shaping &&
      !/^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}\p{P}\p{Sc}\p{Sm} \u2007\u202f\u200b]*$/u.test(
        span.text
      )) ||
    span.lineEndWhitespace ||
    !SPACED_SPAN.test(span.text) ||
    span.equation
  )
    return 0;
  const style = styleForFontSlot(span.style, span.fontSlot);
  const space = Math.max(
    0,
    span.box.width - measureDisplayText(withoutSpaceSlot(span.text), style, measurer)
  );
  const minimum = space * 0.75;
  return space - minimum;
}

/**
 * Only an ordinary word followed by a space, or the paragraph's last word, can borrow
 * existing inter-word space.
 *
 * A word that straddles a source-run seam — a quoted bold term, a semicolon left in
 * the next run — overflows on a later piece than the one that opened it. The kept
 * line still runs to `lineWidth`, but the line the reference would produce instead
 * ends where the word began, so `wordStart`/`wordStartWidth` describe that
 * alternative. Their defaults are the values the caller already holds when the
 * overflowing candidate opens the word, so that path measures exactly as before.
 *
 * `wordEnds` says the next character is a space, in this run or at the start of the
 * next one, or that only hanging spaces remain in the paragraph. A candidate without its
 * own space is then a complete word: a space in its own run, or one split off by East
 * Asian break rules, hangs at the line end exactly as a space inside the candidate would,
 * and the paragraph's last word borrows space as any other word does.
 * `followingWidth` measures the remainder of that same word in later plain-text pieces.
 * It lets an overflowing opening fragment use the complete word's fit decision.
 */
export function fitsWithSpaceShrink(
  spans: readonly StyleSpanRecord[],
  candidate: string,
  style: ResolvedRunStyle,
  measurer: TextMeasurer,
  lineWidth: number,
  available: number,
  wordStart: number = spans.length,
  wordStartWidth: number = lineWidth,
  wordEnds = false,
  followingWidth = 0,
  passageStart?: number
): boolean {
  const ownSpace = SPACED_WORD.test(candidate);
  // Earlier passages own their spaces. The pen can already have stepped over a
  // float while this passage still has no spans, so an empty suffix cannot lend.
  const passageFirst =
    passageStart === undefined ? 0 : spans.findIndex((span) => span.box.x >= passageStart - 0.001);
  if (
    !(ownSpace || (wordEnds && BARE_WORD.test(candidate))) ||
    passageFirst < 0 ||
    wordStart < passageFirst ||
    spans.some(
      (span, index) =>
        index >= passageFirst &&
        (span.equation ||
          ((passageStart === undefined || index > passageFirst) && span.wrapAdvanceBefore))
    )
  )
    return false;
  const first = Math.max(passageFirst, firstShrinkSlot(spans));
  const visible = measureDisplayText(
    ownSpace ? withoutSpaceSlot(candidate) : candidate,
    style,
    measurer
  );
  const needed = lineWidth + visible + followingWidth - available;
  if (needed <= 0) return false;
  // The alternative line stops before the overflowing word, so only the spans ahead
  // of it carry its stretch, and the space in front of it is the one that hangs.
  // One capacity per span serves the budget, the hanging space and the spaces ahead of the
  // word, each summed in span order; reading every span again measured each word again.
  const beforeEnd = Math.max(first, Math.min(wordStart, spans.length));
  const capacities: number[] = [];
  let budget = 0;
  for (let index = first; index < spans.length; index += 1) {
    const slot = capacity(spans[index]!, measurer);
    capacities.push(slot);
    budget += slot;
  }
  if (needed > budget + 0.001) return false;
  const spaceWidth = budget * 4;
  // Every space after the last word hangs there: a run of spaces as well as the word's own.
  let terminalSpace = 0;
  for (let index = beforeEnd - 1; index >= first; index -= 1) {
    terminalSpace += capacities[index - first]! * 4;
    if (!/^ +$/.test(spans[index]!.text)) break;
  }
  let beforeSpaces = 0;
  for (let index = first; index < beforeEnd; index += 1) {
    beforeSpaces += capacities[index - first]! * 4;
  }
  const existingSpaces = beforeSpaces - terminalSpace;
  if (existingSpaces <= 0) return false;
  const expansion = 1 + Math.max(0, available - wordStartWidth + terminalSpace) / existingSpaces;
  // Shrinking a space costs twice as much as stretching one: the word joins the line
  // when each space would lose at most half of what the shorter line would add to it.
  const shrink = needed / spaceWidth;
  return 2 * shrink <= expansion - 1 + 1e-9;
}

/**
 * Whether the candidate ending at `boundary` of `pieces[pieceIndex]` is the paragraph's
 * last word: only plain U+0020 spaces follow it, and they hang at the line end.
 *
 * One backward scan finds where that closing run of spaces begins. Any other piece (a
 * field result, positional tab, drawing, equation, reserved note mark or anchor) ends the scan
 * after itself, so no word before it is last. A tab, hard break or page break in plain
 * text is not a space either, and ends the scan the same way. Stable body citations
 * can complete the last word while retaining their atomic model ranges.
 */
export function paragraphEndAt(
  pieces: readonly FieldAwarePiece[]
): (pieceIndex: number, boundary: number) => boolean {
  let tailPiece = 0;
  let tailOffset = 0;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const piece = pieces[index]!;
    if (!isSpaceShrinkWordPiece(piece)) {
      tailPiece = index + 1;
      break;
    }
    let offset = piece.text.length;
    while (offset > 0 && piece.text[offset - 1] === ' ') offset -= 1;
    if (offset > 0) {
      tailPiece = index;
      tailOffset = offset;
      break;
    }
  }
  return (pieceIndex, boundary) =>
    pieceIndex > tailPiece || (pieceIndex === tailPiece && boundary >= tailOffset);
}

/**
 * Whether the candidate ending at `boundary` of `pieces[pieceIndex]` ends its line: it is the
 * paragraph's last word ({@link paragraphEndAt}), or only plain U+0020 spaces stand between it
 * and a text-wrapping break or a tab. The line compresses its spaces to keep that word, as the
 * paragraph's last line does; a tab that no longer fits then opens the next line.
 */
export function lineEndAt(
  pieces: readonly FieldAwarePiece[]
): (pieceIndex: number, boundary: number) => boolean {
  const endsParagraph = paragraphEndAt(pieces);
  const breakAhead = new Array<Uint8Array>(pieces.length);
  let follows = 0;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const piece = pieces[index]!;
    const ahead = new Uint8Array(piece.text.length + 1);
    const plain = isSpaceShrinkWordPiece(piece);
    ahead[piece.text.length] = plain ? follows : 0;
    for (let offset = piece.text.length - 1; offset >= 0; offset -= 1) {
      const ch = piece.text[offset];
      ahead[offset] = !plain
        ? 0
        : ch === '\n' || ch === '\t'
          ? 1
          : ch === ' '
            ? ahead[offset + 1]!
            : 0;
    }
    breakAhead[index] = ahead;
    follows = ahead[0]!;
  }
  return (pieceIndex, boundary) =>
    endsParagraph(pieceIndex, boundary) || breakAhead[pieceIndex]?.[boundary] === 1;
}

/**
 * True when `piece` opens with a U+0020 that can hang at a line end. Only a plain text
 * piece splits into candidates; a projected field result, positional tab, or reserved
 * measure is laid out whole, so its leading space would open the next line instead.
 */
export function opensWithHangingSpace(piece: FieldAwarePiece | undefined): boolean {
  return (
    piece !== undefined &&
    piece.text[0] === ' ' &&
    !piece.projected &&
    !piece.positionalTab &&
    piece.measureText === undefined &&
    piece.end - piece.start === piece.text.length
  );
}

/**
 * Compress eligible spaces evenly, respecting every face's minimum space advance.
 * Only spans before `slotEnd` are slots: the span there ends the content and its space hangs.
 */
export function shrinkJustifiedSpans(
  spans: readonly StyleSpanRecord[],
  needed: number,
  measurer: TextMeasurer,
  slotEnd: number = spans.length - 1
): readonly StyleSpanRecord[] {
  const first = firstShrinkSlot(spans);
  const capacities = spans.map((span, index) =>
    index >= first && index < slotEnd ? capacity(span, measurer) : 0
  );
  if (needed <= 0 || needed > capacities.reduce((a, b) => a + b, 0) + 0.001) return spans;
  const amounts = capacities.map(() => 0);
  let remaining = needed;
  for (let pass = 0; pass < capacities.length && remaining > 0.001; pass++) {
    const active = capacities
      .map((cap, index) => (cap - amounts[index]! > 0.001 ? index : -1))
      .filter((i) => i >= 0);
    if (!active.length) break;
    const step = remaining / active.length;
    for (const index of active) {
      const take = Math.min(step, capacities[index]! - amounts[index]!);
      amounts[index] += take;
      remaining -= take;
    }
  }
  let shift = 0;
  return spans.map((span, index) => {
    const amount = amounts[index]!;
    const result =
      shift || amount
        ? {
            ...span,
            box: { ...span.box, x: span.box.x - shift, width: span.box.width - amount },
            ...(amount
              ? {
                  style: {
                    ...span.style,
                    shaping: {
                      script: 'Latn',
                      direction: 'ltr' as const,
                      level: 0,
                      baseLevel: 0,
                      ...span.style.shaping,
                      wordSpacingPt: (span.style.shaping?.wordSpacingPt ?? 0) - amount,
                    },
                  },
                }
              : {}),
          }
        : span;
    shift += amount;
    return result;
  });
}
