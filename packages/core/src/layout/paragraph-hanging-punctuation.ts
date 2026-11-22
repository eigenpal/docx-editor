import { setLineHangingPunctuationAdvance } from './line-hanging-punctuation.ts';
import { hangingCjkPunctuationAdvance } from './cjk-spacing.ts';
import {
  alternateLineEndAdvance,
  alternateLineEndDecides,
  blankSideHangingAdvance,
  compressedTrailingBlank,
} from './hanging-mark-blanks.ts';
import { eastAsianLanguage, isKorean, type CjkParagraphTypography } from './cjk-typography.ts';
import type { FieldAwarePiece } from './field-projection.ts';
import type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
import type { PendingLine } from './pending-line.ts';
import { styleForFontSlot } from './script-itemization.ts';
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
 * The advance of the half-width Latin mark (below U+2000) that ends `candidate` and may hang
 * past the margin, or 0. A justified line that may shrink its spaces
 * (`ParagraphFlowOptions.spaceShrink`) shrinks them before such a mark hangs, and
 * hangs it only when the spaces reach their floor first: see `spaceShrinkFit`. Full-width
 * marks hang as before.
 */
export function spaceShrinkMarkAdvance(
  candidate: string,
  piece: FieldAwarePiece,
  measurer: TextMeasurer,
  typography: CjkParagraphTypography,
  paragraphFinal: boolean
): number {
  const mark = candidate.at(-1);
  if (!(typography.hangingPunctuation ?? typography.overflowPunctuation)) return 0;
  if (mark === undefined || mark.charCodeAt(0) >= 0x2000) return 0;
  const options = { paragraphFinal, policy: typography };
  return hangingCjkPunctuationAdvance(candidate, piece, measurer, options) ?? 0;
}

/**
 * Retain the actual overflow decision for alignment after placement and cache reuse. A
 * hanging Korean mark lets the text before it fill the measure only under
 * `koreanHangingLineFills`; otherwise that line keeps its natural width.
 */
export function rememberLineEndHang(
  line: PendingLine,
  span: StyleSpanRecord,
  piece: FieldAwarePiece,
  measurer: TextMeasurer,
  hangs: boolean,
  available: number,
  flow: Pick<ParagraphFlowOptions, 'koreanHangingLineFills'> | undefined,
  typography: CjkParagraphTypography
): void {
  // `hangs` already admitted the mark, so a Korean mark that hangs closes its paragraph.
  const overflow = line.width + span.box.width - available;
  let advance =
    hangs && overflow > 0.001
      ? hangingCjkPunctuationAdvance(span.text, piece, measurer, { paragraphFinal: true })
      : undefined;
  const language = eastAsianLanguage(piece.props);
  if (advance !== undefined && flow?.koreanHangingLineFills !== true && isKorean(language))
    advance = undefined;
  // Under the alternate line-break rules (`w:useAltKinsokuLineBreakRules`), only the overflow
  // passes the margin, within the mark's blank half. Otherwise, when
  // `w:characterSpacingControl` compresses punctuation, a mark that overflows by no more than
  // its blank sides hangs only its trailing blank, and the text before it fills the rest of
  // the measure.
  const whole = advance;
  const mark = span.text.at(-1) ?? '';
  if (advance !== undefined && alternateLineEndDecides(mark, language, typography)) {
    const limit = alternateLineEndAdvance(mark, piece, advance, typography);
    advance = limit === undefined ? undefined : Math.min(limit, overflow);
  } else if (advance !== undefined)
    advance = blankSideHangingAdvance(span.text, piece, advance, overflow, typography);
  if (advance !== undefined || !span.lineEndWhitespace) {
    setLineHangingPunctuationAdvance(line, advance);
    const blank =
      whole === undefined ? 0 : markBlankBesideInk(span, piece, measurer, whole, typography);
    line.hangingMarkBlank = blank > 0.001 ? blank : undefined;
  }
}

/**
 * The compressed trailing blank of the hanging mark ending `span`, kept clear of its ink: a face
 * that centers a mark its language sets at the cell's start keeps its marks over the glyph, so
 * screen paint never clips the glyph itself.
 */
function markBlankBesideInk(
  span: StyleSpanRecord,
  piece: FieldAwarePiece,
  measurer: TextMeasurer,
  advance: number,
  typography: CjkParagraphTypography
): number {
  const blank = compressedTrailingBlank(span.text, piece, advance, typography);
  if (blank <= 0.001) return 0;
  const ink = measurer.inkBounds?.(span.text.at(-1)!, styleForFontSlot(span.style, span.fontSlot));
  if (!ink || !Number.isFinite(ink.right)) return blank;
  return Math.min(blank, Math.max(0, advance - ink.right));
}
