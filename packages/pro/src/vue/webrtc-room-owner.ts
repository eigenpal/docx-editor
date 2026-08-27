/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Owns one destroyable collaboration room across a remount.
 *
 * Destroy on leave or when the owner unmounts. Do not destroy from an effect
 * whose dependency is the room object: StrictMode runs that cleanup and hands
 * a destroyed room to the remount.
 *
 * `disposeOwner` waits one microtask. A remount that reclaims the same owner
 * cancels that destroy, so StrictMode and hot reload cannot hand a destroyed
 * room back to the next render.
 *
 * Owners are stored by `useId()` / Vue instance uid so a remount that resets
 * hook state still finds the live room.
 */

export interface DestroyableRoom {
  destroy(): void;
}

export interface WebrtcRoomOwner<T extends DestroyableRoom> {
  current(): T | null;
  adopt(room: T): void;
  leave(): void;
  reclaimOwner(): void;
  disposeOwner(): void;
}

const owners = new Map<string, WebrtcRoomOwner<DestroyableRoom>>();

export function createWebrtcRoomOwner<T extends DestroyableRoom>(
  schedule: (task: () => void) => void = queueMicrotask
): WebrtcRoomOwner<T> {
  let held: T | null = null;
  let generation = 0;
  const cancelPending = (): void => {
    generation += 1;
  };
  return {
    current: () => held,
    adopt(room) {
      cancelPending();
      if (held && held !== room) held.destroy();
      held = room;
    },
    leave() {
      cancelPending();
      const previous = held;
      held = null;
      previous?.destroy();
    },
    reclaimOwner() {
      cancelPending();
    },
    disposeOwner() {
      const token = ++generation;
      const room = held;
      schedule(() => {
        if (token !== generation) return;
        room?.destroy();
        if (held === room) held = null;
      });
    },
  };
}

export function webrtcRoomOwnerFor<T extends DestroyableRoom>(id: string): WebrtcRoomOwner<T> {
  const existing = owners.get(id);
  if (existing) return existing as WebrtcRoomOwner<T>;
  const created = createWebrtcRoomOwner<T>();
  owners.set(id, created);
  return created;
}
