// How much of a hanging full-width mark (`w:overflowPunct`) passes the margin when
// `w:characterSpacingControl` compresses punctuation. Derived line geometry only; the
// document is unchanged.
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
 * own run language (`w:lang` `w:eastAsia`). A closing mark leaves its right half blank. A
 * centered mark leaves a quarter on each side. Other marks, such as `？`, fill their cell and
 * return undefined.
 */
function lineEndMarkBlanks(mark: string, language: string | undefined): MarkBlanks | undefined {
  if (CLOSING_BRACKET.test(mark)) return CLOSING_BLANKS;
  const traditional = isTraditionalChinese(language);
  // Simplified Chinese, and text without a `w:eastAsia` language, set these marks in the left
  // half of the cell; Traditional Chinese centers them. Japanese `；：！` never hang.
  if ('、。，．；：'.includes(mark)) return traditional ? CENTERED_BLANKS : CLOSING_BLANKS;
  if (mark === '！' && !traditional) return CLOSING_BLANKS;
  return undefined;
}

/** The blank sides, in points, of the mark ending `text`, or undefined when it has none. */
function markBlankSides(
  text: string,
  piece: FieldAwarePiece,
  advance: number,
  typography: CjkParagraphTypography | undefined
): MarkBlanks | undefined {
  const compression = typography?.settings?.compression;
  if (compression === undefined || compression === 'doNotCompress') return undefined;
  const language = eastAsianLanguage(piece.props);
  if (isKorean(language)) return undefined;
  const blanks = lineEndMarkBlanks(text.at(-1) ?? '', language);
  if (!blanks) return undefined;
  // Character spacing follows the glyph cell, so it belongs to the trailing side.
  const spacing = piece.style.characterSpacingPt;
  const cell = advance - spacing;
  return {
    leading: cell * blanks.leading,
    trailing: Math.max(0, cell * blanks.trailing + spacing),
  };
}

/**
 * The advance that the mark ending `text` keeps past the margin, given its whole `advance` and
 * the line's `overflow`. When `w:characterSpacingControl` is `compressPunctuation` or
 * `compressPunctuationAndJapaneseKana`, an overflow no larger than the mark's blank sides
 * hangs only the trailing blank, or the overflow when that is larger, and the text before
 * the mark fills the rest of the measure. A larger overflow, a mark without blank
 * sides, `doNotCompress`, and Korean text hang the whole advance. `piece` holds the mark: its
 * run language selects the blank sides, and its character spacing (`w:spacing` in `w:rPr`)
 * widens the trailing one.
 */
export function blankSideHangingAdvance(
  text: string,
  piece: FieldAwarePiece,
  advance: number,
  overflow: number,
  typography: CjkParagraphTypography | undefined
): number {
  const sides = markBlankSides(text, piece, advance, typography);
  if (!sides || overflow > sides.leading + sides.trailing + 0.001) return advance;
  return Math.min(advance, Math.max(sides.trailing, overflow));
}

/**
 * The trailing blank, in points, that punctuation compression (`w:characterSpacingControl`)
 * takes from a hanging mark with whole advance `advance`, or 0. Its highlight (`w:highlight`),
 * shading (`w:shd`), underline (`w:u`), strike (`w:strike`), and tracked-change (`w:ins`,
 * `w:del`) formatting ends before that blank, whether the whole mark hangs or only the blank does.
 * Without compression, and for a mark without blank sides or a Korean run (`w:lang`
 * `w:eastAsia`), the formatting
 * covers the whole mark.
 */
export function compressedTrailingBlank(
  text: string,
  piece: FieldAwarePiece,
  advance: number,
  typography: CjkParagraphTypography | undefined
): number {
  return markBlankSides(text, piece, advance, typography)?.trailing ?? 0;
}

// Japanese keeps these marks, full and half width, in its hanging set under the alternate
// line-break rules (`w:useAltKinsokuLineBreakRules`).
const JAPANESE_HANGING = '、。，．､｡';

/**
 * Whether the alternate line-break rules (`w:useAltKinsokuLineBreakRules`, through
 * `alternateLineEndFit`) decide the line-end `mark`: the rules apply, and the mark is outside
 * the hanging set of its run `language` (`w:lang` `w:eastAsia`). Only Japanese keeps a hanging
 * set: `、。，．` and half-width `､｡`. Half-width Latin marks (below U+2000) keep their usual
 * hanging.
 */
export function alternateLineEndDecides(
  mark: string,
  language: string | undefined,
  typography: CjkParagraphTypography | undefined
): boolean {
  if (typography?.settings?.alternateLineEndFit !== true) return false;
  if ((mark.codePointAt(0) ?? 0) < 0x2000) return false;
  return !(language?.startsWith('ja') === true && JAPANESE_HANGING.includes(mark));
}

// Under the alternate line-break rules, whether the mark may give up a blank right half:
// `w:characterSpacingControl` compresses punctuation, the text is not Korean, and the mark's
// language class leaves its right half blank.
function alternateBlankHalf(
  mark: string,
  language: string | undefined,
  typography: CjkParagraphTypography | undefined
): boolean {
  const compression = typography?.settings?.compression;
  if (compression === undefined || compression === 'doNotCompress') return false;
  return !isKorean(language) && lineEndMarkBlanks(mark, language) === CLOSING_BLANKS;
}

/**
 * Whether the alternate line-break rules wrap the line-end `mark` rather than let any of it
 * pass the margin: they decide the mark, and it may not give up a blank right half.
 */
export function alternateLineEndWraps(
  mark: string,
  language: string | undefined,
  typography: CjkParagraphTypography | undefined
): boolean {
  return (
    alternateLineEndDecides(mark, language, typography) &&
    !alternateBlankHalf(mark, language, typography)
  );
}

/**
 * Under the alternate line-break rules, the most of a line-end mark that may pass the margin:
 * its blank right half, widened by its character spacing (`w:spacing` in `w:rPr`). The text
 * keeps its natural width, and only the overflow passes the margin. A mark without a blank
 * right half, `doNotCompress`, and Korean text return undefined: the mark wraps.
 */
export function alternateLineEndAdvance(
  mark: string,
  piece: FieldAwarePiece,
  advance: number,
  typography: CjkParagraphTypography | undefined
): number | undefined {
  if (!alternateBlankHalf(mark, eastAsianLanguage(piece.props), typography)) return undefined;
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
