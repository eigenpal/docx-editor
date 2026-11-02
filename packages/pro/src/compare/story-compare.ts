/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Compares two block containers (a body, a table cell, a content control) and returns the
 * output blocks as XML.
 *
 * Level one aligns whole blocks by exact content. Each run of unmatched blocks is a hunk; a
 * hunk is diffed as one token stream in which every paragraph mark is a token, so inserted,
 * deleted, split, and merged paragraphs all fall out of the same word-level diff.
 */
import { diffKeys, type DiffOp } from './sequence-diff.ts';
import {
  coalesceGaps,
  dropSparseMatches,
  replaceWholeParagraphs,
  slideLeft,
} from './hunk-rules.ts';
import { END_KEY, paragraphTokens, type BlockToken, type Token } from './tokens.ts';
import { objectWithBoxes } from './text-boxes.ts';
import {
  emitContent,
  notePlaceholder,
  paragraphProperties,
  paragraphXml,
  type EmitContext,
  type Item,
} from './emit.ts';
import { findMoves, movedParagraph, NO_MOVES, type Moves } from './moves.ts';
import { compareSdt, compareTable } from './table-compare.ts';
import {
  isControlWrapper,
  type Atom,
  type BlockUnit,
  type ParagraphUnit,
  type Unit,
} from './units.ts';
import { pushAll } from './arrays.ts';

interface Hunk {
  readonly base: Unit[];
  readonly revised: Unit[];
}

type Step =
  | { readonly kind: 'pair'; readonly base: Unit; readonly revised: Unit }
  | ({ readonly kind: 'hunk' } & Hunk);

export function compareContainer(
  base: readonly Unit[],
  revised: readonly Unit[],
  ctx: EmitContext,
  /** A whole story added or removed: its final paragraph mark stays unmarked. */
  wholeStory = false
): string {
  if (base.length === 0 && revised.length === 0) return '';
  const steps: Step[] = [];
  let hunk: Hunk | null = null;
  for (const op of diffKeys(
    base.map((unit) => unit.key),
    revised.map((unit) => unit.key)
  )) {
    if (op.op === 'eq') {
      hunk = null;
      steps.push({ kind: 'pair', base: base[op.a]!, revised: revised[op.b]! });
    } else {
      if (!hunk) {
        hunk = { base: [], revised: [] };
        steps.push({ kind: 'hunk', ...hunk });
      }
      if (op.op === 'del') hunk.base.push(base[op.a]!);
      else hunk.revised.push(revised[op.b]!);
    }
  }
  foldTrailingPair(steps);
  const lastBase = base[base.length - 1];
  const lastRevised = revised[revised.length - 1];
  const moves = findMoves(
    steps.filter((step): step is Extract<Step, { kind: 'hunk' }> => step.kind === 'hunk'),
    lastBase,
    lastRevised,
    ctx
  );
  let out = '';
  for (const step of steps) {
    if (step.kind === 'pair') {
      out += emitPair(
        step.base,
        step.revised,
        ctx,
        step.base === lastBase && step.revised === lastRevised
      );
    } else {
      const sentinel =
        lastBase?.kind === 'paragraph' &&
        lastRevised?.kind === 'paragraph' &&
        step.base.includes(lastBase) &&
        step.revised.includes(lastRevised);
      const alone = wholeStory && (base.length === 0 || revised.length === 0);
      out += emitHunk(
        step.base,
        step.revised,
        sentinel || alone ? (lastBase ?? null) : null,
        sentinel || alone ? (lastRevised ?? null) : null,
        ctx,
        moves
      );
    }
  }
  return out;
}

/**
 * A container's last paragraph mark can never be inserted or deleted, so a trailing hunk takes
 * in the matched paragraph before it and the two final marks are forced to match.
 */
/** A field data element in a serialized simple field shell. */
const FIELD_DATA = /<[A-Za-z_][\w.-]*:fldData[\s/>]/;

/** The inline content controls around an atom, outermost first. */
const controlsOf = (atom: Atom) =>
  atom.wrappers
    .filter((wrapper) => isControlWrapper(wrapper.key))
    .map((wrapper) => wrapper.key)
    .join('\u0003');

function foldTrailingPair(steps: Step[]): void {
  const last = steps[steps.length - 1];
  const before = steps[steps.length - 2];
  if (last?.kind !== 'hunk' || before?.kind !== 'pair') return;
  if (before.base.kind !== 'paragraph' || before.revised.kind !== 'paragraph') return;
  const base = last.base[last.base.length - 1];
  const revised = last.revised[last.revised.length - 1];
  if (base?.kind === 'paragraph' && revised?.kind === 'paragraph') return;
  steps.splice(steps.length - 2, 2, {
    kind: 'hunk',
    base: [before.base, ...last.base],
    revised: [before.revised, ...last.revised],
  });
}

