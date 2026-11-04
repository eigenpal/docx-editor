/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Passes over a hunk's token diff that decide how changes read: where a deletion sits, which
 * changes join, when shared words are dropped, and when a paragraph is replaced as a whole.
 */
import { orderHunks, type DiffOp } from './sequence-diff.ts';
import { END_KEY, type Token } from './tokens.ts';
import { pushAll } from './arrays.ts';

/**
 * A deletion that could sit one token earlier with the same result moves there, as far as it
 * can: `a{- b} c` rather than `a {-b }c`. Insertions stay where the diff put them. Only text
 * tokens of characters slide.
 */
export function slideLeft(ops: readonly DiffOp[], a: readonly Token[]): DiffOp[] {
  const out: DiffOp[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.op !== 'del') {
      out.push(ops[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j]!.op === 'del') j++;
    const dels = ops.slice(i, j) as Extract<DiffOp, { op: 'del' }>[];
    i = j;
    // A run next to an insertion is a replacement and stays.
    if ((j < ops.length && ops[j]!.op !== 'eq') || dels.some((op) => !plainText(a[op.a]!))) {
      pushAll(out, dels);
      continue;
    }
    // The run covers consecutive tokens, and so do the equal tokens before it: shifting by k
    // needs each of the k tokens before the run to equal the token k places from its end.
    const first = dels[0]!.a;
    const last = dels[dels.length - 1]!.a;
    let k = 0;
    while (k < out.length) {
      const before = out[out.length - 1 - k]!;
      if (before.op !== 'eq' || before.a !== first - 1 - k) break;
      const token = a[before.a]!;
      if (!plainText(token) || token.key !== a[last - k]!.key) break;
      k++;
    }
    if (k === 0) {
      pushAll(out, dels);
      continue;
    }
    const moved = out.splice(out.length - k, k) as Extract<DiffOp, { op: 'eq' }>[];
    for (let n = first - k; n <= last - k; n++) out.push({ op: 'del', a: n });
    moved.forEach((op, t) => out.push({ op: 'eq', a: last - k + 1 + t, b: op.b }));
  }
  return out;
}

/** Below this share of equal words, a hunk of several paragraphs is unrelated text. */
export const MIN_SHARED_WORDS = 0.3;
/** In unrelated text, equal runs of at least this many words still match. */
export const MIN_KEPT_RUN = 3;

const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * Several paragraphs that share only scattered words are different text: the words they share
 * are not kept, and the hunk is replaced paragraph by paragraph. Tables and the final mark of
 * the container still pair.
 */
export function dropSparseMatches(
  ops: readonly DiffOp[],
  a: readonly Token[],
  several: boolean
): DiffOp[] {
  if (!several) return [...ops];
  let words = 0;
  let shared = 0;
  for (const op of ops) {
    const token = op.op === 'ins' ? null : a[op.a]!;
    if (op.op === 'ins') continue;
    if (token!.kind !== 'text' || !HAS_WORD.test(token!.key)) continue;
    words++;
    if (op.op === 'eq') shared++;
  }
  if (words === 0 || shared / words >= MIN_SHARED_WORDS) return [...ops];
  // Scattered matches go; a run of several equal words in a row stays.
  const out: DiffOp[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.op !== 'eq') {
      out.push(ops[i]!);
      i++;
      continue;
    }
    let j = i;
    let runWords = 0;
    while (j < ops.length && ops[j]!.op === 'eq') {
      const token = a[(ops[j] as Extract<DiffOp, { op: 'eq' }>).a]!;
      if (token.kind === 'text' && HAS_WORD.test(token.key)) runWords++;
      j++;
    }
    for (const op of ops.slice(i, j) as Extract<DiffOp, { op: 'eq' }>[]) {
      const token = a[op.a]!;
      const scattered = runWords < MIN_KEPT_RUN;
      if (scattered && (token.kind === 'text' || (token.kind === 'mark' && token.key !== END_KEY)))
        out.push({ op: 'del', a: op.a }, { op: 'ins', b: op.b });
      else out.push(op);
    }
    i = j;
  }
  return orderHunks(out);
}

/**
 * A paragraph that keeps none of its text is replaced as a whole: the new paragraph is
 * inserted and the old one deleted, each with its own mark. The final mark of a container
 * stays, so its paragraph changes word by word.
 */
export function replaceWholeParagraphs(
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
      pushAll(
        out,
        segment.filter((item) => item.op === 'ins'),
        [{ op: 'ins', b: op.b }],
        segment.filter((item) => item.op === 'del'),
        [{ op: 'del', a: op.a }]
      );
    } else pushAll(out, segment, [op]);
    start = i + 1;
  }
  pushAll(out, ops.slice(start));
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
export function coalesceGaps(ops: readonly DiffOp[], a: readonly Token[]): DiffOp[] {
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
    } else pushAll(out, ops.slice(i, j));
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
