/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Local changes no peer of a WebRTC room has received.
 *
 * A WebRTC room has no server: it lives in the peers that are connected. A change made while
 * no peer is connected exists only in this browser until one connects and syncs, and closing
 * the page then loses it. So the count is of local changes made while this replica is
 * alone, and it returns to zero when a peer connects and the room is in sync again. A change
 * made while a peer is connected reaches that peer directly.
 */
import type * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';

export interface UnsyncedChanges {
  /** Local changes made while no peer was connected and not synced since. */
  count(): number;
  /** Call `listener` when the count changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

export function trackUnsyncedChanges(ydoc: Y.Doc, provider: WebrtcProvider): UnsyncedChanges {
  let count = 0;
  const listeners = new Set<() => void>();
  const set = (next: number): void => {
    if (next === count) return;
    count = next;
    for (const listener of [...listeners]) listener();
  };
  const room = (): WebrtcProvider['room'] => provider.room;
  const connected = (): boolean => {
    const current = room();
    return current !== null && current.webrtcConns.size + current.bcConns.size > 0;
  };
  // A peer that connects syncs both ways; once every connection is in sync, it has them all.
  const onShared = (): void => {
    const current = room();
    if (current !== null && connected() && current.synced) set(0);
  };
  const onUpdate = (_update: Uint8Array, origin: unknown): void => {
    // The provider applies peers' changes with its room as the origin.
    if (origin === room() || connected()) return;
    set(count + 1);
  };
  ydoc.on('update', onUpdate);
  provider.on('peers', onShared);
  provider.on('synced', onShared);
  return {
    count: () => count,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      ydoc.off('update', onUpdate);
      provider.off('peers', onShared);
      provider.off('synced', onShared);
      listeners.clear();
    },
  };
}
