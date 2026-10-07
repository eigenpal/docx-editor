/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';
import { trackUnsyncedChanges } from '../webrtc-unsynced.ts';

/** A provider stand-in: its room's connections, its sync flag, and its two events. */
function fakeProvider() {
  const room = {
    webrtcConns: new Map<string, unknown>(),
    bcConns: new Set<string>(),
    synced: true,
  };
  const listeners = new Map<string, Set<() => void>>();
  const emit = (event: string): void => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  const provider = {
    room,
    on(event: string, listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
  };
  return {
    provider: provider as unknown as WebrtcProvider,
    room,
    /** A peer connects; the room syncs with it when `synced` is true. */
    connect(synced: boolean) {
      room.webrtcConns.set('peer', {});
      room.synced = synced;
      emit('peers');
      if (synced) emit('synced');
    },
    disconnect() {
      room.webrtcConns.clear();
      room.synced = true;
      emit('peers');
    },
  };
}

describe('changes no WebRTC peer has received', () => {
  test('count while alone, and return to zero once a peer connects and syncs', () => {
    const ydoc = new Y.Doc();
    const fake = fakeProvider();
    const unsynced = trackUnsyncedChanges(ydoc, fake.provider);
    let notified = 0;
    unsynced.subscribe(() => (notified += 1));
    ydoc.getText('t').insert(0, 'a');
    ydoc.getText('t').insert(1, 'b');
    expect(unsynced.count()).toBe(2);
    // Connected but not yet in sync: the changes are still only here.
    fake.connect(false);
    expect(unsynced.count()).toBe(2);
    fake.connect(true);
    expect(unsynced.count()).toBe(0);
    expect(notified).toBe(3);
    unsynced.destroy();
  });

  test('a change made while a peer is connected reaches it, and a peer change is not local', () => {
    const ydoc = new Y.Doc();
    const fake = fakeProvider();
    const unsynced = trackUnsyncedChanges(ydoc, fake.provider);
    fake.connect(true);
    ydoc.getText('t').insert(0, 'a');
    expect(unsynced.count()).toBe(0);
    fake.disconnect();
    const peer = new Y.Doc();
    peer.getText('t').insert(0, 'z');
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer), fake.room);
    expect(unsynced.count()).toBe(0);
    ydoc.getText('t').insert(0, 'b');
    expect(unsynced.count()).toBe(1);
    unsynced.destroy();
  });
});
