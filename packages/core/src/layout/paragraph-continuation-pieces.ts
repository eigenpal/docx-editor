import type { FieldAwarePiece } from './field-pieces.ts';
import { withRuleWidths } from './horizontal-rule.ts';

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

/** The continuation pieces, with each horizontal rule sized to the line width `widthPt`. */
export function continuationPiecesWithRules(
  pieces: readonly FieldAwarePiece[],
  startOffset: number,
  showFieldCodes: boolean | undefined,
  widthPt: number
): FieldAwarePiece[] {
  return withRuleWidths(paragraphContinuationPieces(pieces, startOffset, showFieldCodes), widthPt);
}
