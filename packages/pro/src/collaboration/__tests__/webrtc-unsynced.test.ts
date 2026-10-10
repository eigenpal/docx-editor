/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';
import { trackUnsyncedChanges } from '../webrtc-unsynced.ts';

/** A provider stand-in: its room's links, as the provider keeps them, and its two events. */
function fakeProvider() {
  const room = {
    webrtcConns: new Map<string, { connected: boolean; synced: boolean }>(),
    bcConns: new Set<string>(),
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
    /** A peer starts negotiating: the provider lists its link before it connects. */
    negotiate(name: string) {
      room.webrtcConns.set(name, { connected: false, synced: false });
      emit('peers');
    },
    /** The link connects and the two sync. */
    sync(name: string) {
      room.webrtcConns.set(name, { connected: true, synced: true });
      emit('synced');
    },
    close(name: string) {
      room.webrtcConns.delete(name);
      emit('peers');
    },
  };
}

const type = (ydoc: Y.Doc, text: string): void => {
  ydoc.getText('t').insert(0, text);
};

describe('changes no WebRTC peer has received', () => {
  test('count while alone, and return to zero once a peer syncs', () => {
    const ydoc = new Y.Doc();
    const fake = fakeProvider();
    const unsynced = trackUnsyncedChanges(ydoc, fake.provider);
    let notified = 0;
    unsynced.subscribe(() => (notified += 1));
    type(ydoc, 'a');
    type(ydoc, 'b');
    expect(unsynced.count()).toBe(2);
    fake.sync('peer');
    expect(unsynced.count()).toBe(0);
    expect(notified).toBe(3);
    unsynced.destroy();
  });

  test('a link still negotiating receives nothing, so changes still count', () => {
    const ydoc = new Y.Doc();
    const fake = fakeProvider();
    const unsynced = trackUnsyncedChanges(ydoc, fake.provider);
    fake.negotiate('peer');
    type(ydoc, 'a');
    expect(unsynced.count()).toBe(1);
    // The negotiation fails: the change is still only here.
    fake.close('peer');
    expect(unsynced.count()).toBe(1);
    unsynced.destroy();
  });

  test('one synced link is enough, even beside a link that never connects', () => {
    const ydoc = new Y.Doc();
    const fake = fakeProvider();
    const unsynced = trackUnsyncedChanges(ydoc, fake.provider);
    fake.negotiate('stuck');
    type(ydoc, 'a');
    fake.sync('peer');
    expect(unsynced.count()).toBe(0);
    type(ydoc, 'b');
    expect(unsynced.count()).toBe(0);
    unsynced.destroy();
  });

  test('a peer change is not a local one', () => {
    const ydoc = new Y.Doc();
    const fake = fakeProvider();
    const unsynced = trackUnsyncedChanges(ydoc, fake.provider);
    const peer = new Y.Doc();
    type(peer, 'z');
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer), fake.room);
    expect(unsynced.count()).toBe(0);
    unsynced.destroy();
  });
});
