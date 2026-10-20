/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Where the atoms of a paragraph are, worked out from the text of its word ranges alone.
//
// `getTextRanges([' ', '\t'])` keeps an atom inside the word it touches, and a locked content
// control can span several words, so atoms and words do not line up. This module groups the
// words into CLUSTERS, each a run of words that no control crosses out of, and lays out the atoms
// of each cluster as character intervals: one per locked control, however many sit in one word
// and even when two read the same, and one per object character (an equation, a picture, a note
// reference, or a line break). The text between atoms becomes text pieces, one per word, each
// bounded by a word edge or an atom edge. Nothing here touches a document.

/** U+FFFC, the character an equation, a picture, or a note reference reads as. */
export const OBJECT = String.fromCharCode(0xfffc);
/** U+000B, the character a line break reads as. */
export const LINE_BREAK = String.fromCharCode(0x0b);

/** What the layout needs to know about one word range. */
export interface LayoutWord {
  readonly text: string;
  /**
   * The locked content controls the word overlaps, in order: each control's text, and where it
   * starts in the word as its range reads, or null when that is not known.
   */
  readonly controls: readonly LayoutControl[];
  /** How many fields the word overlaps. */
  readonly fields: number;
}

/** A locked content control in a word. */
export interface LayoutControl {
  readonly text: string;
  readonly start: number | null;
}

/** Where an atom comes from: a word's locked control, or a word's object character. */
export type AtomSource =
  | { readonly type: 'control'; readonly word: number; readonly index: number }
  | {
      readonly type: 'object' | 'break';
      readonly word: number;
      /** Which occurrence of the character in that word, from 0. */
      readonly index: number;
    };

/** One atom, as an interval of the cluster's text. */
export interface LayoutAtom {
  readonly start: number;
  readonly end: number;
  readonly source: AtomSource;
}

/** One text piece: part of one word, between two edges. */
export interface LayoutPiece {
  readonly start: number;
  readonly end: number;
  readonly word: number;
  /** The atom the piece starts after, or null when it starts at the word's start. */
  readonly after: number | null;
  /** The atom the piece ends before, or null when it ends at the word's end. */
  readonly before: number | null;
}

/** The layout of one cluster of words. */
export type Cluster =
  | { readonly kind: 'text'; readonly word: number }
  | { readonly kind: 'field'; readonly word: number }
  | {
      readonly kind: 'atoms';
      readonly first: number;
      readonly last: number;
      /** The cluster's text: its words' texts, joined. */
      readonly text: string;
      readonly atoms: readonly LayoutAtom[];
      /** Atoms and pieces in reading order, as indexes: `{ atom }` or `{ piece }`. */
      readonly order: readonly ({ readonly atom: number } | { readonly piece: number })[];
      readonly pieces: readonly LayoutPiece[];
    }
  | { readonly kind: 'whole'; readonly first: number; readonly last: number };

const hasObject = (text: string) => text.includes(OBJECT) || text.includes(LINE_BREAK);

