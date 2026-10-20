import type { FieldAwarePiece } from './field-pieces.ts';

/** Keep projected boundary content while trimming already placed model text. */
export function paragraphContinuationPieces(
  pieces: readonly FieldAwarePiece[],
  startOffset: number,
  showFieldCodes = false
): FieldAwarePiece[] {
  return pieces.flatMap((piece): FieldAwarePiece[] => {
    if (
      piece.end <= startOffset &&
      !(
        (startOffset === 0 || showFieldCodes || piece.unsupported) &&
        piece.projected &&
        piece.start === piece.end &&
        piece.start === startOffset
      )
    )
      return [];
    if (piece.start >= startOffset) return [piece];
    const trim = startOffset - piece.start;
    return [
      {
        ...piece,
        text: piece.projected ? piece.text : piece.text.slice(trim),
        start: startOffset,
      },
    ];
  });
}
