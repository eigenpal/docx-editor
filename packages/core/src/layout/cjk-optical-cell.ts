// The cells of a line that demand-only East Asian fitting compresses, and how they classify.
import type { StyleSpanRecord } from './semantic-records.ts';
import { isCjk } from './cjk-paragraph-breaks.ts';

/** Opening and closing East Asian brackets and marks; a colon gives its right side. */
export const OPENING = /^[〈《「『【〔〖〘〚（［｛]$/u;
export const CLOSING = /^[、。〉》」』】〕〗〙〛），．；］｝]$/u;
export const PUNCTUATION = /^[〈《「『【〔〖〘〚（［｛、。〉》」』】〕〗〙〛），．；］｝：]$/u;
export const HAS_PUNCTUATION = /[〈《「『【〔〖〘〚（［｛、。〉》」』】〕〗〙〛），．；］｝：]/u;
/**
 * Latin-face text kept whole on a qualified line: Latin script, digits, symbols, and
 * punctuation. Other scripts and controls refuse, because automatic East Asian spacing
 * (`w:autoSpaceDE`) covers only Latin text.
 */
export const OPAQUE_TEXT = /^[ \p{Script=Latin}\p{N}\p{S}\p{P}\p{M}]+$/u;
/**
 * One East Asian face grapheme kept whole on a qualified line: a digit, symbol, or other
 * punctuation, such as `℃` or `①`. Letters in the East Asian face refuse.
 */
export const EAST_ASIAN_OPAQUE = /^[\p{N}\p{S}\p{P}][\p{M}]*$/u;
export const TOLERANCE = 0.001;
// A curly quote in the East Asian font slot fits like the matching bracket.
export function curlyRole(text: string): 'opening' | 'closing' | undefined {
  if (text === '‘' || text === '“') return 'opening';
  if (text === '’' || text === '”') return 'closing';
  return undefined;
}
/**
 * One grapheme of a line or its candidate group, or one whole opaque span, with what it can
 * still give to a fit.
 */
export interface Cell {
  span: StyleSpanRecord;
  /** The index of the span it comes from: the line's spans first, then the candidates. */
  readonly sourceIndex: number;
  /** A Latin word, number, symbol, or list marker kept whole; it never loses advance. */
  readonly ordinaryOpaque?: true;
  /** A curly quote in the East Asian slot, which fits like the matching bracket. */
  readonly qualifiedCurly?: 'opening' | 'closing';
  /** An East Asian face symbol that is not punctuation, such as `℃` or `①`: never compressed. */
  readonly opaqueGlyph?: true;
  /** The advance without authored tracking. */
  readonly natural: number;
  /** The part of the advance already compressed by tracking or a narrower measure. */
  readonly alreadyReduced: number;
  readonly ink: { left: number; right: number } | undefined;
  /** The advance this fit takes away. */
  reduction: number;
  /** The glyph offset this fit adds: an opening mark moves left by what it gives. */
  shift: number;
}
// A glyph a blank side can face: an ideograph, punctuation, a qualified quote, an East Asian
// face symbol, or Latin-face text. A space is not one.
export function fitNeighbour(cell: Cell): boolean {
  const text = cell.span.text;
  return (
    cell.ordinaryOpaque === true ||
    cell.opaqueGlyph === true ||
    cell.qualifiedCurly !== undefined ||
    PUNCTUATION.test(text) ||
    isCjk(text.codePointAt(0)!)
  );
}
export function finiteInk(cell: Cell): cell is Cell & { ink: { left: number; right: number } } {
  return (
    cell.ink !== undefined &&
    Number.isFinite(cell.ink.left) &&
    Number.isFinite(cell.ink.right) &&
    cell.ink.right >= cell.ink.left
  );
}
/** A mark with a blank side that compresses: a bracket, a closing mark, a colon, or a quote. */
export const blankSided = (cell: Cell): boolean =>
  cell.qualifiedCurly !== undefined ||
  OPENING.test(cell.span.text) ||
  CLOSING.test(cell.span.text) ||
  cell.span.text === '：';
