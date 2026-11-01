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
import { diffKeys, orderHunks, type DiffOp } from './sequence-diff.ts';
import { objectWithBoxes } from './text-boxes.ts';
import {
  emitContent,
  notePlaceholder,
  paragraphProperties,
  paragraphXml,
  type EmitContext,
  type Item,
} from './emit.ts';
import { findMoves, movedParagraph, NO_MOVES, type MoveEnd, type Moves } from './moves.ts';
import { compareSdt, compareTable } from './table-compare.ts';
import type { Atom, BlockUnit, ParagraphUnit, Unit } from './units.ts';

/** Character classes of the word tokenizer. */
const HAN = /[\p{sc=Han}\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20]/u;
const HIRAGANA = /\p{sc=Hiragana}/u;
const KATAKANA = /[\p{sc=Katakana}\u30FC]/u;
const DICTIONARY = /[\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const SPACE_CHAR = /\s/u;
const APOSTROPHE = /['\u2019]/u;

type CharClass = 'han' | 'hiragana' | 'katakana' | 'dictionary' | 'word' | 'space' | 'other';

function classOf(char: string): CharClass {
  if (HAN.test(char)) return 'han';
  if (HIRAGANA.test(char)) return 'hiragana';
  if (KATAKANA.test(char)) return 'katakana';
  if (DICTIONARY.test(char)) return 'dictionary';
  if (WORD.test(char)) return 'word';
  if (SPACE_CHAR.test(char)) return 'space';
  return 'other';
}

let dictionarySegmenter: Intl.Segmenter | null | undefined;

/**
 * Word tokens as `[from, to)` code-unit ranges. A token is a run of one class: Han text with
 * its full-width punctuation, a kana run, a run of letters and digits, or a run of white space.
 * Scripts written without spaces between words (Thai, Lao, Khmer, Myanmar) split at dictionary
 * word boundaries where the platform offers them. Anything else is one character.
 */
export function wordTokens(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    const code = text.codePointAt(i)!;
    const width = code > 0xffff ? 2 : 1;
    const kind = classOf(text.slice(i, i + width));
    let j = i + width;
    if (kind !== 'other' && kind !== 'space') {
      while (j < text.length) {
        const next = text.codePointAt(j)!;
        const nextWidth = next > 0xffff ? 2 : 1;
        const nextKind = classOf(text.slice(j, j + nextWidth));
        // Combining marks stay with the run they follow.
        if (nextKind !== kind && !(nextKind === 'word' && /\p{M}/u.test(text[j]!))) {
          // An apostrophe between letters stays in the word.
          if (
            kind !== 'word' ||
            !APOSTROPHE.test(text[j]!) ||
            classOf(text[j + 1] ?? '') !== 'word'
          )
            break;
        }
        j += nextWidth;
      }
    }
    if (kind === 'dictionary') splitDictionary(text, i, j, out);
    else out.push([i, j]);
    i = j;
  }
  return out;
}

function splitDictionary(text: string, from: number, to: number, out: Array<[number, number]>) {
  if (dictionarySegmenter === undefined) {
    dictionarySegmenter =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : null;
  }
  if (!dictionarySegmenter) {
    out.push([from, to]);
    return;
  }
  for (const segment of dictionarySegmenter.segment(text.slice(from, to))) {
    out.push([from + segment.index, from + segment.index + segment.segment.length]);
  }
}

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
interface MoveToken {
  readonly kind: 'move';
  readonly key: string;
  readonly unit: ParagraphUnit;
  readonly end: MoveEnd;
}
type Token = TextToken | MarkToken | BlockToken | MoveToken;

function paragraphTokens(unit: ParagraphUnit, last: boolean, out: Token[]): void {
  const atoms = unit.atoms;
  let text = '';
  for (const atom of atoms) text += atom.text;
  for (const [from, to] of wordTokens(text)) {
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
  // Inline content controls do not split or change words; links and fields do.
  const wrappers = atoms[from]!.wrappers.filter((wrapper) => !wrapper.key.startsWith('sdt|'));
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
  ctx: EmitContext,
  /** A whole story added by the revised document: its final paragraph mark stays unmarked. */
  insertedStory = false
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
      const alone = insertedStory && base.length === 0;
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
  const ops = pairBlocks(
    replaceWholeParagraphs(
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
      if (token.key === END_KEY && a.length === 0) {
        // The final mark of an inserted story.
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

/**
 * A deletion that could sit one token earlier with the same result moves there, as far as it
 * can: `a{- b} c` rather than `a {-b }c`. Insertions stay where the diff put them. Only text
 * tokens of characters slide.
 */
function slideLeft(input: readonly DiffOp[], a: readonly Token[]): DiffOp[] {
  const ops = [...input];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.op !== 'del') {
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j]!.op === 'del') j++;
    if (j < ops.length && ops[j]!.op !== 'eq') {
      i = j;
      continue;
    }
    while (i > 0 && ops[i - 1]!.op === 'eq') {
      const before = ops[i - 1] as Extract<DiffOp, { op: 'eq' }>;
      const dels = ops.slice(i, j) as Extract<DiffOp, { op: 'del' }>[];
      const last = dels[dels.length - 1]!;
      if (!plainText(a[before.a]!) || a[before.a]!.key !== a[last.a]!.key) break;
      if (dels.some((op) => !plainText(a[op.a]!))) break;
      // Shift the run one token left: the equal token takes the run's last position.
      ops.splice(i - 1, j - i + 1, { op: 'del', a: before.a }, ...dels.slice(0, -1), {
        op: 'eq',
        a: last.a,
        b: before.b,
      });
      i--;
      j--;
    }
    i = j;
  }
  return ops;
}

/**
 * A paragraph that keeps none of its text is replaced as a whole: the new paragraph is
 * inserted and the old one deleted, each with its own mark. The final mark of a container
 * stays, so its paragraph changes word by word.
 */
function replaceWholeParagraphs(
  ops: readonly DiffOp[],
  a: readonly Token[],
  b: readonly Token[]
): DiffOp[] {
  const out: DiffOp[] = [];
  let start = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.op !== 'eq' || a[op.a]!.kind !== 'mark') continue;
    const segment = ops.slice(start, i);
    const textOnly = segment.every(
      (item) => item.op !== 'eq' && (item.op === 'ins' ? b[item.b] : a[item.a])!.kind === 'text'
    );
    const both =
      segment.some((item) => item.op === 'ins') && segment.some((item) => item.op === 'del');
    if (textOnly && both && a[op.a]!.key !== END_KEY) {
      out.push(
        ...segment.filter((item) => item.op === 'ins'),
        { op: 'ins', b: op.b },
        ...segment.filter((item) => item.op === 'del'),
        { op: 'del', a: op.a }
      );
    } else out.push(...segment, op);
    start = i + 1;
  }
  out.push(...ops.slice(start));
  return out;
}

/** A text token of characters only: objects and note references never slide. */
const plainText = (token: Token) => token.kind === 'text' && !token.key.includes('\u0001');

/** Text with no letters or digits: white space and punctuation. */
const NO_WORD = /^[^\p{L}\p{N}]+$/u;

/**
 * Changes separated only by white space and punctuation read as one change: the text between
 * them is deleted and inserted with them, so a run of replaced words shows as one insertion and one deletion.
 * The joined run must hold both an insertion and a deletion, or absorbing the space would
 * change the text of one side.
 */
function coalesceGaps(ops: readonly DiffOp[], a: readonly Token[]): DiffOp[] {
  const out: DiffOp[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.op !== 'eq') {
      out.push(op);
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j]!.op === 'eq') j++;
    const spaces = ops.slice(i, j).every((eq) => {
      const token = a[(eq as Extract<DiffOp, { op: 'eq' }>).a]!;
      return token.kind === 'text' && NO_WORD.test(token.key);
    });
    if (spaces && i > 0 && j < ops.length && mixedAround(ops, i, j)) {
      for (const eq of ops.slice(i, j) as Extract<DiffOp, { op: 'eq' }>[]) {
        out.push({ op: 'del', a: eq.a }, { op: 'ins', b: eq.b });
      }
    } else out.push(...ops.slice(i, j));
    i = j;
  }
  return orderHunks(out);
}

/** Whether the change runs on either side of `ops[from, to)` hold an insertion and a deletion. */
function mixedAround(ops: readonly DiffOp[], from: number, to: number): boolean {
  let ins = false;
  let del = false;
  for (let k = from - 1; k >= 0 && ops[k]!.op !== 'eq'; k--) {
    if (ops[k]!.op === 'ins') ins = true;
    else del = true;
  }
  for (let k = to; k < ops.length && ops[k]!.op !== 'eq'; k++) {
    if (ops[k]!.op === 'ins') ins = true;
    else del = true;
  }
  return ins && del;
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
