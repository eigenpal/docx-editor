/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Word tokens of a compare: the tokenizer and the token kinds a hunk diffs.
 */
import type { MoveEnd } from './moves.ts';
import {
  controlIdentity,
  isControlWrapper,
  type Atom,
  type BlockUnit,
  type FieldContext,
  type ParagraphUnit,
  type Wrapper,
} from './units.ts';

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

/**
 * Short names for word signatures, shared by both sides of one token diff. A word key holds
 * the name, not the signature: a field instruction can be long, and every word in the field
 * would otherwise carry a copy of it. Names are computed once for each pair of wrapper and
 * field arrays, which the atoms of one run share.
 */
export class SignatureNames {
  readonly #byText = new Map<string, string>();
  readonly #byArrays = new WeakMap<readonly Wrapper[], Map<Atom['fields'], string>>();
  readonly #wrappers = new WeakMap<Wrapper, string>();
  readonly #fields = new WeakMap<FieldContext, string>();
  readonly #controls = new WeakMap<readonly Wrapper[], string>();

  /**
   * The short name of the inline controls around an atom, outermost first, by identity, or ''
   * for none. A control without an id is known by its whole properties, which can be long; the
   * two sides then compare names, not the properties, for every character.
   */
  controls(atom: Atom): string {
    let name = this.#controls.get(atom.wrappers);
    if (name === undefined) {
      const text = atom.wrappers
        .filter((wrapper) => isControlWrapper(wrapper.key))
        .map((wrapper) => controlIdentity(wrapper.key))
        .join('\u0003');
      name = text === '' ? '' : this.#named(`C:${text}`);
      this.#controls.set(atom.wrappers, name);
    }
    return name;
  }

  of(atom: Atom): string {
    let byFields = this.#byArrays.get(atom.wrappers);
    if (!byFields) {
      byFields = new Map();
      this.#byArrays.set(atom.wrappers, byFields);
    }
    let name = byFields.get(atom.fields);
    if (name === undefined) {
      // Each wrapper and field is named once, so a long field instruction is read once, not
      // again in every combination of fields it takes part in.
      const parts = [
        ...atom.wrappers
          .filter((wrapper) => !isControlWrapper(wrapper.key))
          .map((wrapper) => this.#cached(this.#wrappers, wrapper, () => wrapper.key)),
        ...(atom.fields ?? []).map((field) =>
          this.#cached(this.#fields, field, () => fieldSignature(field))
        ),
      ];
      name = parts.length === 0 ? '' : this.#named(parts.join('\u0003'));
      byFields.set(atom.fields, name);
    }
    return name;
  }

  #cached<K extends object>(cache: WeakMap<K, string>, key: K, text: () => string): string {
    let name = cache.get(key);
    if (name === undefined) {
      name = this.#named(text());
      cache.set(key, name);
    }
    return name;
  }

  /**
   * The short name of a signature text. Every name holds a letter: the word rules test a key for
   * letters, as they did when it held the signature itself, which always has one.
   */
  #named(text: string): string {
    let name = this.#byText.get(text);
    if (name === undefined) {
      name = `S${this.#byText.size}`;
      this.#byText.set(text, name);
    }
    return name;
  }
}

export function paragraphTokens(
  unit: ParagraphUnit,
  last: boolean,
  out: Token[],
  names: SignatureNames
): void {
  const atoms = unit.atoms;
  let text = '';
  for (const atom of atoms) text += atom.text;
  for (const [from, to] of wordTokens(text)) {
    out.push({ kind: 'text', key: tokenKey(atoms, from, to, names), unit, from, to });
  }
  out.push({ kind: 'mark', key: last ? END_KEY : `${MARK_KEY}${unit.sectPr ? 'S' : ''}`, unit });
}

function tokenKey(atoms: readonly Atom[], from: number, to: number, names: SignatureNames): string {
  let key = '';
  let wrappers = '';
  for (let i = from; i < to; i++) {
    const atom = atoms[i]!;
    const signature = names.of(atom);
    if (i === from ? signature !== '' : signature !== wrappers) key += `\u0002${signature}\u0002`;
    wrappers = signature;
    key += atom.kind === 'char' ? atom.text : `\u0001${atom.key}\u0001`;
  }
  return key;
}

/**
 * Every link or field boundary inside a word is part of the word: one that starts or ends
 * mid-word makes the words differ, so the original's wrapper comes back on reject. Inline
 * content controls do not split words; equal words in different controls move between them.
 * Text in a complex field is part of the field: it never equals the same text outside it,
 * or in a field with another instruction, so the whole field is deleted and inserted.
 */
const fieldSignature = (field: FieldContext) => `F:${field.instr.trim().replace(/\s+/g, ' ')}`;
