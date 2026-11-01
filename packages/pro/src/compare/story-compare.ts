/**
 * Compares two block containers (a body, a table cell, a content control) and returns the
 * output blocks as XML.
 *
 * Level one aligns whole blocks by exact content. Each run of unmatched blocks is a hunk; a
 * hunk is diffed as one token stream in which every paragraph mark is a token, so inserted,
 * deleted, split, and merged paragraphs all fall out of the same word-level diff.
 */
import { diffKeys, type DiffOp } from './sequence-diff.ts';
import { objectWithBoxes } from './text-boxes.ts';
import {
  emitContent,
  notePlaceholder,
  paragraphProperties,
  paragraphXml,
  type EmitContext,
  type Item,
} from './emit.ts';
import { compareSdt, compareTable } from './table-compare.ts';
import type { Atom, BlockUnit, ParagraphUnit, Unit } from './units.ts';

/** Word-level tokens. Scripts written without spaces compare one character at a time. */
const TOKEN =
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}\p{sc=Tibetan}]|[\p{L}\p{M}\p{N}_]+|\s+|./gsu;

const MARK_KEY = '¶';
const END_KEY = '¶END';

interface TextToken {
  readonly kind: 'text';
  readonly key: string;
  readonly unit: ParagraphUnit;
  readonly from: number;
  readonly to: number;
}
interface MarkToken {
  readonly kind: 'mark';
  readonly key: string;
  readonly unit: ParagraphUnit;
}
interface BlockToken {
  readonly kind: 'block';
  readonly key: string;
  readonly unit: BlockUnit;
}
type Token = TextToken | MarkToken | BlockToken;

function paragraphTokens(unit: ParagraphUnit, last: boolean, out: Token[]): void {
  const atoms = unit.atoms;
  let text = '';
  for (const atom of atoms) text += atom.text;
  for (const match of text.matchAll(TOKEN)) {
    const from = match.index;
    const to = from + match[0].length;
    out.push({ kind: 'text', key: tokenKey(atoms, from, to), unit, from, to });
  }
  out.push({ kind: 'mark', key: last ? END_KEY : `${MARK_KEY}${unit.sectPr ? 'S' : ''}`, unit });
}

function tokenKey(atoms: readonly Atom[], from: number, to: number): string {
  let key = '';
  for (let i = from; i < to; i++) {
    const atom = atoms[i]!;
    key += atom.kind === 'char' ? atom.text : `\u0001${atom.key}\u0001`;
  }
  const wrappers = atoms[from]!.wrappers;
  if (wrappers.length > 0) key += `\u0002${wrappers.map((wrapper) => wrapper.key).join('\u0003')}`;
  return key;
}

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
  ctx: EmitContext
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
      out += emitHunk(
        step.base,
        step.revised,
        sentinel ? lastBase : null,
        sentinel ? lastRevised : null,
        ctx
      );
    }
  }
  return out;
}

/**
 * A container's last paragraph mark can never be inserted or deleted, so a trailing hunk takes
 * in the matched paragraph before it and the two final marks are forced to match.
 */
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
  if (base.kind === 'table' && revised.kind === 'table')
    return compareTable(base.node, revised.node, ctx);
  if (base.kind === 'sdt' && revised.kind === 'sdt')
    return compareSdt(base.node, revised.node, ctx);
  // Equal opaque content: the original's copy references the output's own relationships.
  return ctx.base.serialize(base.node);
}

function tokensOf(units: readonly Unit[], last: Unit | null): Token[] {
  const out: Token[] = [];
  for (const unit of units) {
    if (unit.kind === 'paragraph') paragraphTokens(unit, unit === last, out);
    else out.push({ kind: 'block', key: unit.key, unit });
  }
  return out;
}

function emitHunk(
  base: readonly Unit[],
  revised: readonly Unit[],
  lastBase: Unit | null,
  lastRevised: Unit | null,
  ctx: EmitContext
): string {
  const a = tokensOf(base, lastBase);
  const b = tokensOf(revised, lastRevised);
  const ops = pairBlocks(
    diffKeys(
      a.map((token) => token.key),
      b.map((token) => token.key)
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
    const trailing = baseUnit && mark !== 'ins' ? baseUnit.trailingMarkers.join('') : '';
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
          items.push({ mark: 'eq', atom, baseRPr: baseAtom.rPr, markers: baseAtom.markers });
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
        items.push({ mark, atom, baseRPr: '', markers: mark === 'del' ? atom.markers : [] });
      }
    } else if (token.kind === 'mark') {
      closeParagraph(mark, mark === 'del' ? token.unit : null, mark === 'ins' ? token.unit : null);
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

/** In a run of changes, a deleted and an inserted block of the same kind compare as a pair. */
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
    const deleted = run.filter(
      (op): op is Extract<DiffOp, { op: 'del' }> => op.op === 'del' && a[op.a]!.kind === 'block'
    );
    const used = new Set<DiffOp>();
    const pairs = new Map<DiffOp, BlockUnit>();
    for (const op of run) {
      if (op.op !== 'ins') continue;
      const token = b[op.b]!;
      if (token.kind !== 'block' || token.unit.kind === 'opaque') continue;
      const match = deleted.find(
        (candidate) =>
          !used.has(candidate) && (a[candidate.a] as BlockToken).unit.kind === token.unit.kind
      );
      if (!match) continue;
      used.add(match);
      pairs.set(op, (a[match.a] as BlockToken).unit);
    }
    for (const op of run) {
      if (used.has(op)) continue;
      const paired = pairs.get(op);
      if (paired && op.op === 'ins')
        out.push({ op: 'pair', base: paired, revised: (b[op.b] as BlockToken).unit });
      else out.push(op);
    }
    i = j;
  }
  return out;
}

function compareBlockPair(base: BlockUnit, revised: BlockUnit, ctx: EmitContext): string {
  if (base.kind === 'table') return compareTable(base.node, revised.node, ctx);
  return compareSdt(base.node, revised.node, ctx);
}

function deletedBlock(unit: BlockUnit, ctx: EmitContext): string {
  if (unit.kind === 'table') return compareTable(unit.node, null, ctx);
  if (unit.kind === 'sdt') return compareSdt(unit.node, null, ctx);
  // Untrackable original content stays.
  ctx.state.untracked++;
  return ctx.base.serialize(unit.node);
}

function insertedBlock(unit: BlockUnit, ctx: EmitContext): string {
  if (unit.kind === 'table') return compareTable(null, unit.node, ctx);
  if (unit.kind === 'sdt') return compareSdt(null, unit.node, ctx);
  ctx.state.untracked++;
  return '';
}
