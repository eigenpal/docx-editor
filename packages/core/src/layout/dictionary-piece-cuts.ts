// Word cuts found in paragraph text and mapped back to the pieces that hold it, shared by
// line breaking (`dictionary-paragraph-breaks.ts`) and table AutoFit minimums.
//
// Plain text is segmented across pieces, so a formatting or revision seam inside a word adds
// no cut and a seam between words keeps its cut. The space, zero-width-space, dash, and tab
// rules read the same text, so a dash that opens a run still breaks after itself. A
// layout-owned piece (a field result, picture, equation, or positional tab) is a barrier in
// that text, as in the East Asian analysis; a field result is segmented on its own, so its
// words wrap and size AutoFit like the words of a run.

import { BREAK_AFTER_DASH, wordBoundaries } from './cjk-line-break.ts';
import {
  breaksAfterSign,
  dictionaryWordBreaks,
  hasDictionaryScriptText,
} from './dictionary-word-breaks.ts';
import type { FieldAwarePiece } from './field-pieces.ts';

/**
 * Whether a piece is text that maps one-to-one to model offsets. Every other piece is a
 * barrier in paragraph-wide break analysis.
 */
export const isParagraphText = (piece: FieldAwarePiece): boolean =>
  !piece.projected &&
  !piece.positionalTab &&
  !piece.inlineDrawing &&
  !piece.equation &&
  piece.end - piece.start === piece.text.length;

/**
 * Paragraph text for break analysis, and where each piece starts in it. Plain text joins as
 * itself, every other non-empty piece as one U+FFFC, and a skipped piece adds nothing.
 */
export function paragraphBreakText(
  pieces: readonly FieldAwarePiece[],
  skip: (piece: FieldAwarePiece) => boolean = () => false
): { readonly text: string; readonly starts: ReadonlyMap<FieldAwarePiece, number> } {
  const starts = new Map<FieldAwarePiece, number>();
  const strings: string[] = [];
  let total = 0;
  for (const piece of pieces) {
    starts.set(piece, total);
    const text = skip(piece)
      ? ''
      : isParagraphText(piece)
        ? piece.text
        : '￼'.repeat(Math.min(piece.text.length, 1));
    strings.push(text);
    total += text.length;
  }
  return { text: strings.join(''), starts };
}

/** Dictionary cuts per piece. */
export interface PieceDictionaryCuts {
  /**
   * The piece's break boundaries: the space, zero-width-space, dash, and tab rules of
   * `wordBoundaries` read over the paragraph text (so a dash that opens a run still breaks
   * after itself), plus the dictionary cuts, ending at `text.length`. A layout-owned piece
   * reads its own text.
   */
  boundaries(piece: FieldAwarePiece): readonly number[];
  /** Cuts as offsets into the piece's own text, in `(0, text.length]`; the end is a seam. */
  of(piece: FieldAwarePiece): ReadonlySet<number> | undefined;
  /** Whether a cut falls where the piece starts: the seam before it is a word boundary. */
  startsAtCut(piece: FieldAwarePiece): boolean;
}

/**
 * Each piece's word cuts over the paragraph text, or null when per-piece `wordBoundaries`
 * already give every cut: the paragraph has no dictionary cut and no run that opens with a
 * dash. `skip` drops pieces that add no text, such as hidden runs, as they add no width.
 */
export function paragraphWordCuts(
  pieces: readonly FieldAwarePiece[],
  skip: (piece: FieldAwarePiece) => boolean = () => false
): PieceDictionaryCuts | null {
  // A dash that opens a run breaks after itself only when the text before it is known.
  const runOpensWithDash = pieces.some(
    (piece, index) =>
      index > 0 && !skip(piece) && isParagraphText(piece) && BREAK_AFTER_DASH.has(piece.text[0]!)
  );
  if (
    !runOpensWithDash &&
    !pieces.some((piece) => !skip(piece) && hasDictionaryScriptText(piece.text))
  )
    return null;
  const { text, starts } = paragraphBreakText(pieces, skip);
  const cuts = new Set(dictionaryWordBreaks(text));
  const byPiece = new Map<FieldAwarePiece, ReadonlySet<number>>();
  const opening = new Set<FieldAwarePiece>();
  for (const piece of pieces) {
    if (skip(piece) || piece.text.length === 0) continue;
    const own = new Set<number>();
    if (isParagraphText(piece)) {
      const start = starts.get(piece)!;
      if (cuts.has(start)) opening.add(piece);
      for (let offset = 1; offset <= piece.text.length; offset++)
        if (cuts.has(start + offset)) own.add(offset);
    } else if (hasDictionaryScriptText(piece.text)) {
      for (const cut of dictionaryWordBreaks(piece.text)) own.add(cut);
    }
    if (own.size > 0) byPiece.set(piece, own);
  }
  // A seam beside a field or picture: the paragraph text holds U+FFFC there, so the real
  // first and last characters decide a sentence-mark break, as line breaking decides it.
  let previous: FieldAwarePiece | undefined;
  for (const piece of pieces) {
    if (skip(piece) || piece.text.length === 0) continue;
    if (
      previous &&
      (!isParagraphText(previous) || !isParagraphText(piece)) &&
      breaksAfterSign(
        previous.text.charCodeAt(previous.text.length - 1),
        piece.text.codePointAt(0)!
      )
    ) {
      const own = new Set(byPiece.get(previous));
      own.add(previous.text.length);
      byPiece.set(previous, own);
      opening.add(piece);
    }
    previous = piece;
  }
  if (byPiece.size === 0 && !runOpensWithDash) return null;
  let paragraphCuts: readonly number[] | undefined;
  const boundaries = new Map<FieldAwarePiece, readonly number[]>();
  const boundariesOf = (piece: FieldAwarePiece): readonly number[] => {
    const own = byPiece.get(piece);
    if (!isParagraphText(piece) || skip(piece)) {
      const base = wordBoundaries(piece.text, false);
      return own ? withDictionaryCuts(base, own) : base;
    }
    // No ideographic pass: a paragraph with East Asian text takes the East Asian analysis.
    paragraphCuts ??= wordBoundaries(text, false);
    const start = starts.get(piece)!;
    const end = start + piece.text.length;
    // The first paragraph cut inside the piece.
    let low = 0;
    let high = paragraphCuts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (paragraphCuts[mid]! <= start) low = mid + 1;
      else high = mid;
    }
    const base: number[] = [];
    for (let at = low; at < paragraphCuts.length && paragraphCuts[at]! < end; at++)
      base.push(paragraphCuts[at]! - start);
    base.push(piece.text.length);
    return own ? withDictionaryCuts(base, own) : base;
  };
  return {
    boundaries(piece) {
      let found = boundaries.get(piece);
      if (!found) boundaries.set(piece, (found = boundariesOf(piece)));
      return found;
    },
    of: (piece) => byPiece.get(piece),
    startsAtCut: (piece) => opening.has(piece),
  };
}

/** Merge a piece's dictionary cuts into its strictly increasing word boundaries. */
export function withDictionaryCuts(
  boundaries: readonly number[],
  cuts: ReadonlySet<number>
): number[] {
  const extra = Array.from(cuts).sort((a, b) => a - b);
  const merged: number[] = [];
  let at = 0;
  for (const boundary of boundaries) {
    while (at < extra.length && extra[at]! < boundary) merged.push(extra[at++]!);
    if (at < extra.length && extra[at] === boundary) at += 1;
    merged.push(boundary);
  }
  return merged;
}
