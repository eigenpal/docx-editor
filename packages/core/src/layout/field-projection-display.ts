import { unmergedPiecesOfParagraphForDisplay } from './field-projection-walk.ts';
import { styleSeparatorPieces, collectDisplayPieces } from './style-separator-pieces.ts';
import { splitFieldResultBreaks } from './field-result-breaks.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
type W = Parameters<typeof unmergedPiecesOfParagraphForDisplay>;
/**
 * The walk inputs, with every one before `changeSites` required: a caller passes `undefined` for
 * an input it does not have. A new display walk cannot leave out the TOC link ranges and still
 * compile; outside a TOC it passes `undefined`.
 */
type DisplayWalkArguments = [
  paragraph: W[0],
  inheritedRunProperties: W[1],
  pageContext: W[2],
  cascadeRuns: W[3],
  projectLink: W[4],
  noteMarks: W[5],
  displayMode: W[6],
  deletedRanges: W[7],
  inlineDrawingLayout: W[8],
  themeFonts: W[9],
  projectFieldLink: W[10],
  documentProperties: W[11],
  bodyPageFields: W[12],
  refFields: W[13],
  authorFilter: W[14],
  showFieldCodes: W[15],
  fieldCodeRanges: W[16],
  tocLinkStyleRanges: W[17],
  changeSites?: W[18],
];

/** Internal view projection retains each display member's source style. @internal */
export function piecesOfParagraphForDisplay(...args: DisplayWalkArguments): FieldAwarePiece[] {
  return splitFieldResultBreaks(
    styleSeparatorPieces(args, unmergedPiecesOfParagraphForDisplay) ??
      collectDisplayPieces(args, unmergedPiecesOfParagraphForDisplay)
  );
}
