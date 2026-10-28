import { setLineHangingPunctuationAdvance } from './line-hanging-punctuation.ts';
import { hangingCjkPunctuationAdvance } from './cjk-spacing.ts';
import { eastAsianLanguage } from './cjk-typography.ts';
import type { FieldAwarePiece } from './field-projection.ts';
import type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
import type { PendingLine } from './pending-line.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/**
 * Whether only whitespace follows `boundary` of `pieces[pieceIndex]` in its paragraph: text
 * ending there closes the paragraph.
 */
export function paragraphFinalAt(
  pieces: readonly FieldAwarePiece[]
): (pieceIndex: number, boundary: number) => boolean {
  let lastPiece = -1;
  let lastEnd = 0;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const end = pieces[index]!.text.trimEnd().length;
    if (end > 0) {
      lastPiece = index;
      lastEnd = end;
      break;
    }
  }
  return (pieceIndex, boundary) =>
    pieceIndex > lastPiece || (pieceIndex === lastPiece && boundary >= lastEnd);
}

/**
 * Retain the actual overflow decision for alignment after placement and cache reuse. A
 * hanging Korean mark lets the text before it fill the measure only under
 * `koreanHangingLineFills`; otherwise that line keeps its natural width.
 */
export function rememberHangingPunctuation(
  line: PendingLine,
  span: StyleSpanRecord,
  piece: FieldAwarePiece,
  measurer: TextMeasurer,
  hangs: boolean,
  available: number,
  flow: Pick<ParagraphFlowOptions, 'koreanHangingLineFills'> | undefined
): void {
  // `hangs` already admitted the mark, so a Korean mark that hangs closes its paragraph.
  let advance =
    hangs && line.width + span.box.width > available + 0.001
      ? hangingCjkPunctuationAdvance(span.text, piece, measurer, { paragraphFinal: true })
      : undefined;
  if (
    advance !== undefined &&
    flow?.koreanHangingLineFills !== true &&
    /^ko(?:-|$)/.test(eastAsianLanguage(piece.props) ?? '')
  )
    advance = undefined;
  if (advance !== undefined || !span.lineEndWhitespace)
    setLineHangingPunctuationAdvance(line, advance);
}
