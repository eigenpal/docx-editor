/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Enter moves a paragraph's tail into a new paragraph. Most moved characters keep their text
// element and match by it, but the head of a split run gets a new element, and text whose
// formatting a concurrent edit dropped names none. Each such piece is moved text all the
// same: without its identity, a peer's copy of it shows twice.

import { describe, expect, test } from 'bun:test';
import { markMoves, ORIGIN_KEY, type ParagraphWrite } from '../document/paragraph-text-moves.ts';

interface Token {
  readonly insert: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly position?: number;
}

/** Characters of one text element; `element` empty for text that names none. */
function chars(value: string, element: string, from = 0): Token[] {
  const attributes: Readonly<Record<string, string>> = element ? { t: element } : {};
  return [...value].map((insert, at) => ({ insert, attributes, position: from + at }));
}

function originsOf(tokens: readonly Token[]): (string | null)[] {
  return tokens.map((token) => token.attributes[ORIGIN_KEY] ?? null);
}

describe('move matching', () => {
  test('every piece a split moves keeps its identity, also between matched pieces', () => {
    // The source paragraph: "ab" stays; "cd" is the split run's tail, "EF" keeps its
    // element, "gh" lost its formatting, and "IJ" keeps its element.
    const before = [
      ...chars('abcd', 'one'),
      ...chars('EF', 'two', 4),
      ...chars('gh', '', 6),
      ...chars('IJ', 'two', 8),
    ];
    const identities = before.map((_, at) => `5:${at}`);
    const source: ParagraphWrite<Token> = {
      before,
      after: before.slice(0, 2),
      steps: before.map((_, at) =>
        at < 2 ? { op: 'eq', before: at, after: at } : { op: 'del', before: at }
      ),
      identities,
    };
    const moved = [
      ...chars('cd', 'new'),
      ...chars('EF', 'two'),
      ...chars('gh', 'two'),
      ...chars('IJ', 'two'),
    ].map(({ insert, attributes }) => ({ insert, attributes }));
    const target: ParagraphWrite<Token> = {
      before: [],
      after: moved,
      steps: moved.map((_, at) => ({ op: 'ins', after: at })),
      identities: [],
    };
    markMoves(
      [source, target],
      (token, origin) => ({ ...token, attributes: { ...token.attributes, [ORIGIN_KEY]: origin } }),
      (token) => JSON.stringify(token.attributes),
      (token) => token.attributes.t ?? ''
    );
    // Every moved character names the identity of the character it copies.
    expect(originsOf(target.after)).toEqual(identities.slice(2));
  });

  test('a run moved whole keeps its order, whatever elements the split gives its letters', () => {
    // "ab" came from another paragraph and kept that element; the last "a" is the
    // paragraph's own. By element alone, the first "a" would take the own letter's identity.
    const before = [...chars('ab', 'copied'), ...chars('a', 'own', 2)];
    const identities = ['5:0', '5:1', '1:7'];
    const source: ParagraphWrite<Token> = {
      before,
      after: [],
      steps: before.map((_, at) => ({ op: 'del', before: at })),
      identities,
    };
    // The split puts every letter in the paragraph's own element.
    const moved = chars('aba', 'own').map(({ insert, attributes }) => ({ insert, attributes }));
    const target: ParagraphWrite<Token> = {
      before: [],
      after: moved,
      steps: moved.map((_, at) => ({ op: 'ins', after: at })),
      identities: [],
    };
    markMoves(
      [source, target],
      (token, origin) => ({ ...token, attributes: { ...token.attributes, [ORIGIN_KEY]: origin } }),
      (token) => JSON.stringify(token.attributes),
      (token) => token.attributes.t ?? ''
    );
    expect(originsOf(target.after)).toEqual(identities);
  });

  test('a short piece of the same letters typed elsewhere is not the deleted text', () => {
    const before = chars('abc', 'one');
    const source: ParagraphWrite<Token> = {
      before,
      after: [],
      steps: before.map((_, at) => ({ op: 'del', before: at })),
      identities: before.map((_, at) => `5:${at}`),
    };
    const typed = chars('b', 'new').map(({ insert, attributes }) => ({ insert, attributes }));
    const target: ParagraphWrite<Token> = {
      before: [],
      after: typed,
      steps: [{ op: 'ins', after: 0 }],
      identities: [],
    };
    markMoves(
      [source, target],
      (token, origin) => ({ ...token, attributes: { ...token.attributes, [ORIGIN_KEY]: origin } }),
      (token) => JSON.stringify(token.attributes),
      (token) => token.attributes.t ?? ''
    );
    expect(originsOf(target.after)).toEqual([null]);
  });
});

