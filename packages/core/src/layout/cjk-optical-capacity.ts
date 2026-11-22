// What the cells of a fitted line can give, and the limits on taking it: the expansion gate,
// the half-advance limit and Korean marks of legacy modes (`w:compatSetting` `compatibilityMode`
// 14 or earlier, or none) with punctuation compression (`w:characterSpacingControl`), and the
// kana shares.
import type { PendingLine } from './pending-line.ts';
import type { StyleSpanRecord } from './semantic-records.ts';
import { isCjk, isHangul, koreanText } from './cjk-paragraph-breaks.ts';
import { eastAsianLanguage } from './cjk-typography.ts';
import { kanaShareLimit } from './kana-sound-mark-fit.ts';
import {
  blankSided,
  CLOSING,
  curlyRole,
  PUNCTUATION,
  TOLERANCE,
  type Cell,
} from './cjk-optical-cell.ts';

// The fit gate weighs expansion in units of 1/64 of an advance (see `expansionGate`).
const EXPANSION_UNITS = 64;
/**
 * The marks of a legacy-mode line that keep their advances: a Korean mark, by its language
 * (`w:lang` `w:eastAsia`), and any mark after Hangul on the line. Korean text without marks does
 * not stop other marks.
 */
export function legacyKoreanMarks(cells: readonly Cell[]): ReadonlySet<Cell> {
  const held = new Set<Cell>();
  let afterHangul = false;
  for (const cell of cells) {
    afterHangul ||= isHangul(cell.span.text.codePointAt(0)!);
    if (
      blankSided(cell) &&
      (afterHangul || koreanText(cell.span.text, eastAsianLanguage(cell.span.props) ?? ''))
    )
      held.add(cell);
  }
  return held;
}
/**
 * In a legacy compatibility mode, a group of East Asian characters and punctuation, with Latin
 * words or numbers when it ends in a closing mark, joins a line only when the compression it
 * needs, less what its own marks can still give, is at most half its natural advance. A Latin
 * closing quote that ends the group counts as a closing mark that gave its trailing half. Groups
 * with other text (a space included), punctuation-only groups, kana fits, and hanging fits are
 * not limited.
 *
 * @param cells - The line's cells, then the candidate group's cells.
 * @param sourceCount - The number of line spans; cells from later spans are the group.
 * @param deficit - The compression still needed after the final mark gave its trailing side.
 * @param held - The marks that keep their advances (`legacyKoreanMarks`).
 * @param quoteAdvance - The advance of a Latin closing quote that ends the group, or 0.
 * @returns Whether the group must wrap instead of joining the line.
 */
export function exceedsLegacyAdmission(
  cells: readonly Cell[],
  sourceCount: number,
  deficit: number,
  held: ReadonlySet<Cell>,
  quoteAdvance: number
): boolean {
  // A group of marks alone is not limited.
  let counted = false;
  let half = 0;
  const last = cells.at(-1)!;
  // A final semicolon keeps its blank (see `fitCjkOptically`), so it does not close the group.
  const closes =
    (CLOSING.test(last.span.text) && last.span.text !== '；') ||
    last.qualifiedCurly === 'closing' ||
    quoteAdvance > 0;
  deficit -= quoteAdvance / 2;
  for (const cell of cells) {
    if (cell.sourceIndex < sourceCount) continue;
    const mark = PUNCTUATION.test(cell.span.text) || cell.qualifiedCurly !== undefined;
    const opaque = closes && cell.ordinaryOpaque === true;
    if (!mark && !opaque && !isCjk(cell.span.text.codePointAt(0)!)) return false;
    counted ||= !mark;
    half += cell.natural / 2;
    // The final mark's trailing side is already in `deficit`: what its ink holds back is not
    // capacity, as no glyph follows it.
    if (blankSided(cell) && !held.has(cell) && cell !== last)
      deficit -= Math.max(0, cell.natural / 2 - cell.alreadyReduced - cell.reduction);
  }
  return counted && deficit > half + TOLERANCE;
}
/**
 * A justified line, or any line in a legacy mode, takes another ordinary glyph by compression
 * only when the share of the compression capacity it spends is at most the expansion that
 * leaving the glyph off would need. Expansion counts in 1/64 of each advance before the line's
 * last glyph: the advances whose gaps the shorter line would spread its room over. A final mark
 * that hangs or drops its trailing half stays in the deficit and counts as capacity, and a
 * candidate that opens with a bracket is gated too.
 */
