/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A letter an edit keeps must keep its place in shared text. Written again, it is a new
// character: a peer's concurrent decision or deletion of the old one does not reach it.
import { expect, test } from 'bun:test';
import { diffTokens, type Step, type Token } from '../document/paragraph-text-diff.ts';

function letter(value: string, element: string, trail = '[]'): Token {
  const key = `c${value}`;
  return {
    key,
    strong: `${key}\u0000${element}`,
    insert: value,
    attributes: { t: element },
    trail,
  };
}

const word = (text: string, element: string, trail?: string): Token[] =>
  [...text].map((value) => letter(value, element, trail));

/** The `before` index each `after` token keeps, or -1 for one written again. */
function keptFrom(steps: readonly Step[], afterLength: number): number[] {
  const kept = new Array<number>(afterLength).fill(-1);
  for (const step of steps) if (step.op === 'eq') kept[step.after] = step.before;
  return kept;
}

const INSERTED_BY_CAROL = JSON.stringify([{ l: 'ins', a: 'Carol' }]);
const INSERTED_BY_ALICE = JSON.stringify([{ l: 'ins', a: 'Alice' }]);
const CAROL_STRUCK_BY_ALICE = JSON.stringify([
  { l: 'ins', a: 'Carol' },
  { l: 'del', a: 'Alice' },
]);

test('a strike keeps the letter of the insertion it strikes, not an equal removed letter', () => {
  const before = [
    ...word('N', 'a'),
    ...word('m ', 'b', INSERTED_BY_ALICE),
    ...word('m', 'c', INSERTED_BY_CAROL),
    ...word('o', 'd'),
  ];
  const after = [...word('N', 'a'), ...word('m', 'e', CAROL_STRUCK_BY_ALICE), ...word('o', 'd')];
  expect(keptFrom(diffTokens(before, after), after.length)).toEqual([0, 3, 4]);
});

test('rejecting insertions on both sides of a letter keeps that letter', () => {
  const before = [
    ...word('ab', 'a'),
    ...word('xy', 'b', INSERTED_BY_ALICE),
    ...word('k', 'c'),
    ...word('zw', 'b', INSERTED_BY_ALICE),
  ];
  const after = [...word('ab', 'a'), ...word('k', 'd')];
  expect(keptFrom(diffTokens(before, after), after.length)).toEqual([0, 1, 4]);
});

test('a run split whose text element stays on its tail keeps every letter', () => {
  // "lore" and "l" were one run; formatting split it and the tail kept the element.
  const before = [...word('lore', 'run'), ...word('lk', 'next')];
  const after = [
    ...word('lor', 'new1'),
    ...word('e', 'new2'),
    ...word('l', 'run'),
    ...word('k', 'next'),
  ];
  expect(keptFrom(diffTokens(before, after), after.length)).toEqual([0, 1, 2, 3, 4, 5]);
});

test('accepting a long insertion between two deletions costs time in proportion to its length', () => {
  const STRUCK_BY_ALICE = JSON.stringify([{ l: 'del', a: 'Alice' }]);
  const TEXT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod. ';
  const acceptAll = (length: number): { before: Token[]; after: Token[] } => {
    const body = [...TEXT.repeat(Math.ceil(length / TEXT.length)).slice(0, length)];
    return {
      before: [
        letter('Q', 'q', STRUCK_BY_ALICE),
        ...body.map((value, at) => letter(value, `run${Math.floor(at / 50)}`, INSERTED_BY_CAROL)),
        letter('Z', 'z', STRUCK_BY_ALICE),
      ],
      after: body.map((value) => letter(value, 'joined')),
    };
  };
  const timed = (length: number): number => {
    const { before, after } = acceptAll(length);
    // Every letter stays: the decision only removes the two deletions.
    expect(keptFrom(diffTokens(before, after), after.length).includes(-1)).toBe(false);
    let best = Infinity;
    for (let round = 0; round < 5; round += 1) {
      const started = performance.now();
      for (let repeat = 0; repeat < 4; repeat += 1) diffTokens(before, after);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  const short = timed(300);
  const long = timed(3000);
  // Ten times the text: a linear diff takes about ten times as long, a quadratic one a hundred.
  expect(long).toBeLessThan(Math.max(short * 30, 5));
});
