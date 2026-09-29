import type { FieldAwarePiece } from './field-pieces.ts';

/** Text with a stable measured advance that can complete a space-compressed word. */
export function isSpaceShrinkWordPiece(piece: FieldAwarePiece): boolean {
  if (
    piece.positionalTab ||
    piece.measureText !== undefined ||
    piece.inlineDrawing ||
    piece.anchoredAtom ||
    piece.equation ||
    piece.noteSeparator ||
    piece.fieldAtom
  )
    return false;
  if (piece.projected) {
    // Body citations keep their atomic range, even when their display has several digits.
    // Reserved page-local marks and computed field values retain their existing policy.
    return (
      piece.noteNav?.direction === 'to-note' &&
      piece.end - piece.start === 1 &&
      piece.text.length > 0 &&
      !/\s/u.test(piece.text)
    );
  }
  return piece.end - piece.start === piece.text.length;
}
