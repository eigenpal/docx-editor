/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The stepped band both review rails render cards for, and the root index they share. The band
// once followed each scroll frame, so each frame rendered the rail.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import {
  RAIL_BAND_STEP,
  RAIL_OVERSCAN,
  observeRailWindow,
  railWindowFollowsScroll,
  steppedRailWindow,
  type RailWindow,
} from '../review/rail-window.ts';
import { repliesOf, reviewRootsOf, sameEntries, sameFields } from '../review/review-roots.ts';

/** The scrollers a test mounted. Each test takes its own out of the document again. */
const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const scroller of mounted.splice(0)) scroller.remove();
});

const VIEW = 800;

describe('the stepped rail band', () => {
  test('holds the visible part and the overscan at every scroll position', () => {
    for (let scrollTop = 0; scrollTop <= 4000; scrollTop += 37) {
      const band = steppedRailWindow(scrollTop, VIEW);
      expect(band.top).toBeLessThanOrEqual(scrollTop - RAIL_OVERSCAN);
      expect(band.bottom).toBeGreaterThanOrEqual(scrollTop + VIEW + RAIL_OVERSCAN);
      // Never more than one step wider than the overscan asks for, on each side.
      expect(scrollTop - RAIL_OVERSCAN - band.top).toBeLessThan(RAIL_BAND_STEP);
      expect(band.bottom - (scrollTop + VIEW + RAIL_OVERSCAN)).toBeLessThan(RAIL_BAND_STEP);
      expect(Math.abs(band.top % RAIL_BAND_STEP)).toBe(0);
      expect(Math.abs(band.bottom % RAIL_BAND_STEP)).toBe(0);
    }
  });

  /** A rail in a scroller of `VIEW` pixels, and the bands the observer reported. */
  function observe(exact: boolean) {
    const scroller = document.createElement('div');
    const rail = document.createElement('aside');
    scroller.append(rail);
    document.body.append(scroller);
    mounted.push(scroller);
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEW });
    const bands: RailWindow[] = [];
    const stop = observeRailWindow(rail, scroller, (band) => bands.push(band), { exact });
    const scrollTo = async (top: number): Promise<void> => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    return { bands, scrollTo, stop };
  }

  test('reports nothing for a scroll inside one step', async () => {
    const { bands, scrollTo, stop } = observe(false);
    expect(bands).toEqual([steppedRailWindow(0, VIEW)]);
    for (const top of [10, 40, 70, 99]) await scrollTo(top);
    expect(bands).toHaveLength(1);
    // The bottom edge crosses a step line first.
    await scrollTo(RAIL_BAND_STEP);
    expect(bands).toHaveLength(2);
    expect(bands[1]).toEqual(steppedRailWindow(RAIL_BAND_STEP, VIEW));
    stop();
  });

  test('follows each scroll position when the caller asks for the exact band', async () => {
    const { bands, scrollTo, stop } = observe(true);
    for (const top of [10, 40]) await scrollTo(top);
    expect(bands).toEqual(
      [0, 10, 40].map((top) => ({ top: top - RAIL_OVERSCAN, bottom: top + VIEW + RAIL_OVERSCAN }))
    );
    stop();
  });
});

describe('the rail that needs the exact band', () => {
  const placed = { key: 'placed', anchorY: 120 };
  const unplaced = { key: 'unplaced', anchorY: null };

  test('is the compact rail whose active card has no placement', () => {
    expect(railWindowFollowsScroll(true, [placed, unplaced], 'unplaced')).toBe(true);
    // A placed card stands at its anchor, and the full column draws no floating card.
    expect(railWindowFollowsScroll(true, [placed, unplaced], 'placed')).toBe(false);
    expect(railWindowFollowsScroll(false, [placed, unplaced], 'unplaced')).toBe(false);
    expect(railWindowFollowsScroll(true, [placed, unplaced], null)).toBe(false);
    // A reply is not a root, so it floats no card of its own.
    expect(railWindowFollowsScroll(true, [placed], 'unplaced')).toBe(false);
  });
});

describe('the review root index', () => {
  const comment = (id: string, parentId?: string) => ({
    id,
    kind: 'comment',
    replyIds: [] as string[],
    ...(parentId ? { parentId } : {}),
  });

  test('lists every item that is not a reply to a listed item, once per list', () => {
    const items = [comment('a'), comment('b', 'a'), comment('c', 'missing')];
    const roots = reviewRootsOf(items);
    // A reply whose parent is not in the list renders as a card of its own.
    expect(roots.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(reviewRootsOf(items)).toBe(roots);
    expect(reviewRootsOf([...items])).not.toBe(roots);
  });

  test('gives every item without replies the same empty list', () => {
    const parent = { ...comment('a'), replyIds: ['b', 'gone'] };
    const reply = comment('b', 'a');
    const byId = new Map([
      [parent.id, parent],
      [reply.id, reply],
    ]);
    expect(repliesOf(parent, byId)).toEqual([reply]);
    expect(repliesOf(reply, byId)).toBe(repliesOf(comment('z'), byId));
  });

  test('compares maps and records by their content', () => {
    expect(sameEntries(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(true);
    expect(sameEntries(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false);
    expect(sameEntries(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false);
    expect(sameEntries(new Map([['a', 1]]), new Map())).toBe(false);
    expect(sameFields({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(sameFields({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(sameFields<Record<string, number>>({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
