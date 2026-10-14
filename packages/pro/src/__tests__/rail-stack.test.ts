/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { stackRailCards, stackReviewPositions, type RailStackEntry } from '../review/rail-stack.ts';

/** Cards 100px tall, folded 20px, 10px apart, one point per pixel. */
const options = (collapseAfterPx = 1000) => ({
  gap: 10,
  scale: 1,
  collapseAfterPx,
  heightOf: (_key: string, folded: boolean) => (folded ? 20 : 100),
  collapsible: (entry: RailStackEntry) => entry.key !== 'compose',
});

const tops = (entries: readonly RailStackEntry[], collapseAfterPx?: number) => {
  const { positions } = stackRailCards(entries, options(collapseAfterPx));
  return entries.map((entry) => positions.get(entry.key));
};

describe('stackRailCards', () => {
  test('without an open card, cards run top-down from their text', () => {
    const entries = [
      { key: 'a', anchorY: 0 },
      { key: 'b', anchorY: 0 },
      { key: 'c', anchorY: 500 },
    ];
    expect(tops(entries)).toEqual([0, 110, 500]);
  });

  test('the open card stays at its text, and the cards around it make room', () => {
    const entries = [
      { key: 'a', anchorY: 300 },
      { key: 'b', anchorY: 300 },
      { key: 'c', anchorY: 300, isActive: true },
      { key: 'd', anchorY: 300 },
    ];
    // Top-down, `c` would sit at 520, a whole card's run below its text.
    expect(tops(entries)).toEqual([80, 190, 300, 410]);
  });

  test('both open halves of a replacement stay together under the first one', () => {
    const entries = [
      { key: 'a', anchorY: 300 },
      { key: 'deleted', anchorY: 300, isActive: true },
      { key: 'added', anchorY: 300, isActive: true },
    ];
    expect(tops(entries)).toEqual([190, 300, 410]);
  });

  test('a card pushed far above its text folds and sits nearer to it', () => {
    const entries = [
      { key: 'a', anchorY: 1000 },
      { key: 'b', anchorY: 1000 },
      { key: 'c', anchorY: 1000, isActive: true },
    ];
    const result = stackRailCards(entries, options(100));
    // Folded, `b` would end only 30 above its text, so it stays full. `a` would end 140
    // above even folded, so it folds.
    expect([...result.collapsed]).toEqual(['a']);
    expect(entries.map((entry) => result.positions.get(entry.key))).toEqual([860, 890, 1000]);
  });

  test('a folded card measured at its folded height stays folded', () => {
    const entries = [
      { key: 'a', anchorY: 1000 },
      { key: 'b', anchorY: 1000 },
      { key: 'c', anchorY: 1000, isActive: true },
    ];
    const first = stackRailCards(entries, options(100));
    // The rail measures the folded card and reports that height as its full one.
    const second = stackRailCards(entries, {
      ...options(100),
      heightOf: (key, folded) => (folded || first.collapsed.has(key) ? 20 : 100),
    });
    expect([...second.collapsed]).toEqual([...first.collapsed]);
    expect(second.positions).toEqual(first.positions);
  });

  test('the open card and the compose box never fold', () => {
    const entries = [
      { key: 'compose', anchorY: 1000 },
      { key: 'b', anchorY: 0, isActive: true },
      { key: 'c', anchorY: 0, isActive: true },
    ];
    const result = stackRailCards(entries, options(10));
    expect(result.collapsed.size).toBe(0);
  });

  test('a card without geometry keeps its place beside its neighbors', () => {
    expect(
      tops([
        { key: 'a', anchorY: null },
        { key: 'b', anchorY: 200, isActive: true },
        { key: 'c', anchorY: null },
      ])
    ).toEqual([90, 200, 310]);
  });

  test('the public hooks keep an open placement at its anchor', () => {
    const placements = [
      { key: 'a', anchorY: 0, isActive: false },
      { key: 'b', anchorY: 0, isActive: true },
    ];
    const heights = new Map([['a', 50]]);
    const positions = stackReviewPositions(placements, heights, {
      gap: 10,
      scale: 1,
      defaultHeight: 100,
    });
    expect([positions.get('a'), positions.get('b')]).toEqual([-60, 0]);
  });

  test('an open card without geometry pins nothing', () => {
    expect(
      tops([
        { key: 'a', anchorY: 0 },
        { key: 'b', anchorY: null, isActive: true },
      ])
    ).toEqual([0, 110]);
  });
});