export function expansionGate(
  cells: readonly Cell[],
  sourceCount: number,
  room: number,
  deficit: number
): { readonly capacityBound: number; admits(capacity: number): boolean } {
  let spread = 0;
  let capacityBound = 0;
  let lastLineCell: Cell | undefined;
  for (const cell of cells) {
    if (blankSided(cell)) capacityBound += cell.natural / 2;
    if (cell.sourceIndex >= sourceCount) continue;
    spread += cell.natural;
    lastLineCell = cell;
  }
  if (lastLineCell) spread -= lastLineCell.natural;
  return {
    capacityBound,
    admits: (capacity) =>
      room > TOLERANCE && deficit * spread <= room * capacity * EXPANSION_UNITS + TOLERANCE,
  };
}
/**
 * How a kana fit (`compressPunctuationAndJapaneseKana`) spends its capacity. Punctuation blank
 * sides on the line go first, then kana, each by at most a sixteenth of its em, in equal
 * shares. A final closing mark gives its trailing half first when that half alone fits the
 * line, or when `finalHalfFirst` (no punctuation overflow); otherwise only when kana cannot
 * take the rest.
 */
export interface KanaFitRules {
  readonly finalHalfFirst: boolean;
  /** Skip the expansion gate: a legacy mode fits a lone mark after a full line. */
  readonly ungated?: boolean;
}
// Hiragana and katakana, small ones included. The prolonged sound mark and iteration marks
// keep their advances.
const FULL_WIDTH_KANA = /^[\u3041-\u3096\u30a1-\u30fa]$/u;
export const isFullWidthKana = (cell: Cell): boolean => FULL_WIDTH_KANA.test(cell.span.text);
/** What one kana can still give: a sixteenth of its em, within its remaining advance. */
export const kanaShare = (cell: Cell): number =>
  Math.max(
    0,
    Math.min(kanaShareLimit(cell.span) - cell.reduction, cell.span.box.width - cell.reduction)
  );
/**
 * An upper bound on what a kana fit can absorb: a sixteenth of an em per kana or sound mark,
 * half an em per punctuation mark or curly quote, from each span's own font size.
 */
export function kanaFitBound(line: PendingLine, candidates: readonly StyleSpanRecord[]): number {
  let bound = TOLERANCE;
  for (const spans of [line.spans, candidates])
    for (const span of spans) {
      const em = span.style.fontSizePt;
      const text = span.text;
      for (let index = 0; index < text.length; index++) {
        const unit = text.charCodeAt(index);
        if ((unit >= 0x3041 && unit <= 0x309a) || (unit >= 0x30a1 && unit <= 0x30fa))
          bound += em / 16;
        else if (unit >= 0x2018 && (PUNCTUATION.test(text[index]!) || curlyRole(text[index]!)))
          bound += em / 2;
      }
    }
  return bound;
}
/** Give `amount` to `cells` in equal shares within their kana capacity; returns the rest. */
export function shareAmong(cells: readonly Cell[], amount: number): number {
  let active = cells.filter((cell) => kanaShare(cell) > TOLERANCE);
  while (amount > TOLERANCE && active.length) {
    const share = amount / active.length;
    for (const cell of active) {
      const given = Math.min(share, kanaShare(cell));
      cell.reduction += given;
      amount -= given;
    }
    active = active.filter((cell) => kanaShare(cell) > TOLERANCE);
  }
  return amount;
}
