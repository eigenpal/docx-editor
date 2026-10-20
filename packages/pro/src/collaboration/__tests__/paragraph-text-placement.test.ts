/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The view and a write place text that follows a move by one rule. When they placed a piece
// inside other moved text differently, the write read the paragraph reordered: it typed the
// piece again without its identity and recorded the original as deleted.

import { describe, expect, test } from 'bun:test';
import type { LogicalId } from '../document/identity.ts';
import type { FollowingText, ShownText } from '../document/paragraph-text-follow.ts';
import type { TextIdentities } from '../document/paragraph-text-identity.ts';
import { MAX_FOLLOW_NESTING, placeFollowingText } from '../document/paragraph-text-placement.ts';

function piece(after: string, identities: string[], before = false): FollowingText {
  return {
    source: 'p' as LogicalId,
    after,
    before,
    positions: identities.map((_, index) => 10 + index),
    identities,
    items: identities.map((_, index) => `9:${10 + index}`),
  };
}

/** A paragraph's text: identities, and for its own characters, Yjs items and origins. */
function shown(
  ids: string[],
  hidden: number[],
  incoming: FollowingText[],
  own: { items?: string[]; origins?: (string | null)[] } = {}
): ShownText {
  return {
    identities: {
      ids,
      items: own.items ?? [],
      origins: own.origins ?? [],
    } as unknown as TextIdentities,
    hidden: new Set(hidden),
    incoming,
  };
}

describe('following text placement', () => {
  test('a piece shows at the first shown character with its anchor', () => {
    const after = piece('1:2', ['5:0']);
    const before = piece('1:2', ['5:1'], true);
    const placement = placeFollowingText(shown(['1:1', '1:2', '1:2'], [], [after, before]));
    expect(placement.atPosition.get(1)).toEqual({ before: [before], after: [after] });
    expect(placement.atEnd).toEqual([]);
  });

  test('a hidden character is no place to show at', () => {
    const typed = piece('1:2', ['5:0']);
    const placement = placeFollowingText(shown(['1:1', '1:2', '1:2'], [1], [typed]));
    expect(placement.atPosition.get(2)?.after).toEqual([typed]);
  });

  test('text typed inside moved text shows inside it', () => {
    const moved = piece('1:1', ['2:0', '2:1', '2:2']);
    const typed = piece('2:1', ['5:0']);
    const placement = placeFollowingText(shown(['1:1', '2:1'], [1], [moved, typed]));
    expect(placement.inside.get(moved)?.get(1)?.after).toEqual([typed]);
    expect(placement.atEnd).toEqual([]);
  });

  // A piece moved into this paragraph as one insert, "pstu" (items 8:0 to 8:3), with
  // another piece anchored after its "s".
  const ids = ['1:1', '2:0', '2:1', '3:0', '3:1', '4:0'];
  const host = (items: string[]): FollowingText => ({
    source: 'p' as LogicalId,
    after: '1:1',
    before: false,
    positions: [1, 2, 3, 4],
    identities: ['2:0', '2:1', '3:0', '3:1'],
    items,
  });
  const anchored: FollowingText = {
    source: 'p' as LogicalId,
    after: '2:1',
    before: false,
    positions: [5],
    identities: ['4:0'],
    items: ['5:0'],
  };

  test('a piece shows right after its anchor, before what followed it in its insert', () => {
    const moved = host(['8:0', '8:1', '8:2', '8:3']);
    const placement = placeFollowingText(
      shown(ids, [1, 2, 3, 4], [moved, anchored], {
        items: ['7:0', '8:0', '8:1', '8:2', '8:3', '5:0'],
        origins: [null, '7:0', '8:0', '8:1', '8:2', '7:0'],
      })
    );
    expect(placement.inside.get(moved)?.get(1)?.after).toEqual([anchored]);
  });

  test('a piece shows after text inserted after its anchor later, as Yjs orders it', () => {
    // "tu" is a later insert (9:0, 9:1) right after the "s".
    const moved = host(['8:0', '8:1', '9:0', '9:1']);
    const placement = placeFollowingText(
      shown(ids, [1, 2, 3, 4], [moved, anchored], {
        items: ['7:0', '8:0', '8:1', '9:0', '9:1', '5:0'],
        origins: [null, '7:0', '8:0', '8:1', '9:0', '7:0'],
      })
    );
    expect(placement.inside.get(moved)?.get(3)?.after).toEqual([anchored]);
  });

  test('pieces that only show inside each other show at the end, in order', () => {
    const first = piece('3:0', ['2:0']);
    const second = piece('2:0', ['3:0']);
    const placement = placeFollowingText(shown(['1:1'], [], [first, second]));
    expect(placement.atEnd).toEqual([first]);
    expect(placement.inside.get(first)?.get(0)?.after).toEqual([second]);
  });

  test('a chain deeper than the limit shows its deep part at the end', () => {
    const chain: FollowingText[] = [piece('1:1', ['2:0'])];
    for (let depth = 1; depth <= MAX_FOLLOW_NESTING + 2; depth += 1) {
      chain.push(piece(`2:${depth - 1}`, [`2:${depth}`]));
    }
    const placement = placeFollowingText(shown(['1:1'], [], chain));
    const nested = [...placement.inside.values()].reduce((count, slots) => count + slots.size, 0);
    expect(nested).toBeLessThanOrEqual(MAX_FOLLOW_NESTING + 1);
    expect(placement.atEnd.length).toBeGreaterThan(0);
  });

  test('a piece whose anchor shows nowhere shows at the end', () => {
    const typed = piece('9:9', ['5:0']);
    expect(placeFollowingText(shown(['1:1'], [], [typed])).atEnd).toEqual([typed]);
  });
});
