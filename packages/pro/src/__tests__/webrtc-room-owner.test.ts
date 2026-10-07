/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { webrtcRoomOwnerCountForTests, webrtcRoomOwnerFor } from '../react/webrtc-room-owner.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('webrtcRoomOwnerFor', () => {
  test('a disposed owner leaves the registry, so unmounted hooks do not accumulate', async () => {
    const before = webrtcRoomOwnerCountForTests();
    let destroyed = 0;
    const owner = webrtcRoomOwnerFor<{ destroy(): void }>('owner-prune-test');
    owner.adopt({ destroy: () => (destroyed += 1) });
    expect(webrtcRoomOwnerCountForTests()).toBe(before + 1);
    owner.disposeOwner();
    await settle();
    expect(destroyed).toBe(1);
    expect(webrtcRoomOwnerCountForTests()).toBe(before);
  });

  test('a remount inside the dispose window keeps the owner and its room', async () => {
    const before = webrtcRoomOwnerCountForTests();
    let destroyed = 0;
    const owner = webrtcRoomOwnerFor<{ destroy(): void }>('owner-remount-test');
    owner.adopt({ destroy: () => (destroyed += 1) });
    owner.disposeOwner();
    owner.reclaimOwner();
    await settle();
    expect(destroyed).toBe(0);
    expect(webrtcRoomOwnerFor('owner-remount-test')).toBe(owner);
    expect(webrtcRoomOwnerCountForTests()).toBe(before + 1);
    owner.disposeOwner();
    await settle();
  });
});
