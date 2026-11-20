// How much of a hanging full-width mark passes the margin when the paragraph compresses
// punctuation. Derived line geometry only; the document is unchanged.
import {
  eastAsianLanguage,
  isKorean,
  isTraditionalChinese,
  lineEndMarksMayHang,
  type CjkParagraphTypography,
} from './cjk-typography.ts';
import type { PendingLine } from './pending-line.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { FieldAwarePiece } from './field-pieces.ts';

const CLOSING_BRACKET = /^[〉》」』】〕〗〙〛）］｝]$/u;
interface MarkBlanks {
  readonly leading: number;
  readonly trailing: number;
}
const CLOSING_BLANKS: MarkBlanks = Object.freeze({ leading: 0, trailing: 0.5 });
const CENTERED_BLANKS: MarkBlanks = Object.freeze({ leading: 0.25, trailing: 0.25 });

/**
 * The blank sides of a full-width line-end mark, as fractions of its advance, by the mark's
 * own run language. A closing mark leaves its right half blank. A centered mark leaves a
 * quarter on each side. Other marks, such as `？`, fill their cell and return undefined.
 */
function lineEndMarkBlanks(mark: string, language: string | undefined): MarkBlanks | undefined {
  if (CLOSING_BRACKET.test(mark)) return CLOSING_BLANKS;
  const traditional = isTraditionalChinese(language);
  // Simplified Chinese, and text without an East Asian language, set these marks in the left
  // half of the cell; Traditional Chinese centers them. Japanese `；：！` never hang.
  if ('、。，．；：'.includes(mark)) return traditional ? CENTERED_BLANKS : CLOSING_BLANKS;
  if (mark === '！' && !traditional) return CLOSING_BLANKS;
  return undefined;
}

/**
 * The advance that the mark ending `text` keeps past the margin, given its whole `advance` and
 * the line's `overflow`. With punctuation compression, an overflow no larger than the mark's
 * blank sides hangs only the trailing blank, or the overflow when that is larger, and the text
 * before the mark fills the rest of the measure. A larger overflow, a mark without blank
 * sides, no compression, and Korean text hang the whole advance. `piece` holds the mark: its
 * run language selects the blank sides, and its character spacing widens the trailing one.
 */
export function blankSideHangingAdvance(
  text: string,
  piece: FieldAwarePiece,
  advance: number,
  overflow: number,
  typography: CjkParagraphTypography | undefined
): number {
  const compression = typography?.settings?.compression;
  if (compression === undefined || compression === 'doNotCompress') return advance;
  const language = eastAsianLanguage(piece.props);
  if (isKorean(language)) return advance;
  const blanks = lineEndMarkBlanks(text.at(-1) ?? '', language);
  if (!blanks) return advance;
  // Character spacing follows the glyph cell, so it belongs to the trailing side.
  const spacing = piece.style.characterSpacingPt;
  const cell = advance - spacing;
  const trailing = Math.max(0, cell * blanks.trailing + spacing);
  if (overflow > cell * blanks.leading + trailing + 0.001) return advance;
  return Math.min(advance, Math.max(trailing, overflow));
}

// Japanese keeps these marks in its hanging set under the alternate line-break rules.
const JAPANESE_HANGING = '、。，．';

/**
 * Whether the alternate line-break rules decide the line-end `mark` (`alternateLineEndFit`):
 * the rules apply, and the mark is outside the hanging set of its run `language`. Only
 * Japanese keeps a hanging set: `、。，．`.
 */
export function alternateLineEndDecides(
  mark: string,
  language: string | undefined,
  typography: CjkParagraphTypography | undefined
): boolean {
  if (typography?.settings?.alternateLineEndFit !== true) return false;
  return !(language?.startsWith('ja') === true && JAPANESE_HANGING.includes(mark));
}

/**
 * Under the alternate line-break rules, the most of a line-end mark that may pass the margin:
 * its blank right half, widened by its character spacing. The text keeps its natural width,
 * and only the overflow passes the margin. A mark without a blank right half, a paragraph
 * without punctuation compression, and Korean text return undefined: the mark wraps.
 */
export function alternateLineEndAdvance(
  mark: string,
  piece: FieldAwarePiece,
  advance: number,
  typography: CjkParagraphTypography | undefined
): number | undefined {
  const compression = typography?.settings?.compression;
  if (compression === undefined || compression === 'doNotCompress') return undefined;
  const language = eastAsianLanguage(piece.props);
  if (isKorean(language) || lineEndMarkBlanks(mark, language) !== CLOSING_BLANKS) return undefined;
  const spacing = piece.style.characterSpacingPt;
  return Math.max(0, (advance - spacing) * CLOSING_BLANKS.trailing + spacing);
}

/** What a fitter knows about a line whose final mark may hang. */
export interface BlankHangLine {
  readonly line: PendingLine;
  readonly measurer: TextMeasurer;
  readonly overflow: number;
  readonly advance: number | undefined;
}

/**
 * Whether the mark that ends the last of `candidates` hangs only part of its advance: the
 * line lets its final mark hang, and the group overflows by no more than the mark's blank
 * sides. Under the alternate line-break rules, `advance` is already that blank half. `piece`
 * holds that mark.
 */
export function hangsInBlankSides(
  candidates: readonly { readonly text: string }[],
  piece: FieldAwarePiece,
  { line, measurer, overflow, advance }: BlankHangLine,
  typography: CjkParagraphTypography | undefined
): boolean {
  if (advance === undefined || !typography) return false;
  if (!lineEndMarksMayHang(typography, line.spans, measurer)) return false;
  const text = candidates.at(-1)?.text ?? '';
  if (alternateLineEndDecides(text.at(-1) ?? '', eastAsianLanguage(piece.props), typography))
    return overflow <= advance + 0.001;
  return blankSideHangingAdvance(text, piece, advance, overflow, typography) < advance;
}