/** Paragraphs this edit creates, one for each value, of letters in a new text element. */
function newParagraphs(values: readonly string[]): ParagraphWrite<Token>[] {
  return values.map((value) => {
    const after = chars(value, 'new').map(({ insert, attributes }) => ({ insert, attributes }));
    return {
      before: [],
      after,
      steps: after.map((_, at) => ({ op: 'ins' as const, after: at })),
      identities: [],
    };
  });
}

describe('move matching of split pieces', () => {
  /** "One; two; three" keeps "One" and deletes the rest. */
  function splitSource(): ParagraphWrite<Token> {
    const before = chars('One; two; three', 'one');
    return {
      before,
      after: before.slice(0, 3),
      steps: before.map((_, at) =>
        at < 3 ? { op: 'eq', before: at, after: at } : { op: 'del', before: at }
      ),
      identities: before.map((_, at) => `5:${at}`),
    };
  }

  function mark(writes: readonly ParagraphWrite<Token>[]): void {
    markMoves(
      writes,
      (token, origin) => ({ ...token, attributes: { ...token.attributes, [ORIGIN_KEY]: origin } }),
      (token) => JSON.stringify(token.attributes),
      (token) => token.attributes.t ?? ''
    );
  }

  test('pieces of a split that trims its delimiters keep the identities they copy', () => {
    const [two, three] = newParagraphs(['two', 'three']) as [
      ParagraphWrite<Token>,
      ParagraphWrite<Token>,
    ];
    mark([splitSource(), two, three]);
    expect(originsOf(two.after)).toEqual(['5:5', '5:6', '5:7']);
    expect(originsOf(three.after)).toEqual(['5:10', '5:11', '5:12', '5:13', '5:14']);
  });

  test('a few of the deleted letters in new paragraphs are not pieces of it', () => {
    const [first, second] = newParagraphs(['t', 'e']) as [
      ParagraphWrite<Token>,
      ParagraphWrite<Token>,
    ];
    mark([splitSource(), first, second]);
    expect(originsOf(first.after)).toEqual([null]);
    expect(originsOf(second.after)).toEqual([null]);
  });
});

describe('move matching cost', () => {
  test('an edit that rewrites many paragraphs stays within its comparison budget', () => {
    // Four hundred paragraphs lose their text and four hundred others get new text of the
    // same letters. Comparing every inserted run with every deleted one, again after each
    // match, costs billions of comparisons without a budget for the whole edit.
    let seed = 11;
    const letter = (): string => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return 'abcdefgh'[seed % 8]!;
    };
    const text = (): string => Array.from({ length: 100 }, letter).join('');
    const writes: ParagraphWrite<Token>[] = [];
    for (let paragraph = 0; paragraph < 400; paragraph += 1) {
      const before = chars(text(), `old${paragraph}`);
      writes.push({
        before,
        after: [],
        steps: before.map((_, at) => ({ op: 'del', before: at })),
        identities: before.map((_, at) => `${paragraph + 1}:${at}`),
      });
    }
    for (let paragraph = 0; paragraph < 400; paragraph += 1) {
      const after = chars(text(), `new${paragraph}`).map(({ insert, attributes }) => ({
        insert,
        attributes,
      }));
      writes.push({
        before: [],
        after,
        steps: after.map((_, at) => ({ op: 'ins', after: at })),
        identities: [],
      });
    }
    const started = performance.now();
    markMoves(
      writes,
      (token, origin) => ({ ...token, attributes: { ...token.attributes, [ORIGIN_KEY]: origin } }),
      (token) => JSON.stringify(token.attributes),
      (token) => token.attributes.t ?? ''
    );
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});
