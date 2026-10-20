import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import type { FieldAwarePiece } from './field-pieces.ts';
import { isCollapsibleLineEndWhitespace } from './line-end-whitespace.ts';

/**
 * Measure text following a tab until the next tab or hard break, across mixed-style pieces.
 * Also reports the advance to the first decimal point for decimal-aligned stops.
 */
/**
 * Whether anything that occupies space still follows this tab on its own line.
 *
 * A TRAILING tab does not wrap in Word — same rule as a trailing space. Header lines are
 * routinely authored as `LEFT<tab><tab><tab>RIGHT<tab><tab>`, and treating the last tabs
 * as wrappable opened a new line per tab: the header grew by several lines, and because a
 * header's flow height sets the body's effective top margin, the body was pushed down the
 * page. Stops at a hard break, which ends the line anyway, and skips further tabs and
 * spaces, which are themselves trimmed at the line end.
 */
export function placeableContentSuffixes(
  pieces: readonly Pick<FieldAwarePiece, 'text' | 'inlineDrawing'>[]
): readonly Uint8Array[] {
  const suffixes = new Array<Uint8Array>(pieces.length);
  let follows = false;
  for (let pieceIndex = pieces.length - 1; pieceIndex >= 0; pieceIndex -= 1) {
    const piece = pieces[pieceIndex]!;
    const suffix = new Uint8Array(piece.text.length + 1);
    suffix[piece.text.length] = follows ? 1 : 0;
    if (piece.inlineDrawing) {
      suffix.fill(1);
    } else {
      for (let cursor = piece.text.length - 1; cursor >= 0; cursor -= 1) {
        const ch = piece.text[cursor]!;
        if (ch === '\n' || ch === PAGE_BREAK_CHAR) suffix[cursor] = 0;
        else if (ch !== '\t' && !isCollapsibleLineEndWhitespace(ch)) suffix[cursor] = 1;
        else suffix[cursor] = suffix[cursor + 1]!;
      }
    }
    suffixes[pieceIndex] = suffix;
    follows = suffix[0] === 1;
  }
  return suffixes;
}
