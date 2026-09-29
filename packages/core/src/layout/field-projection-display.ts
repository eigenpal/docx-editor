import { unmergedPiecesOfParagraphForDisplay } from './field-projection-walk.ts';
import { styleSeparatorPieces, collectDisplayPieces } from './style-separator-pieces.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
/** Internal view projection retains each display member's source style. @internal */
export function piecesOfParagraphForDisplay(
  ...args: Parameters<typeof unmergedPiecesOfParagraphForDisplay>
): FieldAwarePiece[] {
  return (
    styleSeparatorPieces(args, unmergedPiecesOfParagraphForDisplay) ??
    collectDisplayPieces(args, unmergedPiecesOfParagraphForDisplay)
  );
}
