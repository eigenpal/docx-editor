/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Word tokens of a compare: the tokenizer and the token kinds a hunk diffs.
 */
import type { MoveEnd } from './moves.ts';
import type { Atom, BlockUnit, ParagraphUnit } from './units.ts';

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

export const MARK_KEY = '¶';
export const END_KEY = '¶END';

export interface TextToken {
  readonly kind: 'text';
  readonly key: string;
  readonly unit: ParagraphUnit;
  readonly from: number;
  readonly to: number;
}
export interface MarkToken {
  readonly kind: 'mark';
  readonly key: string;
  readonly unit: ParagraphUnit;
}
export interface BlockToken {
  readonly kind: 'block';
  readonly key: string;
  readonly unit: BlockUnit;
}
export interface MoveToken {
  readonly kind: 'move';
  readonly key: string;
  readonly unit: ParagraphUnit;
  readonly end: MoveEnd;
}
export type Token = TextToken | MarkToken | BlockToken | MoveToken;

export function paragraphTokens(unit: ParagraphUnit, last: boolean, out: Token[]): void {
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
