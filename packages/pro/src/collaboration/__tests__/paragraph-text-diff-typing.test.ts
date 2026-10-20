/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Typing at one place skips the full diff of the paragraph. The shortcut must give exactly
// the script the full diff gives, or a keystroke would write shared text differently than
// the same edit made any other way.
import { describe, expect, test } from 'bun:test';
import { diffTokens, type Token } from '../document/paragraph-text-diff.ts';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const ELEMENTS: readonly Readonly<Record<string, string>>[] = [
  { t: 'one' },
  { t: 'two' },
  { r: 'run' },
];

/** A character token in one of a few text elements, as shared text and the editor give it. */
function character(value: string, element: number): Token {
  const attributes = ELEMENTS[element]!;
  const key = `c${value}`;
  return { key, strong: `${key}\u0000${attributes.t ?? ''}`, insert: value, attributes };
}

function embed(node: string): Token {
  const key = `e${node}`;
  return { key, strong: key, insert: { n: node }, attributes: {} };
}

describe('the typing shortcut of the paragraph diff', () => {
  test('gives the full diff script for every single insertion', () => {
    const next = random(1148);
    // Few letters, so equal letters border an insertion often, and an embedded node.
    const letters = ['a', 'b', ' '];
    const pick = (): Token => {
      if (next() < 0.1) return embed('drawing');
      const at = Math.floor(next() * letters.length);
      return character(letters[at]!, Math.floor(next() * ELEMENTS.length));
    };
    let compared = 0;
    for (let round = 0; round < 50_000; round += 1) {
      const before = Array.from({ length: Math.floor(next() * 12) }, pick);
      const at = Math.floor(next() * (before.length + 1));
      const typed = Array.from({ length: 1 + Math.floor(next() * 4) }, pick);
      // Sometimes a character outside the basic plane: two code units, one code point.
      if (next() < 0.05) typed.push(character('\ud83d', 0), character('\ude00', 0));
      const after = [...before.slice(0, at), ...typed, ...before.slice(at)];
      const fast = diffTokens(before, after);
      const full = diffTokens(before, after, false);
      if (JSON.stringify(fast) !== JSON.stringify(full)) {
        throw new Error(
          `round ${round}: ${JSON.stringify(before.map((t) => t.strong))} + ` +
            `${JSON.stringify(typed.map((t) => t.strong))} at ${at}`
        );
      }
      compared += 1;
    }
    expect(compared).toBe(50_000);
  });

  test('typing a letter beside the same letter gives the full diff script', () => {
    const before = [character('a', 0), character('b', 0)];
    const after = [character('a', 0), character('a', 0), character('b', 0)];
    expect(diffTokens(before, after)).toEqual(diffTokens(before, after, false));
  });
});
