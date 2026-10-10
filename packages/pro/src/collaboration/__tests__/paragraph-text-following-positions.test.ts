/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The index says where following text sits in its source as of the last read. A write in the
// same transaction can move it: a join first deletes the originals its copies hid, and an
// adoption writes copies that carry the same identities as the text they copy. Following
// text is found again by its Yjs item IDs, which never change.

import { describe, expect, test } from 'bun:test';
import type { LogicalId } from '../document/identity.ts';
import { positionsNow, type FollowingText } from '../document/paragraph-text-follow.ts';

const following: FollowingText = {
  source: 'p' as LogicalId,
  after: '3:4',
  before: false,
  positions: [4, 5],
  identities: ['1:18', '1:19'],
  items: ['1:18', '1:19'],
};

describe('following text positions', () => {
  test('positions the source still holds stay as they are', () => {
    const items = ['0:1', '0:2', '3:0', '3:1', '1:18', '1:19'];
    expect(positionsNow(following, { items })).toEqual([4, 5]);
  });

  test('characters deleted before the text move it, and its item IDs find it', () => {
    expect(positionsNow(following, { items: ['0:1', '0:2', '1:18', '1:19'] })).toEqual([2, 3]);
  });

  test('a character gone from the source is not offered', () => {
    expect(positionsNow(following, { items: ['0:1', '1:19'] })).toEqual([1]);
  });

  test('a copy written in front of the text is not taken for it', () => {
    // The copy's items are new; only its marks give it the identities 1:18 and 1:19.
    const items = ['0:1', '0:2', '3:0', '3:1', '5:0', '5:1', '1:18', '1:19'];
    expect(positionsNow(following, { items })).toEqual([6, 7]);
  });
});
