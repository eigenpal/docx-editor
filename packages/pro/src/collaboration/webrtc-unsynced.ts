/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Local changes no peer of a WebRTC room has received.
 *
 * A WebRTC room has no server: it lives in the peers that are connected. A change made while
 * no peer holds this replica's state exists only in this browser, and closing the page then
 * loses it. A peer holds the state once its link is established and the two have synced.
 * A link that is still negotiating receives nothing (the provider drops what it would send),
 * and it can fail, so it does not count. The count returns to zero when any link has synced:
 * the sync sends that peer everything it lacks.
 */
import type * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';

/** How often, while changes wait, the counter looks for a link that has synced since. */
const SYNC_CHECK_MS = 1000;

export interface UnsyncedChanges {
  /** Local changes made while no peer held this replica's state, and not synced since. */
  count(): number;
  /** Call `listener` when the count changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

export function trackUnsyncedChanges(ydoc: Y.Doc, provider: WebrtcProvider): UnsyncedChanges {
  let count = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  const stopChecking = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const set = (next: number): void => {
    if (next === count) return;
    count = next;
    if (count === 0) stopChecking();
    for (const listener of [...listeners]) listener();
  };
  /** Whether some peer holds this replica's state: a synced link, or a tab of this browser. */
  const shared = (): boolean => {
    const room = provider.room;
    if (room === null) return false;
    if (room.bcConns.size > 0) return true;
    for (const conn of room.webrtcConns.values()) {
      if (conn.connected && conn.synced) return true;
    }
    return false;
  };
  // A link that synced has everything; the provider reports a sync only for all links at once,
  // so a link that stays in negotiation must not hide one that synced.
  const check = (): void => {
    if (count > 0 && shared()) set(0);
  };
  const onUpdate = (_update: Uint8Array, origin: unknown): void => {
    // The provider applies peers' changes with its room as the origin.
    if (origin === provider.room || shared()) return;
    set(count + 1);
    timer ??= setInterval(check, SYNC_CHECK_MS);
  };
  ydoc.on('update', onUpdate);
  provider.on('peers', check);
  provider.on('synced', check);
  return {
    count: () => count,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      stopChecking();
      ydoc.off('update', onUpdate);
      provider.off('peers', check);
      provider.off('synced', check);
      listeners.clear();
    },
  };
}
