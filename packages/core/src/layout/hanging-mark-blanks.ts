// How much of a hanging full-width mark passes the margin when the paragraph compresses
// punctuation. Derived line geometry only; the document is unchanged.
import { eastAsianLanguage, type CjkParagraphTypography } from './cjk-typography.ts';
import type { FieldAwarePiece } from './field-pieces.ts';

const CLOSING_BRACKET = /^[〉》」』】〕〗〙〛）］｝]$/u;
interface MarkBlanks {
  readonly leading: number;
  readonly trailing: number;
}
const CLOSING_BLANKS: MarkBlanks = Object.freeze({ leading: 0, trailing: 0.5 });
const CENTRED_BLANKS: MarkBlanks = Object.freeze({ leading: 0.25, trailing: 0.25 });

/**
 * The blank sides of a full-width line-end mark, as fractions of its advance, by the mark's
 * own run language. A closing mark leaves its right half blank. A centred mark leaves a
 * quarter on each side. Other marks, such as `？`, fill their cell and return undefined.
 */
function lineEndMarkBlanks(mark: string, language: string | undefined): MarkBlanks | undefined {
  if (CLOSING_BRACKET.test(mark)) return CLOSING_BLANKS;
  const traditional = /^zh-(tw|hk|mo|hant)(-|$)/.test(language ?? '');
  const japanese = /^ja(-|$)/.test(language ?? '');
  // Simplified Chinese, and text without an East Asian language, set these marks in the left
  // half of the cell. Traditional Chinese centres them; Japanese centres `；` and `：`.
  if ('、。，．'.includes(mark)) return traditional ? CENTRED_BLANKS : CLOSING_BLANKS;
  if (mark === '；' || mark === '：')
    return traditional || japanese ? CENTRED_BLANKS : CLOSING_BLANKS;
  if (mark === '！' && !traditional && !japanese) return CLOSING_BLANKS;
  return undefined;
}

/**
 * The advance that a mark ending `text` keeps past the margin, given its whole `advance` and
 * the line's `overflow`. With punctuation compression, an overflow no larger than the mark's
 * blank sides hangs only the trailing blank, or the overflow when that is larger, and the text
 * before the mark fills the rest of the measure. A larger overflow, a mark without blank
 * sides, no compression, and Korean text hang the whole advance. `language` is the East Asian
 * language of the mark's run.
 */
export function blankSideHangingAdvance(
  text: string,
  language: string | undefined,
  advance: number,
  overflow: number,
  typography: CjkParagraphTypography | undefined
): number {
  const compression = typography?.settings?.compression;
  if (compression === undefined || compression === 'doNotCompress') return advance;
  if (/^ko(?:-|$)/.test(language ?? '')) return advance;
  const blanks = lineEndMarkBlanks(text.at(-1) ?? '', language);
  if (!blanks || overflow > advance * (blanks.leading + blanks.trailing) + 0.001) return advance;
  return Math.max(advance * blanks.trailing, overflow);
}

/**
 * Whether the mark that ends the last of `candidates` hangs only part of its `advance` when
 * the group overflows the line by `overflow`. `piece` holds that mark.
 */
export function hangsInBlankSides(
  candidates: readonly { readonly text: string }[],
  piece: FieldAwarePiece,
  advance: number | undefined,
  overflow: number,
  typography: CjkParagraphTypography | undefined
): boolean {
  if (advance === undefined) return false;
  const text = candidates.at(-1)?.text ?? '';
  const language = eastAsianLanguage(piece.props);
  return blankSideHangingAdvance(text, language, advance, overflow, typography) < advance;
}
