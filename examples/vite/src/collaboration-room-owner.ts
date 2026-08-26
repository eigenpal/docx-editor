/**
 * Owns one collaboration room for a React host that stores the room in state.
 *
 * Destroy on leave or when the owner unmounts. Do not destroy from a React
 * effect whose dependency is the room object: StrictMode runs that cleanup and
 * hands a destroyed room to the remount.
 *
 * `disposeOwner` waits one microtask. A remount that reclaims the same owner
 * cancels that destroy, so StrictMode and hot reload cannot hand a destroyed
 * room back to the next render.
 */

export interface CollaborationRoomOwner<T extends { destroy(): void }> {
  current(): T | null;
  adopt(room: T): void;
  leave(): void;
  reclaimOwner(): void;
  disposeOwner(): void;
}

export function createCollaborationRoomOwner<T extends { destroy(): void }>(
  schedule: (task: () => void) => void = queueMicrotask
): CollaborationRoomOwner<T> {
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
