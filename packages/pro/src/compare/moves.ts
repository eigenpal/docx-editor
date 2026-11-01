/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Moved paragraphs: a paragraph deleted in one place and inserted unchanged in another reads
 * as one move, recorded with `w:moveFrom` at the source and `w:moveTo` at the destination.
 */
import { emitContent, paragraphProperties, paragraphXml, type EmitContext } from './emit.ts';
import type { ParagraphUnit, Unit } from './units.ts';

/** A paragraph needs at least this many words before it counts as moved. */
export const MIN_MOVE_WORDS = 3;

export interface MoveEnd {
  readonly kind: 'moveFrom' | 'moveTo';
  readonly name: string;
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
    moves.set(from.unit, { kind: 'moveFrom', name });
    moves.set(to.unit, { kind: 'moveTo', name });
  }
  return moves;
}

/** One end of a move: the paragraph with its content and mark inside a named move range. */
export function movedParagraph(unit: ParagraphUnit, end: MoveEnd, ctx: EmitContext): string {
  const from = end.kind === 'moveFrom';
  const items = unit.atoms.map((atom) => ({
    mark: end.kind,
    atom,
    baseRPr: '',
    markers: from ? atom.markers : [],
  }));
  const pPr = paragraphProperties(end.kind, from ? unit : null, from ? null : unit, ctx);
  const range = ctx.rangeAttrs(end.name);
  const content = emitContent(items, ctx);
  const trailing = from ? unit.trailingMarkers.join('') : '';
  return paragraphXml(
    pPr,
    `<w:${end.kind}RangeStart${range.attrs}/>${content}<w:${end.kind}RangeEnd w:id="${range.id}"/>${trailing}`
  );
}
