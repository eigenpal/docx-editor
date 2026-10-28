// Line pieces around the combining kana sound marks, U+3099 and U+309A (`sound-mark-spacing.ts`).
import type { FieldAwarePiece } from './field-pieces.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { hasSoundMark } from './sound-mark-spacing.ts';
import type { TextMeasurer } from './text-measurer.ts';

/**
 * Split literal pieces around the sound marks that need a span of their own. Pieces without
 * such a mark are returned as they are. Line breaking still keeps each mark with its base.
 *
 * - A face that draws the mark in a cell of its own (the mark alone measures wider than zero):
 *   the mark lays out, and paints, as its own span, so a renderer that composes a base and a
 *   mark in one string draws them apart.
 * - A face that joins the mark with its base (no advance, and ink inside its own cell): a mark
 *   that opens a piece after its base in another run cannot join it in one string, so it
 *   paints over its base, shifted back by the base advance.
 */
export function splitAtSpacedSoundMarks(
  pieces: FieldAwarePiece[],
  measurer: TextMeasurer
): FieldAwarePiece[] {
  let out: FieldAwarePiece[] | null = null;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const overlay = baseOverlayOffset(pieces[index - 1], piece, measurer);
    const cuts = spacedSoundMarkCuts(piece, measurer);
    if (overlay !== undefined && piece.text.length > 1 && cuts[0] !== 1) cuts.unshift(1);
    if (cuts.length === 0 && overlay === undefined) {
      out?.push(piece);
      continue;
    }
    out ??= pieces.slice(0, index);
    let from = 0;
    for (const to of [...cuts, piece.text.length]) {
      out.push({
        ...piece,
        text: piece.text.slice(from, to),
        start: piece.start + from,
        end: piece.start + to,
        ...(from === 0 && overlay !== undefined ? { glyphOffsetPt: overlay } : {}),
      });
      from = to;
    }
  }
  return out ?? pieces;
}

/**
 * The glyph offset that draws a mark opening `piece` over the last character of `previous`,
 * or undefined. The mark has no advance and its ink lies inside its own cell, so drawn at the
 * pen it would land on the next character.
 */
function baseOverlayOffset(
  previous: FieldAwarePiece | undefined,
  piece: FieldAwarePiece,
  measurer: TextMeasurer
): number | undefined {
  const mark = piece.text[0];
  if ((mark !== '\u3099' && mark !== '\u309A') || !ordinaryPiece(piece)) return undefined;
  if (!previous || !ordinaryPiece(previous) || previous.end !== piece.start) return undefined;
  const base = previous.text.at(-1);
  if (base === undefined || /^[\s\p{M}]$/u.test(base)) return undefined;
  const style = styleForFontSlot(piece.style, piece.fontSlot);
  if (measurer.measure(mark, style) > 0) return undefined;
  const ink = measurer.inkBounds?.(mark, style);
  if (!ink || ink.left < 0) return undefined;
  const advance = measurer.measure(base, styleForFontSlot(previous.style, previous.fontSlot));
  return advance > 0 ? -advance : undefined;
}

function ordinaryPiece(piece: FieldAwarePiece): boolean {
  return (
    piece.end - piece.start === piece.text.length &&
    !piece.projected &&
    piece.measureText === undefined &&
    !piece.fieldAtom &&
    !piece.equation &&
    !piece.inlineDrawing &&
    piece.glyphOffsetPt === undefined
  );
}

function spacedSoundMarkCuts(piece: FieldAwarePiece, measurer: TextMeasurer): number[] {
  if (!hasSoundMark(piece.text) || !ordinaryPiece(piece)) return [];
  const style = styleForFontSlot(piece.style, piece.fontSlot);
  const spaced = new Map<string, boolean>();
  const cuts: number[] = [];
  for (let offset = 0; offset < piece.text.length; offset += 1) {
    const mark = piece.text[offset]!;
    if (mark !== '\u3099' && mark !== '\u309A') continue;
    let spacing = spaced.get(mark);
    if (spacing === undefined) {
      spacing = measurer.measure(mark, style) > 0;
      spaced.set(mark, spacing);
    }
    if (!spacing) continue;
    if (offset > 0 && cuts.at(-1) !== offset) cuts.push(offset);
    if (offset + 1 < piece.text.length) cuts.push(offset + 1);
  }
  return cuts;
}
