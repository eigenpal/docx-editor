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
import type * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import { collaborationModule } from '../collaboration/collaboration-module.ts';
import {
  useHocuspocusCollaboration,
  HOCUSPOCUS_CREATE_ROOM_FOR_TESTS,
  type UseHocuspocusCollaborationConnectOptions,
  type UseHocuspocusCollaborationReturn,
} from '../vue/useHocuspocusCollaboration.ts';
import {
  useWebrtcCollaboration,
  WEBRTC_CREATE_ROOM_FOR_TESTS,
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
    attached: true,
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
  readonly ydoc?: Y.Doc;
  readonly provider?: HocuspocusProvider;
  destroy(): void;
  readonly destroyed: boolean;
}

function fakeRoom(documentId = 'room-1'): StubRoom {
  let destroyed = false;
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    document: bytes,
    session: stubSession(documentId),
    ydoc: { stub: 'ydoc' } as unknown as Y.Doc,
    provider: { stub: 'provider' } as unknown as HocuspocusProvider,
    destroy() {
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
  };
}

const CONNECT: UseHocuspocusCollaborationConnectOptions = {
  url: 'wss://collab.example.test',
  roomId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
  identity: { actorId: 'alex', name: 'Alex' },
  bootstrap: { kind: 'join' },
};

function mountHook(
  createRoom: (options: UseHocuspocusCollaborationConnectOptions) => Promise<StubRoom>,
  autoConnect = true
): { latest: () => UseHocuspocusCollaborationReturn | null; unmount: () => void } {
  let latest: UseHocuspocusCollaborationReturn | null = null;
  const app = createApp(
    defineComponent({
      setup() {
        const options = {
          room: autoConnect ? CONNECT : null,
          [HOCUSPOCUS_CREATE_ROOM_FOR_TESTS]: createRoom,
        };
        latest = useHocuspocusCollaboration(options);
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

describe('useHocuspocusCollaboration (Vue)', () => {
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

  test('leave refuses to run without the current document bytes', async () => {
    const created: StubRoom[] = [];
    const mounted = mountHook(async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    });
    await Promise.resolve();
    await nextTick();
    expect(() => (mounted.latest()?.leave as unknown as () => void)()).toThrow(
      /await editor\.save\(\)/
    );
    expect(created[0]?.destroyed).toBe(false);
    expect(mounted.latest()?.session.value).not.toBeNull();
    mounted.unmount();
  });

  test('the room ydoc and provider are exposed while connected and null after leave', async () => {
    const created: StubRoom[] = [];
    const mounted = mountHook(async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    });
    await Promise.resolve();
    await nextTick();
    expect(mounted.latest()?.ydoc.value).toBe(created[0]!.ydoc!);
    expect(mounted.latest()?.provider.value).toBe(created[0]!.provider!);
    mounted.latest()?.leave(new Uint8Array([9]));
    expect(mounted.latest()?.ydoc.value).toBeNull();
    expect(mounted.latest()?.provider.value).toBeNull();
    mounted.unmount();
  });

  test('rejoin leaves with the passed bytes and reconnects with bootstrap join', async () => {
    const created: StubRoom[] = [];
    const seenOptions: UseHocuspocusCollaborationConnectOptions[] = [];
    const mounted = mountHook(async (options) => {
      seenOptions.push(options);
      const room = fakeRoom(`room-${created.length}`);
      created.push(room);
      return room;
    }, false);
    await nextTick();
    await mounted.latest()?.connect({
      ...CONNECT,
      bootstrap: { kind: 'create', document: new Uint8Array([1]) },
    });
    await mounted.latest()?.rejoin(new Uint8Array([42]));
    expect(created[0]?.destroyed).toBe(true);
    expect(created[1]?.destroyed).toBe(false);
    // `readonly()` wraps the session in a proxy, so compare by identity field.
    expect(mounted.latest()?.session.value?.documentId).toBe('room-1');
    // The server still holds the room, so a rejoin never re-creates it from local bytes.
    expect(seenOptions[1]).toMatchObject({
      url: CONNECT.url,
      roomId: CONNECT.roomId,
      identity: CONNECT.identity,
      bootstrap: { kind: 'join' },
    });
    mounted.unmount();
  });

  test('rejoin after a failed initial connect retries as a joiner', async () => {
    // The failed attempt is still "the last connect": rejoin must retry it instead of
    // refusing with "call connect first".
    let calls = 0;
    const seenOptions: UseHocuspocusCollaborationConnectOptions[] = [];
    const room = fakeRoom('recovered');
    const mounted = mountHook(async (options) => {
      seenOptions.push(options);
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('initialization-timeout'), {
          code: 'initialization-timeout',
        });
      }
      return room;
    }, false);
    await nextTick();
    try {
      await mounted.latest()?.connect({
        ...CONNECT,
        bootstrap: { kind: 'create', document: new Uint8Array([1]) },
      });
    } catch {
      // The failure is under test; the composable already exposes it through `error`.
    }
    expect(mounted.latest()?.error.value).toEqual({ code: 'initialization-timeout' });
    await mounted.latest()?.rejoin(new Uint8Array([42]));
    // `readonly()` wraps the session in a proxy, so compare by identity field.
    expect(mounted.latest()?.session.value?.documentId).toBe('recovered');
    expect(mounted.latest()?.error.value).toBeNull();
    expect(seenOptions[1]).toMatchObject({
      url: CONNECT.url,
      roomId: CONNECT.roomId,
      identity: CONNECT.identity,
      bootstrap: { kind: 'join' },
    });
    mounted.unmount();
  });

  test('connect forwards offlineEditing to the room factory', async () => {
    const seenOptions: UseHocuspocusCollaborationConnectOptions[] = [];
    const mounted = mountHook(async (options) => {
      seenOptions.push(options);
      return fakeRoom();
    }, false);
    await nextTick();
    await mounted.latest()?.connect({ ...CONNECT, offlineEditing: true });
    expect(seenOptions[0]?.offlineEditing).toBe(true);
    mounted.unmount();
  });

  test('one component owns a Hocuspocus room and a WebRTC room at once', async () => {
    // The two composables must key their room owners differently: a shared owner would let
    // each adopt destroy the other composable's room.
    const hocuspocusRooms: StubRoom[] = [];
    const webrtcRooms: StubRoom[] = [];
    let hocuspocus: UseHocuspocusCollaborationReturn | null = null;
    let webrtc: UseWebrtcCollaborationReturn | null = null;
    const app = createApp(
      defineComponent({
        setup() {
          const hocuspocusOptions = {
            room: CONNECT,
            [HOCUSPOCUS_CREATE_ROOM_FOR_TESTS]: async () => {
              const room = fakeRoom('hocuspocus-room');
              hocuspocusRooms.push(room);
              return room;
            },
          };
          hocuspocus = useHocuspocusCollaboration(hocuspocusOptions);
          const webrtcOptions = {
            room: {
              roomId: CONNECT.roomId,
              identity: CONNECT.identity,
              bootstrap: CONNECT.bootstrap,
            },
            [WEBRTC_CREATE_ROOM_FOR_TESTS]: async () => {
              const room = fakeRoom('webrtc-room');
              webrtcRooms.push(room);
              return room;
            },
          };
          webrtc = useWebrtcCollaboration(webrtcOptions);
          return () => h('div');
        },
      })
    );
    const el = document.createElement('div');
    document.body.append(el);
    app.mount(el);
    await Promise.resolve();
    await nextTick();
    expect(hocuspocusRooms).toHaveLength(1);
    expect(webrtcRooms).toHaveLength(1);
    expect(hocuspocusRooms[0]?.destroyed).toBe(false);
    expect(webrtcRooms[0]?.destroyed).toBe(false);
    expect(hocuspocus!.session.value?.documentId).toBe('hocuspocus-room');
    expect(webrtc!.session.value?.documentId).toBe('webrtc-room');
    app.unmount();
    el.remove();
  });

  test('throws when host modules already include a collaboration contribution', () => {
    const modules = [collaborationModule({ session: stubSession('host') })];
    expect(() => {
      const app = createApp(
        defineComponent({
          setup() {
            useHocuspocusCollaboration({ modules });
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
      mounted = mountHook(() => Promise.reject(new Error('server refused')));
      await Promise.resolve();
      await nextTick();
    } finally {
      process.off('unhandledRejection', onRejection);
    }
    expect(mounted?.latest()?.error.value).toEqual({
      code: 'transport',
      detail: 'server refused',
    });
    expect(mounted?.latest()?.pending.value).toBe(false);
    expect(mounted?.latest()?.session.value).toBeNull();
    expect(rejections).toEqual([]);
    mounted?.unmount();
  });

  test('connect resolves with the failure code from a schema error', async () => {
    const mounted = mountHook(
      () =>
        Promise.reject(
          Object.assign(new Error('initialization-timeout'), { code: 'initialization-timeout' })
        ),
      false
    );
    await nextTick();
    // RESOLVES with the failure rather than rejecting, so the ordinary call site —
    // `@click="connect(options)"` — cannot raise an unhandled rejection.
    const resolved = await mounted.latest()?.connect(CONNECT);
    expect(resolved).toEqual({ code: 'initialization-timeout' });
    expect(mounted.latest()?.error.value).toEqual({ code: 'initialization-timeout' });
    mounted.unmount();
  });

  test('the public hocuspocus entry does not export the test room factory', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'vue', 'hocuspocus.ts'), 'utf8');
    expect(source).not.toContain('HOCUSPOCUS_CREATE_ROOM_FOR_TESTS');
    expect(source).not.toContain('createRoom');
  });

  test('the default Vue entry does not import the Hocuspocus composable', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'vue', 'index.ts'), 'utf8');
    expect(source).not.toContain('useHocuspocusCollaboration');
    expect(source).not.toContain('@hocuspocus/provider');
    expect(source).not.toContain('collaboration/hocuspocus');
  });
});