function emitPair(base: Unit, revised: Unit, ctx: EmitContext, last = false): string {
  if (base.kind === 'paragraph' && revised.kind === 'paragraph')
    return emitHunk([base], [revised], last ? base : null, last ? revised : null, ctx);
  if (base.kind === 'table' && revised.kind === 'table') {
    const copy = identicalCopy(base.node, revised.node, ctx);
    return copy ?? compareTable(base.node, revised.node, ctx);
  }
  if (base.kind === 'sdt' && revised.kind === 'sdt') {
    const copy = identicalCopy(base.node, revised.node, ctx);
    return copy ?? compareSdt(base.node, revised.node, ctx);
  }
  // Equal opaque content: the original's copy references the output's own relationships.
  return ctx.base.serialize(base.node);
}

/** References whose content lives in another part, which the serialized block does not show. */
const OUTSIDE_CONTENT =
  /<(?:[\w.-]+:)?(?:footnoteReference|endnoteReference|commentReference|commentRangeStart)\b/;

/**
 * The original's copy of a block that is the same in both documents, relationships resolved,
 * or null. A block that references notes or comments always compares, so their content does.
 */
function identicalCopy(base: BlockUnit['node'], revised: BlockUnit['node'], ctx: EmitContext) {
  const before = ctx.base.raw(base);
  if (OUTSIDE_CONTENT.test(before)) return null;
  const after = ctx.revised.raw(revised);
  if (ctx.base.keyOf(before) !== ctx.revised.keyOf(after)) return null;
  return ctx.base.remap(before);
}

function tokensOf(units: readonly Unit[], last: Unit | null, moves: Moves): Token[] {
  const out: Token[] = [];
  for (const unit of units) {
    const end = moves.get(unit);
    // A moved paragraph is one token that matches nothing in its hunk.
    if (end && unit.kind === 'paragraph')
      out.push({ kind: 'move', key: `\u0004${end.kind}:${end.name}`, unit, end });
    else if (unit.kind === 'paragraph') paragraphTokens(unit, unit === last, out);
    else out.push({ kind: 'block', key: unit.key, unit });
  }
  return out;
}

