/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Moved paragraphs: a paragraph deleted in one place and inserted unchanged in another reads
 * as one move, recorded with `w:moveFrom` at the source and `w:moveTo` at the destination.
 */
import { emitContent, paragraphProperties, paragraphXml, type EmitContext } from './emit.ts';
import type { ParagraphUnit, Unit } from './units.ts';

/** Properties of a moved paragraph whose formatting changed: the revised ones, recorded. */
function movedProperties(
  kind: MoveEnd['kind'],
  base: ParagraphUnit,
  revised: ParagraphUnit,
  ctx: EmitContext
): string {
  let rPr = `<w:${kind}${ctx.attrs()}/>${revised.markRPr}`;
  if (base.markRPr !== revised.markRPr)
    rPr += `<w:rPrChange${ctx.attrs()}><w:rPr>${base.markRPr}</w:rPr></w:rPrChange>`;
  const before = base.pPr.join('');
  const after = revised.pPr.join('');
  const change =
    before === after ? '' : `<w:pPrChange${ctx.attrs()}><w:pPr>${before}</w:pPr></w:pPrChange>`;
  return `<w:pPr>${after}<w:rPr>${rPr}</w:rPr>${change}</w:pPr>`;
}

/** A paragraph needs at least this many words before it counts as moved. */
export const MIN_MOVE_WORDS = 3;

export interface MoveEnd {
  readonly kind: 'moveFrom' | 'moveTo';
  readonly name: string;
  /** The paragraph at the other end of the move. */
  readonly partner: ParagraphUnit;
}

export type Moves = ReadonlyMap<Unit, MoveEnd>;

export const NO_MOVES: Moves = new Map();

const WORD = /[\p{L}\p{N}]+/gu;

function movable(unit: Unit, last: Unit | undefined): unit is ParagraphUnit {
  if (unit.kind !== 'paragraph' || unit === last || unit.sectPr) return false;
  if (unit.atoms.some((atom) => atom.kind !== 'char')) return false;
  const text = unit.atoms.map((atom) => atom.text).join('');
  return (text.match(WORD)?.length ?? 0) >= MIN_MOVE_WORDS;
}

/**
 * Pairs paragraphs deleted from one hunk with identical paragraphs inserted in a different
 * hunk of the same container. Only a text that occurs once on each side pairs.
 */
export function findMoves(
  hunks: readonly { readonly base: readonly Unit[]; readonly revised: readonly Unit[] }[],
  lastBase: Unit | undefined,
  lastRevised: Unit | undefined,
  ctx: EmitContext
): Moves {
  if (hunks.length < 2) return NO_MOVES;
  const deleted = new Map<string, { unit: ParagraphUnit; hunk: number } | null>();
  const inserted = new Map<string, { unit: ParagraphUnit; hunk: number } | null>();
  hunks.forEach((hunk, index) => {
    for (const unit of hunk.base) {
      if (!movable(unit, lastBase)) continue;
      deleted.set(unit.key, deleted.has(unit.key) ? null : { unit, hunk: index });
    }
    for (const unit of hunk.revised) {
      if (!movable(unit, lastRevised)) continue;
      inserted.set(unit.key, inserted.has(unit.key) ? null : { unit, hunk: index });
    }
  });
  const moves = new Map<Unit, MoveEnd>();
  for (const [key, from] of deleted) {
    const to = inserted.get(key);
    if (!from || !to || from.hunk === to.hunk) continue;
    const name = `move${++ctx.state.moves}`;
    moves.set(from.unit, { kind: 'moveFrom', name, partner: to.unit });
    moves.set(to.unit, { kind: 'moveTo', name, partner: from.unit });
  }
  return moves;
}

/**
 * One end of a move: the paragraph with its content and mark inside a named move range. When
 * the moved paragraph's formatting changed, both ends carry the revised formatting with the
 * original's in change records: a reject restores the source with the original formatting,
 * and an accept keeps the destination with the revised formatting.
 */
export function movedParagraph(unit: ParagraphUnit, end: MoveEnd, ctx: EmitContext): string {
  const from = end.kind === 'moveFrom';
  const base = from ? unit : end.partner;
  const revised = from ? end.partner : unit;
  const formatted =
    ctx.detectFormatChanges &&
    base.atoms.length === revised.atoms.length &&
    (base.pPr.join('') !== revised.pPr.join('') ||
      base.markRPr !== revised.markRPr ||
      base.atoms.some((atom, i) => atom.rPr !== revised.atoms[i]!.rPr));
  const items = unit.atoms.map((atom, i) => {
    if (!formatted) return { mark: end.kind, atom, baseRPr: atom.rPr, markers: atom.markers };
    const rPr = revised.atoms[i]!.rPr;
    return {
      mark: end.kind,
      atom: from ? { ...atom, rPr } : atom,
      baseRPr: base.atoms[i]!.rPr,
      markers: atom.markers,
    };
  });
  const pPr = formatted
    ? movedProperties(end.kind, base, revised, ctx)
    : paragraphProperties(end.kind, from ? unit : null, from ? null : unit, ctx);
  const range = ctx.rangeAttrs(end.name);
  const content = emitContent(items, ctx);
  const trailing = unit.trailingMarkers.join('');
  return paragraphXml(
    pPr,
    `<w:${end.kind}RangeStart${range.attrs}/>${content}<w:${end.kind}RangeEnd w:id="${range.id}"/>${trailing}`
  );
}