/** Lay out every word of a paragraph. */
export function layoutWords(words: readonly LayoutWord[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (let first = 0; first < words.length; ) {
    const word = words[first]!;
    if (word.controls.length === 0 && word.fields === 0 && !hasObject(word.text)) {
      clusters.push({ kind: 'text', word: first });
      first += 1;
      continue;
    }
    if (word.controls.length === 0 && word.fields > 0) {
      clusters.push(
        !hasObject(word.text)
          ? { kind: 'field', word: first }
          : { kind: 'whole', first, last: first }
      );
      first += 1;
      continue;
    }
    const cluster = layoutCluster(words, first);
    clusters.push(cluster);
    first = (cluster.kind === 'atoms' || cluster.kind === 'whole' ? cluster.last : first) + 1;
  }
  return clusters;
}

/** Lay out the cluster that starts at word `first`: controls and object characters. */
function layoutCluster(words: readonly LayoutWord[], first: number): Cluster {
  const atoms: LayoutAtom[] = [];
  const starts: number[] = [];
  let offset = 0;
  // A control that started in an earlier word and goes on: its text still to come.
  let pending: { rest: string; atom: number } | null = null;
  let last = first;
  for (let index = first; index < words.length; index += 1) {
    const word = words[index]!;
    if (index > first && pending === null) break;
    if (word.fields > 0) return { kind: 'whole', first, last };
    starts.push(offset);
    last = index;
    let cursor = 0;
    let control = 0;
    if (pending) {
      // The word's first control is the one that goes on into it.
      if (word.controls[0] === undefined || !word.text.startsWith(pending.rest.slice(0, 1))) {
        return { kind: 'whole', first, last };
      }
      const take = Math.min(pending.rest.length, word.text.length);
      if (word.text.slice(0, take) !== pending.rest.slice(0, take)) {
        return { kind: 'whole', first, last };
      }
      const atom = atoms[pending.atom]!;
      atoms[pending.atom] = { ...atom, end: offset + take };
      cursor = take;
      control = 1;
      const { rest, atom: open }: { rest: string; atom: number } = pending;
      pending = take < rest.length ? { rest: rest.slice(take), atom: open } : null;
      if (pending) {
        offset += word.text.length;
        continue;
      }
    }
    for (; control < word.controls.length; control += 1) {
      const { text, start } = word.controls[control]!;
      // Where the control's range starts, when the range said so; its text can also occur
      // earlier in the word, as in `AcmeAcme` before a control that reads `Acme`.
      const placed = start !== null && start >= cursor && word.text.startsWith(text, start);
      const at = placed ? start : start === null ? word.text.indexOf(text, cursor) : -1;
      if (at >= 0) {
        atoms.push({
          start: offset + at,
          end: offset + at + text.length,
          source: { type: 'control', word: index, index: control },
        });
        cursor = at + text.length;
        continue;
      }
      // The control goes on past this word: the word ends with the control's first part.
      const from =
        start !== null && start >= cursor && text.startsWith(word.text.slice(start))
          ? start
          : spanStart(word.text, text, cursor);
      if (from < 0 || control !== word.controls.length - 1) {
        return { kind: 'whole', first, last };
      }
      atoms.push({
        start: offset + from,
        end: offset + word.text.length,
        source: { type: 'control', word: index, index: control },
      });
      pending = { rest: text.slice(word.text.length - from), atom: atoms.length - 1 };
      cursor = word.text.length;
    }
    offset += word.text.length;
  }
  if (pending) return { kind: 'whole', first, last };

  const text = words
    .slice(first, last + 1)
    .map((word) => word.text)
    .join('');
  // Object characters outside every control, numbered per word as the word's search answers.
  for (let index = first; index <= last; index += 1) {
    const word = words[index]!;
    const base = starts[index - first]!;
    for (const [char, type] of [
      [OBJECT, 'object'],
      [LINE_BREAK, 'break'],
    ] as const) {
      let occurrence = 0;
      for (let at = word.text.indexOf(char); at >= 0; at = word.text.indexOf(char, at + 1)) {
        const position = base + at;
        const inside = atoms.some((atom) => atom.start <= position && position < atom.end);
        if (inside) return { kind: 'whole', first, last };
        atoms.push({
          start: position,
          end: position + 1,
          source: { type, word: index, index: occurrence },
        });
        occurrence += 1;
      }
    }
  }
  atoms.sort((a, b) => a.start - b.start);

  // The text between atoms, cut at word edges.
  const pieces: LayoutPiece[] = [];
  const order: ({ atom: number } | { piece: number })[] = [];
  const atomEndingAt = (position: number) => atoms.findIndex((atom) => atom.end === position);
  const atomStartingAt = (position: number) => atoms.findIndex((atom) => atom.start === position);
  const wordAt = (position: number) => {
    let found = 0;
    starts.forEach((start, at) => {
      if (start <= position) found = at;
    });
    return found;
  };
  let position = 0;
  const addText = (to: number) => {
    while (position < to) {
      const word = wordAt(position);
      const wordEnd = (starts[word + 1] ?? text.length) as number;
      const end = Math.min(to, wordEnd);
      const after = position === starts[word] ? null : atomEndingAt(position);
      const before = end === wordEnd ? null : atomStartingAt(end);
      if (after === -1 || before === -1) return false;
      order.push({ piece: pieces.length });
      pieces.push({ start: position, end, word: first + word, after, before });
      position = end;
    }
    return true;
  };
  for (const [index, atom] of atoms.entries()) {
    if (!addText(atom.start)) return { kind: 'whole', first, last };
    order.push({ atom: index });
    position = atom.end;
  }
  if (!addText(text.length)) return { kind: 'whole', first, last };
  return { kind: 'atoms', first, last, text, atoms, order, pieces };
}

/** Where a word's tail starts that is the first part of `text`, at or after `from`, or -1. */
function spanStart(word: string, text: string, from: number): number {
  for (let at = from; at < word.length; at += 1) {
    if (text.startsWith(word.slice(at))) return at;
  }
  return -1;
}