function emitHunk(
  base: readonly Unit[],
  revised: readonly Unit[],
  lastBase: Unit | null,
  lastRevised: Unit | null,
  ctx: EmitContext,
  moves: Moves = NO_MOVES
): string {
  const a = tokensOf(base, lastBase, moves);
  const b = tokensOf(revised, lastRevised, moves);
  const ops = deletedBlocksFirst(
    pairBlocks(
      replaceWholeParagraphs(
        dropSparseMatches(
          coalesceGaps(
            slideLeft(
              diffKeys(
                a.map((token) => token.key),
                b.map((token) => token.key)
              ),
              a
            ),
            a
          ),
          a,
          base.length > 1 || revised.length > 1
        ),
        a,
        b
      ),
      a,
      b
    ),
    a,
    b
  );
  let out = '';
  let items: Item[] = [];
  let deferred = '';
  const block = (xml: string) => {
    if (items.length > 0) deferred += xml;
    else out += xml;
  };
  const closeParagraph = (
    mark: 'eq' | 'ins' | 'del',
    baseUnit: ParagraphUnit | null,
    revisedUnit: ParagraphUnit | null
  ) => {
    const trailing =
      (baseUnit && mark !== 'ins' ? baseUnit.trailingMarkers.join('') : '') +
      (revisedUnit && revisedUnit !== baseUnit && mark !== 'del'
        ? revisedUnit.trailingMarkers.join('')
        : '');
    out += paragraphXml(
      paragraphProperties(mark, baseUnit, revisedUnit, ctx),
      emitContent(items, ctx) + trailing
    );
    items = [];
    out += deferred;
    deferred = '';
  };
  for (const op of ops) {
    if (op.op === 'pair') {
      block(compareBlockPair(op.base, op.revised, ctx));
      continue;
    }
    if (op.op === 'eq') {
      const left = a[op.a]!;
      const right = b[op.b]!;
      if (left.kind === 'text' && right.kind === 'text') {
        for (let k = 0; k < left.to - left.from; k++) {
          const baseAtom = left.unit.atoms[left.from + k]!;
          let atom = right.unit.atoms[right.from + k]!;
          if (baseAtom.note && atom.note) {
            // The output keeps the original's note; the two notes compare later.
            ctx.state.notePairs.push({
              kind: atom.note.kind,
              base: baseAtom.note.id,
              revised: atom.note.id,
            });
            atom = { ...atom, xml: baseAtom.xml };
          }
          if (baseAtom.node && atom.node)
            atom = { ...atom, xml: objectWithBoxes(baseAtom, atom, ctx) };
          else if (atom.kind === 'object' && baseAtom.kind === 'object' && !atom.note)
            // Equal objects (pictures, charts, embedded objects) keep the original's markup and
            // relationships, so an unchanged picture is not copied as a new part.
            atom = { ...atom, xml: baseAtom.xml, delXml: baseAtom.delXml };
          // Content control properties have no revision form: equal text inside controls with
          // other properties is not recorded. (A control added or removed around text keeps
          // its shell on the other side, as documented.)
          const before = controlsOf(baseAtom);
          const after = controlsOf(atom);
          if (before !== '' && after !== '' && before !== after) ctx.state.untracked++;
          items.push({
            mark: 'eq',
            atom,
            baseRPr: baseAtom.rPr,
            markers: [...baseAtom.markers, ...atom.markers],
          });
        }
      } else if (left.kind === 'mark' && right.kind === 'mark') {
        closeParagraph('eq', left.unit, right.unit);
      } else if (left.kind === 'block' && right.kind === 'block') {
        block(emitPair(left.unit, right.unit, ctx));
      }
      continue;
    }
    const token = op.op === 'del' ? a[op.a]! : b[op.b]!;
    const mark = op.op;
    if (token.kind === 'text') {
      // A simple field with field data keeps its shell, data included, when all of its result
      // is accepted or rejected away: such a field's changes are not recorded.
      const atoms = token.unit.atoms;
      for (let k = token.from; k < token.to; k++)
        if (
          atoms[k]!.wrappers.some(
            (wrapper) => wrapper.key.startsWith('fldSimple|') && FIELD_DATA.test(wrapper.start)
          )
        ) {
          ctx.state.untracked++;
          break;
        }
      for (let k = token.from; k < token.to; k++) {
        let atom = token.unit.atoms[k]!;
        if (atom.note && mark === 'del')
          ctx.state.deletedNotes.push({ kind: atom.note.kind, base: atom.note.id });
        if (atom.note && mark === 'ins') {
          ctx.state.newNotes.push({ kind: atom.note.kind, revised: atom.note.id });
          const id = notePlaceholder(atom.note.kind, atom.note.id);
          atom = { ...atom, xml: atom.xml.replace(/\bw:id="[^"]*"/, `w:id="${id}"`) };
        }
        if (atom.node) {
          const xml = objectWithBoxes(
            mark === 'del' ? atom : null,
            mark === 'ins' ? atom : null,
            ctx
          );
          atom = { ...atom, xml, delXml: xml };
        }
        items.push({ mark, atom, baseRPr: '', markers: atom.markers });
      }
    } else if (token.kind === 'mark') {
      if (token.key === END_KEY && (a.length === 0 || b.length === 0)) {
        // The final mark of an added or removed story.
        closeParagraph('eq', token.unit, token.unit);
      } else
        closeParagraph(
          mark,
          mark === 'del' ? token.unit : null,
          mark === 'ins' ? token.unit : null
        );
    } else if (token.kind === 'move') {
      block(movedParagraph(token.unit, token.end, ctx));
    } else {
      block(mark === 'del' ? deletedBlock(token.unit, ctx) : insertedBlock(token.unit, ctx));
    }
  }
  if (items.length > 0) {
    // Unreachable for well-formed containers, whose blocks always end in a paragraph mark.
    out += paragraphXml('', emitContent(items, ctx));
    ctx.state.untracked++;
  }
  return out + deferred;
}

type HunkOp =
  | DiffOp
  | { readonly op: 'pair'; readonly base: BlockUnit; readonly revised: BlockUnit };

/**
 * In a run of changes, a deleted and an inserted block of the same kind compare as a pair, in
 * order. The run is cut at each pair, so the content before a pair stays before it on both
 * sides: insertions, then deletions, then the pair.
 */
function pairBlocks(ops: readonly DiffOp[], a: readonly Token[], b: readonly Token[]): HunkOp[] {
  const out: HunkOp[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.op === 'eq') {
      out.push(ops[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j]!.op !== 'eq') j++;
    const run = ops.slice(i, j);
    const inserted = run.filter((op): op is Extract<DiffOp, { op: 'ins' }> => op.op === 'ins');
    const deleted = run.filter((op): op is Extract<DiffOp, { op: 'del' }> => op.op === 'del');
    let fromIns = 0;
    let fromDel = 0;
    // Deleted block positions by kind, each with a cursor: the scan stays linear.
    const blocksByKind = new Map<string, { positions: number[]; next: number }>();
    deleted.forEach((op, d) => {
      const candidate = a[op.a]!;
      if (candidate.kind !== 'block') return;
      const entry = blocksByKind.get(candidate.unit.kind) ?? { positions: [], next: 0 };
      entry.positions.push(d);
      blocksByKind.set(candidate.unit.kind, entry);
    });
    for (let k = 0; k < inserted.length; k++) {
      const token = b[inserted[k]!.b]!;
      if (token.kind !== 'block' || token.unit.kind === 'opaque') continue;
      const entry = blocksByKind.get(token.unit.kind);
      if (!entry) continue;
      while (entry.next < entry.positions.length && entry.positions[entry.next]! < fromDel)
        entry.next++;
      const match = entry.positions[entry.next] ?? -1;
      if (match < 0) continue;
      pushAll(out, inserted.slice(fromIns, k), deleted.slice(fromDel, match));
      out.push({
        op: 'pair',
        base: (a[deleted[match]!.a] as BlockToken).unit,
        revised: token.unit,
      });
      fromIns = k + 1;
      fromDel = match + 1;
    }
    pushAll(out, inserted.slice(fromIns), deleted.slice(fromDel));
    i = j;
  }
  return out;
}

/**
 * In a run of changes with deleted content after a deleted block, the deletions up to that
 * block go before the insertions.
 * Inserted text opens a paragraph that a block cannot enter, so a deleted block after it would
 * land behind the deleted text that follows the block in the original.
 */
function deletedBlocksFirst(
  ops: readonly HunkOp[],
  a: readonly Token[],
  b: readonly Token[]
): HunkOp[] {
  const out: HunkOp[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.op !== 'ins' && op.op !== 'del') {
      out.push(op);
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && (ops[j]!.op === 'ins' || ops[j]!.op === 'del')) j++;
    const run = ops.slice(i, j) as DiffOp[];
    const dels = run.filter((item) => item.op === 'del');
    let cut = -1;
    dels.forEach((item, k) => {
      if (item.op === 'del' && a[item.a]!.kind === 'block') cut = k;
    });
    // Insertions can stay first only when they close their own paragraph: inserted text that
    // runs on into the next paragraph would hold the deleted block back behind that paragraph.
    const lastIns = [...run].reverse().find((item) => item.op === 'ins');
    const closed = lastIns !== undefined && b[lastIns.b]!.kind === 'mark';
    if (cut < 0 || !lastIns || (cut === dels.length - 1 && closed)) pushAll(out, run);
    else {
      const inss = run.filter((item) => item.op === 'ins');
      pushAll(out, dels.slice(0, cut + 1), inss, dels.slice(cut + 1));
    }
    i = j;
  }
  return out;
}

