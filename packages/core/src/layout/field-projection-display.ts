import { unmergedPiecesOfParagraphForDisplay } from './field-projection-walk.ts';
import { styleSeparatorPieces } from './style-separator-pieces.ts';
import type { DisplayWalkInput } from './field-display-input.ts';
import { splitFieldResultBreaks } from './field-result-breaks.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
/** Internal view projection retains each display member's source style. @internal */
export function piecesOfParagraphForDisplay(input: DisplayWalkInput): FieldAwarePiece[] {
  return splitFieldResultBreaks(
    styleSeparatorPieces(input, unmergedPiecesOfParagraphForDisplay) ??
      unmergedPiecesOfParagraphForDisplay(input)
  );
}
