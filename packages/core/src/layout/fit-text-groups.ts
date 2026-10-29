// Run-level `w:fitText` (ECMA-376 §17.3.2.14): text that takes an exact width.
//
// Consecutive runs whose `w:fitText` carries the same `w:id` form ONE group (an absent id
// matches an absent id), and a run without the property ends it. The group takes the
// `w:val` of its first run, in twips, whatever width its characters have:
//
// - Narrower text spreads: every character except the last gets the same extra advance, so
//   the last character ends exactly at the stated width. A one-character group carries the
//   whole extra advance after that character.
// - Wider text compresses: every character advance scales by the same factor.
//
// The group recomputes its spacing from its own text, so the authored `w:spacing` and `w:w`
// of its runs do not apply inside it. Text typed into the group joins it and the group fits
// again. The group is one unit for line breaking: no line opens inside it.
//
// This module rewrites piece STYLES only (character spacing and horizontal scale), which
// every measurer and painter already honors, and splits off the group's last character so
// it keeps its own advance. Source text and model offsets never change.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { LineOpenDecision } from './cjk-line-break.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { isLayoutOwnedPiece } from './layout-owned-piece.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './text-measurer.ts';

/** Largest stated width honored, in twips (22 inches, the widest page the schema allows). */
const MAX_FIT_TEXT_TWIPS = 31_680;
/** Longest `w:id` compared; a longer one is file noise and leaves the run unfitted. */
const MAX_FIT_TEXT_ID_CHARS = 64;

const fitTextGroupStart = Symbol('fit-text-group-start');
type Grouped = { readonly [fitTextGroupStart]?: number };

interface FitTextSpec {
  readonly widthPt: number;
  readonly id: string;
}

/** The run's `w:fitText`, or null when it states none or states an unusable width. */
function fitTextOf(props: readonly OoxmlProperty[]): FitTextSpec | null {
  let found: OoxmlProperty | undefined;
  for (const property of props) if (property.localName === 'fitText') found = property;
  if (!found) return null;
  const raw = found.attributes?.val;
  if (raw === undefined || !/^\d{1,6}$/.test(raw)) return null;
  const twips = Number(raw);
  if (twips <= 0 || twips > MAX_FIT_TEXT_TWIPS) return null;
  const id = found.attributes?.id ?? '';
  if (id.length > MAX_FIT_TEXT_ID_CHARS) return null;
  return { widthPt: twips / 20, id };
}

/** Plain text a group can hold: no tab, break, field result, drawing, or stand-in width. */
function fittablePiece(piece: FieldAwarePiece): boolean {
  return (
    piece.text.length > 0 &&
    !isLayoutOwnedPiece(piece) &&
    piece.measureText === undefined &&
    !piece.fieldAtom &&
    !piece.inlineDrawing &&
    !piece.equation &&
    !piece.positionalTab &&
    !piece.breakKind &&
    !piece.noteSeparator &&
    !piece.unsupported &&
    !piece.anchoredAtom &&
    !/[\t\n\r\f]/.test(piece.text)
  );
}

function withStyle(
  piece: FieldAwarePiece,
  style: ResolvedRunStyle,
  groupStart: number,
  from = 0,
  to = piece.text.length
): FieldAwarePiece {
  return {
    ...piece,
    text: piece.text.slice(from, to),
    start: piece.start + from,
    end: piece.start + to,
    style,
    [fitTextGroupStart]: groupStart,
  } as FieldAwarePiece;
}

function fitGroup(
  group: readonly FieldAwarePiece[],
  widthPt: number,
  measurer: TextMeasurer
): FieldAwarePiece[] {
  // Measured unspaced and unscaled: the group's own spacing replaces the authored values.
  const plain = group.map((piece) => ({
    ...piece.style,
    characterSpacingPt: 0,
    horizontalScalePercent: 100,
  }));
  let natural = 0;
  let units = 0;
  group.forEach((piece, index) => {
    const face = styleForFontSlot(plain[index]!, piece.fontSlot);
    natural += measurer.measure(displayText(piece.text, face), face);
    units += piece.text.length;
  });
  const groupStart = group[0]!.start;
  if (!(natural > 0) || !Number.isFinite(natural)) {
    return group.map((piece, index) => withStyle(piece, plain[index]!, groupStart));
  }
  if (natural >= widthPt) {
    const horizontalScalePercent = (100 * widthPt) / natural;
    return group.map((piece, index) =>
      withStyle(piece, { ...plain[index]!, horizontalScalePercent }, groupStart)
    );
  }
  // Spacing applies after every UTF-16 unit it covers; the last character keeps none, unless
  // it is the only one, which then carries the whole extra advance.
  const last = group[group.length - 1]!;
  const lastLength = /[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(last.text) ? 2 : 1;
  const spread = units - lastLength;
  const extra = widthPt - natural;
  const gap = spread > 0 ? extra / spread : extra / lastLength;
  const out: FieldAwarePiece[] = [];
  group.forEach((piece, index) => {
    const spaced = { ...plain[index]!, characterSpacingPt: gap };
    if (piece !== last || spread === 0) {
      out.push(withStyle(piece, spaced, groupStart));
      return;
    }
    const cut = piece.text.length - lastLength;
    if (cut > 0) out.push(withStyle(piece, spaced, groupStart, 0, cut));
    out.push(withStyle(piece, plain[index]!, groupStart, cut));
  });
  return out;
}

/**
 * Fit every `w:fitText` group in a paragraph's pieces to its stated width.
 *
 * Returns `pieces` itself when no piece carries the property, so paragraphs without fitted
 * text pay one property scan per piece.
 */
export function fitTextGroups(
  pieces: readonly FieldAwarePiece[],
  measurer: TextMeasurer
): FieldAwarePiece[] {
  let out: FieldAwarePiece[] | null = null;
  let index = 0;
  while (index < pieces.length) {
    const piece = pieces[index]!;
    const spec = fittablePiece(piece) ? fitTextOf(piece.props) : null;
    if (!spec) {
      out?.push(piece);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < pieces.length) {
      const next = pieces[end]!;
      if (next.start !== pieces[end - 1]!.end || !fittablePiece(next)) break;
      const nextSpec = fitTextOf(next.props);
      if (!nextSpec || nextSpec.id !== spec.id) break;
      end += 1;
    }
    out ??= pieces.slice(0, index);
    out.push(...fitGroup(pieces.slice(index, end), spec.widthPt, measurer));
    index = end;
  }
  return out ?? (pieces as FieldAwarePiece[]);
}

/**
 * The line-open decision inside a fitted group: no line opens after its first character, so
 * the group moves to the next line whole. A group wider than its line is cut like any word.
 */
export function fitTextOpenDecision(
  piece: FieldAwarePiece,
  consumed: number,
  decision: LineOpenDecision
): LineOpenDecision {
  const groupStart = (piece as Grouped)[fitTextGroupStart];
  if (decision !== 'opens' || groupStart === undefined) return decision;
  return piece.start + consumed > groupStart ? 'continues' : decision;
}