function compareBlockPair(base: BlockUnit, revised: BlockUnit, ctx: EmitContext): string {
  if (base.kind === 'table') return compareTable(base.node, revised.node, ctx);
  return compareSdt(base.node, revised.node, ctx);
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** WordprocessingML blocks that hold content the compare cannot track. */
const CONTENT_BLOCKS = new Set(['altChunk', 'customXml', 'r', 'hyperlink', 'fldSimple']);

/**
 * Content the compare cannot track: an embedded chunk, a custom XML block, a stray run, or an
 * element of another vocabulary. Markers and misplaced properties carry no content.
 */
const holdsContent = (unit: BlockUnit) =>
  unit.node.namespaceUri !== W_NS || CONTENT_BLOCKS.has(unit.node.localName);

function deletedBlock(unit: BlockUnit, ctx: EmitContext): string {
  if (unit.kind === 'table') return compareTable(unit.node, null, ctx);
  if (unit.kind === 'sdt') return compareSdt(unit.node, null, ctx);
  // A marker of the original stays; untrackable content stays and refuses the compare.
  if (holdsContent(unit)) ctx.state.untracked++;
  return ctx.base.serialize(unit.node);
}

function insertedBlock(unit: BlockUnit, ctx: EmitContext): string {
  if (unit.kind === 'table') return compareTable(null, unit.node, ctx);
  if (unit.kind === 'sdt') return compareSdt(null, unit.node, ctx);
  if (holdsContent(unit)) ctx.state.untracked++;
  return '';
}
