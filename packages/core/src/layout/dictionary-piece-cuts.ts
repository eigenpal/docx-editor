// Dictionary word cuts mapped from paragraph text back to the pieces that hold it, for
// callers that walk pieces one at a time (table AutoFit minimums). Paragraph break analysis
// maps the same cuts itself (`cjk-paragraph-breaks.ts`).

import { dictionaryWordBreaks, hasDictionaryScriptText } from './dictionary-word-breaks.ts';
import type { FieldAwarePiece } from './field-pieces.ts';

/** Text that maps one-to-one to model offsets; every other piece is a barrier. */
const isPlainText = (piece: FieldAwarePiece): boolean =>
  !piece.projected &&
  !piece.positionalTab &&
  !piece.inlineDrawing &&
  !piece.equation &&
  piece.end - piece.start === piece.text.length;

/**
 * Each piece's dictionary cuts as offsets into its own text, in `(0, text.length]`. A cut at
 * `text.length` is the seam to the next piece. Null when the paragraph has none.
 *
 * Hidden pieces add no text, as they add no width. Layout-owned atoms (fields, pictures,
 * equations, tabs) join the text as one object replacement character, so no word runs across
 * them.
 */
export function dictionaryCutsByPiece(
  pieces: readonly FieldAwarePiece[]
): ReadonlyMap<FieldAwarePiece, ReadonlySet<number>> | null {
  if (!pieces.some((piece) => isPlainText(piece) && hasDictionaryScriptText(piece.text))) {
    return null;
  }
  const starts: number[] = [];
  const strings: string[] = [];
  let total = 0;
  for (const piece of pieces) {
    starts.push(total);
    const text = piece.style.hidden
      ? ''
      : isPlainText(piece)
        ? piece.text
        : piece.text.length > 0
          ? '￼'
          : '';
    strings.push(text);
    total += text.length;
  }
  const cuts = dictionaryWordBreaks(strings.join(''));
  if (cuts.length === 0) return null;
  const byPiece = new Map<FieldAwarePiece, Set<number>>();
  let pieceIndex = 0;
  for (const cut of cuts) {
    // The first piece whose text ends at or after the cut: a seam belongs to the piece before
    // it, and an empty piece at the seam is never reached first.
    while (pieceIndex < pieces.length && starts[pieceIndex]! + strings[pieceIndex]!.length < cut)
      pieceIndex += 1;
    const piece = pieces[pieceIndex];
    if (!piece) break;
    let set = byPiece.get(piece);
    if (!set) byPiece.set(piece, (set = new Set()));
    set.add(cut - starts[pieceIndex]!);
  }
  return byPiece;
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
