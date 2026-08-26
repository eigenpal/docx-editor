import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCollaborationRoomOwner } from './collaboration-room-owner.ts';

function fakeRoom() {
  let destroyed = false;
  return {
    destroy() {
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
  };
}

describe('collaboration room owner', () => {
  test('adopt keeps the room through a remount that does not dispose', () => {
    const owner = createCollaborationRoomOwner<ReturnType<typeof fakeRoom>>();
    const room = fakeRoom();
    owner.adopt(room);
    owner.adopt(room);
    expect(room.destroyed).toBe(false);
    expect(owner.current()).toBe(room);
  });

  test('leave destroys the room so a remount cannot receive it', () => {
    const owner = createCollaborationRoomOwner<ReturnType<typeof fakeRoom>>();
    const room = fakeRoom();
    owner.adopt(room);
    owner.leave();
    expect(room.destroyed).toBe(true);
    expect(owner.current()).toBeNull();
  });

  test('disposeOwner destroys a leftover room after the remount window', async () => {
    const owner = createCollaborationRoomOwner<ReturnType<typeof fakeRoom>>();
    const room = fakeRoom();
    owner.adopt(room);
    owner.disposeOwner();
    expect(room.destroyed).toBe(false);
    await Promise.resolve();
    expect(room.destroyed).toBe(true);
    expect(owner.current()).toBeNull();
  });

  test('reclaimOwner cancels a pending dispose so StrictMode remount keeps the room', async () => {
    const owner = createCollaborationRoomOwner<ReturnType<typeof fakeRoom>>();
    const room = fakeRoom();
    owner.adopt(room);
    owner.disposeOwner();
    owner.reclaimOwner();
    await Promise.resolve();
    expect(room.destroyed).toBe(false);
    expect(owner.current()).toBe(room);
  });

  test('a cleanup keyed on the room destroys a room the remount still holds', () => {
    const room = fakeRoom();
    const keyedCleanup = (held: ReturnType<typeof fakeRoom> | null) => () => {
      held?.destroy();
    };
    keyedCleanup(room)();
    expect(room.destroyed).toBe(true);
  });

  test('ComposedEditorDemo owns the room without a keyed destroy effect', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'ComposedEditorDemo.tsx'), 'utf8');
    expect(source).toContain('createCollaborationRoomOwner');
    expect(source).toContain('reclaimOwner');
    expect(source).not.toMatch(/\[collaborationRoom\]/);
    expect(source).not.toMatch(/collaborationRoom\?\.destroy\(\)/);
  });
});
