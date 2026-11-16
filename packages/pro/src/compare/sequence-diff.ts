/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { pushAll } from './arrays.ts';

/**
 * Bounded Myers diff over string keys.
 *
 * Common prefix and suffix are trimmed first. The trace keeps only the live diagonals of each
 * round, so memory is O(D^2) in the edit distance D. Past `maxEdits` the middle is reported as
 * one deletion followed by one insertion, which is always a correct (if coarse) answer.
 */

export type DiffOp =
  | { readonly op: 'eq'; readonly a: number; readonly b: number }
  | { readonly op: 'del'; readonly a: number }
  | { readonly op: 'ins'; readonly b: number };

export const DEFAULT_MAX_EDITS = 3000;

export function diffKeys(
  a: readonly string[],
  b: readonly string[],
  maxEdits = DEFAULT_MAX_EDITS
): DiffOp[] {
  return diffKeysWithin(a, b, maxEdits) ?? coarseDiff(a, b);
}

/**
 * The diff of `a` and `b`, or null when it needs more than `maxEdits` edits after the common
 * prefix and suffix, so the caller can split the work instead of taking the coarse answer.
 */
export function diffKeysWithin(
  a: readonly string[],
  b: readonly string[],
  maxEdits = DEFAULT_MAX_EDITS
): DiffOp[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const inner = middle(a, b, start, endA, start, endB, maxEdits);
  if (!inner) return null;
  const out: DiffOp[] = [];
  for (let i = 0; i < start; i++) out.push({ op: 'eq', a: i, b: i });
  pushAll(out, inner);
  for (let i = 0; endA + i < a.length; i++) out.push({ op: 'eq', a: endA + i, b: endB + i });
  return out;
}

function middle(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  maxEdits: number
): DiffOp[] | null {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0 && m === 0) return [];
  if (n === 0) return Array.from({ length: m }, (_, i) => ({ op: 'ins' as const, b: b0 + i }));
  if (m === 0) return Array.from({ length: n }, (_, i) => ({ op: 'del' as const, a: a0 + i }));
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  const limit = Math.min(max, maxEdits);
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  const reversed: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!;
    const at = (diagonal: number) => prev[diagonal + d]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      reversed.push({ op: 'eq', a: a0 + x, b: b0 + y });
    }
    if (down) reversed.push({ op: 'ins', b: b0 + prevY });
    else reversed.push({ op: 'del', a: a0 + prevX });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    reversed.push({ op: 'eq', a: a0 + x, b: b0 + y });
  }
  return orderHunks(reversed.reverse());
}

/** Within each run of changes, insertions come before deletions. */
export function orderHunks(ops: readonly DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  let dels: DiffOp[] = [];
  let inss: DiffOp[] = [];
  const flush = () => {
    pushAll(out, inss, dels);
    dels = [];
    inss = [];
  };
  for (const op of ops) {
    if (op.op === 'eq') {
      flush();
      out.push(op);
    } else if (op.op === 'del') dels.push(op);
    else inss.push(op);
  }
  flush();
  return out;
}

/**
 * Every item between the common prefix and suffix deleted, then every item inserted: always
 * correct, if coarse. Deletions come first here, as they always have for this answer.
 */
function coarseDiff(a: readonly string[], b: readonly string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffOp[] = [];
  for (let i = 0; i < start; i++) out.push({ op: 'eq', a: i, b: i });
  for (let i = start; i < endA; i++) out.push({ op: 'del', a: i });
  for (let i = start; i < endB; i++) out.push({ op: 'ins', b: i });
  for (let i = 0; endA + i < a.length; i++) out.push({ op: 'eq', a: endA + i, b: endB + i });
  return out;
}

/**
 * A diff that stays fine-grained past the edit limit. When the whole diff needs more edits,
 * and `a` and `b` hold the same separators (equal keys, in the same order), the separators pair
 * and each stretch between them is diffed on its own, within its own limit. Otherwise the
 * answer is the coarse one. A document whose every paragraph changes a little then still shows
 * each change, not one deletion of the whole text and one insertion of the new text.
 */
export function diffKeysBySeparators(
  a: readonly string[],
  b: readonly string[],
  separatorA: (index: number) => boolean,
  separatorB: (index: number) => boolean,
  maxEdits = DEFAULT_MAX_EDITS
): DiffOp[] {
  const whole = diffKeysWithin(a, b, maxEdits);
  if (whole) return whole;
  const sa: number[] = [];
  const sb: number[] = [];
  for (let i = 0; i < a.length; i++) if (separatorA(i)) sa.push(i);
  for (let i = 0; i < b.length; i++) if (separatorB(i)) sb.push(i);
  if (sa.length === 0 || sa.length !== sb.length || sa.some((at, k) => a[at] !== b[sb[k]!]))
    return coarseDiff(a, b);
  const out: DiffOp[] = [];
  let fromA = 0;
  let fromB = 0;
  for (let k = 0; k <= sa.length; k++) {
    const toA = k < sa.length ? sa[k]! : a.length;
    const toB = k < sb.length ? sb[k]! : b.length;
    for (const op of diffKeys(a.slice(fromA, toA), b.slice(fromB, toB), maxEdits)) {
      if (op.op === 'eq') out.push({ op: 'eq', a: op.a + fromA, b: op.b + fromB });
      else if (op.op === 'del') out.push({ op: 'del', a: op.a + fromA });
      else out.push({ op: 'ins', b: op.b + fromB });
    }
    if (k < sa.length) out.push({ op: 'eq', a: toA, b: toB });
    fromA = toA + 1;
    fromB = toB + 1;
  }
  return out;
}
