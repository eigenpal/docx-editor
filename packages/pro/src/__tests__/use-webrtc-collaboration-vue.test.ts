/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, defineComponent, h, nextTick } from 'vue';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import { collaborationModule } from '../collaboration/collaboration-module.ts';
import {
  useWebrtcCollaboration,
  WEBRTC_CREATE_ROOM_FOR_TESTS,
  type UseWebrtcCollaborationConnectOptions,
  type UseWebrtcCollaborationReturn,
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

interface StubRoom {
  readonly document: Uint8Array;
  readonly session: EditorCollaborationSession;
  destroy(): void;
  readonly destroyed: boolean;
}

function fakeRoom(documentId = 'room-1'): StubRoom {
  let destroyed = false;
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    document: bytes,
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
  createRoom: (options: UseWebrtcCollaborationConnectOptions) => Promise<StubRoom>,
  autoConnect = true
): { latest: () => UseWebrtcCollaborationReturn | null; unmount: () => void } {
  let latest: UseWebrtcCollaborationReturn | null = null;
  const app = createApp(
    defineComponent({
      setup() {
        const options = {
          room: autoConnect ? CONNECT : null,
          [WEBRTC_CREATE_ROOM_FOR_TESTS]: createRoom,
        };
        latest = useWebrtcCollaboration(options);
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
    const created: StubRoom[] = [];
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

  test('leave without bytes keeps the room document for local editing', async () => {
    const created: StubRoom[] = [];
    const mounted = mountHook(async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    });
    await Promise.resolve();
    await nextTick();
    const kept = created[0]?.document;
    expect(kept).toBeDefined();
    mounted.latest()?.leave();
    expect(created[0]?.destroyed).toBe(true);
    expect(mounted.latest()?.session.value).toBeNull();
    expect(mounted.latest()?.document.value).toBe(kept);
    expect(mounted.latest()?.document.value).not.toBeNull();
    mounted.unmount();
  });

  test('throws when host modules already include a collaboration contribution', () => {
    const modules = [collaborationModule({ session: stubSession('host') })];
    expect(() => {
      const app = createApp(
        defineComponent({
          setup() {
            useWebrtcCollaboration({ modules });
            return () => h('div');
          },
        })
      );
      const el = document.createElement('div');
      document.body.append(el);
      app.mount(el);
    }).toThrow(/already include a collaboration contribution/);
  });

  test('unmount destroys the room after the remount window', async () => {
    const created: StubRoom[] = [];
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
    let finish: ((room: StubRoom) => void) | undefined;
    const mounted = mountHook(
      () =>
        new Promise<StubRoom>((resolve) => {
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

  test('a failed auto-connect reports a typed collaboration failure', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    let mounted: ReturnType<typeof mountHook> | undefined;
    try {
      mounted = mountHook(() => Promise.reject(new Error('signaling refused')));
      await Promise.resolve();
      await nextTick();
    } finally {
      process.off('unhandledRejection', onRejection);
    }
    expect(mounted?.latest()?.error.value).toEqual({
      code: 'transport',
      detail: 'signaling refused',
    });
    expect(mounted?.latest()?.pending.value).toBe(false);
    expect(mounted?.latest()?.session.value).toBeNull();
    expect(rejections).toEqual([]);
    mounted?.unmount();
  });

  test('connect rejects with the failure code from a schema error', async () => {
    const mounted = mountHook(
      () =>
        Promise.reject(
          Object.assign(new Error('initialization-timeout'), { code: 'initialization-timeout' })
        ),
      false
    );
    await nextTick();
    let thrown: unknown;
    try {
      await mounted.latest()?.connect(CONNECT);
    } catch (cause) {
      thrown = cause;
    }
    expect(mounted.latest()?.error.value).toEqual({ code: 'initialization-timeout' });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string }).code).toBe('initialization-timeout');
    mounted.unmount();
  });

  test('the public webrtc entry does not export the test room factory', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'vue', 'webrtc.ts'), 'utf8');
    expect(source).not.toContain('WEBRTC_CREATE_ROOM_FOR_TESTS');
    expect(source).not.toContain('UseWebrtcCollaborationRoomHandle');
    expect(source).not.toContain('createRoom');
  });
});
