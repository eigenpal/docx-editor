/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers split one run at once. Each replaced the run with its own copy of the text
// before the split and added content after that copy. Split dedup shows one copy; it shows
// it where the first copy stands, so the text before the split stays first.
import { describe, expect, test } from 'bun:test';
import { splitWinnerOrder } from '../document/split-dedup.ts';

const lineage: Record<string, string> = {
  bobHead: 'origin',
  aliceHead: 'origin',
  aliceDeep: 'aliceHead',
};
const lineageOf = (id: string) => lineage[id] ?? null;

describe('split winner order', () => {
  test('the winning copy takes the slot of a losing copy listed before it', () => {
    const children = ['bobHead', 'bobPaste', 'aliceHead', 'alicePaste'];
    const order = splitWinnerOrder(children, (id) => id === 'bobHead', lineageOf);
    expect(order?.map((index) => children[index])).toEqual([
      'aliceHead',
      'bobHead',
      'bobPaste',
      'alicePaste',
    ]);
  });

  test('nothing moves when the winning copy is already first', () => {
    const children = ['aliceHead', 'alicePaste', 'bobHead', 'bobPaste'];
    expect(splitWinnerOrder(children, (id) => id === 'bobHead', lineageOf)).toBeNull();
  });

  test('a split that left several pieces of a branch in the parent keeps its order', () => {
    // A format split leaves head, middle and tail of each branch in one paragraph.
    const pieces: Record<string, string> = {
      bobHead: 'origin',
      bobTail: 'origin',
      aliceHead: 'origin',
      aliceTail: 'origin',
    };
    const children = ['bobHead', 'bobTail', 'aliceHead', 'aliceTail'];
    expect(
      splitWinnerOrder(
        children,
        (id) => id.startsWith('bob'),
        (id) => pieces[id] ?? null
      )
    ).toBeNull();
  });

  test('nothing moves without a loser, or for a piece of another split', () => {
    expect(splitWinnerOrder(['aliceHead', 'x'], () => false, lineageOf)).toBeNull();
    const children = ['bobHead', 'x', 'aliceDeep'];
    expect(splitWinnerOrder(children, (id) => id === 'bobHead', lineageOf)).toBeNull();
  });
});
