/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import {
  useWebrtcCollaboration,
  type UseWebrtcCollaborationConnectOptions,
  type UseWebrtcCollaborationReturn,
  type UseWebrtcCollaborationRoomHandle,
} from '../vue/useWebrtcCollaboration.ts';

function stubSession(documentId = 'room-1'): EditorCollaborationSession {
  return {
    documentId,
    sessionId: `${documentId}-session`,
    identity: { actorId: 'stub', name: 'Stub' },
    status: () => 'ready',
    statusSnapshot: () =>
      Object.freeze({ status: 'ready' as const, reason: undefined, lastFailure: undefined }),
    subscribeStatus: () => () => {},
    attach: () => () => {},
    gateOperations: () => null,
    canUndo: () => false,
    canRedo: () => false,
    undo: () => false,
    redo: () => false,
    setLocalSelection: () => {},
    participants: () => [],
    subscribeParticipants: () => () => {},
    remoteSelections: () => [],
    subscribeRemoteSelections: () => () => {},
    flushPendingJournals: () => {},
    destroy: () => {},
  };
}

function fakeRoom(documentId = 'room-1'): UseWebrtcCollaborationRoomHandle & {
  readonly destroyed: boolean;
} {
  let destroyed = false;
  return {
    document: new Uint8Array([1, 2, 3]),
    session: stubSession(documentId),
    destroy() {
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
  };
}

const CONNECT: UseWebrtcCollaborationConnectOptions = {
  roomId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
  identity: { actorId: 'alex', name: 'Alex' },
  bootstrap: { kind: 'join' },
};

function mountHook(
  createRoom: (
    options: UseWebrtcCollaborationConnectOptions
  ) => Promise<UseWebrtcCollaborationRoomHandle>,
  autoConnect = true
): { latest: () => UseWebrtcCollaborationReturn | null; unmount: () => void } {
  let latest: UseWebrtcCollaborationReturn | null = null;
  const app = createApp(
    defineComponent({
      setup() {
        latest = useWebrtcCollaboration({
          room: autoConnect ? CONNECT : null,
          createRoom,
        });
        return () => h('div');
      },
    })
  );
  const el = document.createElement('div');
  document.body.append(el);
  app.mount(el);
  return {
    latest: () => latest,
    unmount: () => {
      app.unmount();
      el.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useWebrtcCollaboration (Vue)', () => {
  test('leave destroys the room and clears the session', async () => {
    const created: Array<ReturnType<typeof fakeRoom>> = [];
    const mounted = mountHook(async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    });
    await Promise.resolve();
    await nextTick();
    expect(created[0]?.destroyed).toBe(false);
    const leftover = new Uint8Array([9]);
    mounted.latest()?.leave(leftover);
    expect(created[0]?.destroyed).toBe(true);
    expect(mounted.latest()?.session.value).toBeNull();
    expect(mounted.latest()?.document.value).toBe(leftover);
    mounted.unmount();
  });

  test('unmount destroys the room after the remount window', async () => {
    const created: Array<ReturnType<typeof fakeRoom>> = [];
    const mounted = mountHook(async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    });
    await Promise.resolve();
    await nextTick();
    expect(created[0]?.destroyed).toBe(false);
    mounted.unmount();
    expect(created[0]?.destroyed).toBe(false);
    await Promise.resolve();
    expect(created[0]?.destroyed).toBe(true);
  });

  test('pending is true until createRoom resolves', async () => {
    let finish: ((room: UseWebrtcCollaborationRoomHandle) => void) | undefined;
    const mounted = mountHook(
      () =>
        new Promise<UseWebrtcCollaborationRoomHandle>((resolve) => {
          finish = resolve;
        })
    );
    await nextTick();
    expect(mounted.latest()?.pending.value).toBe(true);
    finish?.(fakeRoom());
    await Promise.resolve();
    await nextTick();
    expect(mounted.latest()?.pending.value).toBe(false);
    expect(mounted.latest()?.session.value).not.toBeNull();
    mounted.unmount();
  });
});
