/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type {
  CollaborationFailureCode,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import { collaborationModule } from '../collaboration/collaboration-module.ts';
import {
  useHocuspocusCollaboration,
  HOCUSPOCUS_CREATE_ROOM_FOR_TESTS,
  type UseHocuspocusCollaborationConnectOptions,
  type UseHocuspocusCollaborationReturn,
} from '../react/useHocuspocusCollaboration.ts';

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

/** A session a test can drive into a terminal failure after the join has already succeeded. */
function failableSession(documentId: string): EditorCollaborationSession & {
  fail(reason: CollaborationFailureCode): void;
} {
  const base = stubSession(documentId);
  let snapshot = base.statusSnapshot();
  const listeners = new Set<() => void>();
  return {
    ...base,
    status: () => snapshot.status,
    statusSnapshot: () => snapshot,
    subscribeStatus: (listener) => {
      const notify = (): void => listener(snapshot.status, snapshot.reason?.code);
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    fail(reason) {
      snapshot = Object.freeze({
        status: 'error' as const,
        reason: { code: reason },
        lastFailure: { code: reason },
      });
      for (const notify of [...listeners]) notify();
    },
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
  const session = stubSession(documentId);
  return {
    document: bytes,
    session,
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

afterEach(cleanup);

function Probe({
  createRoom,
  autoConnect = true,
  onState,
}: {
  createRoom: (options: UseHocuspocusCollaborationConnectOptions) => Promise<StubRoom>;
  autoConnect?: boolean;
  onState: (value: UseHocuspocusCollaborationReturn) => void;
}) {
  const options = {
    room: autoConnect ? CONNECT : null,
    [HOCUSPOCUS_CREATE_ROOM_FOR_TESTS]: createRoom,
  };
  const value = useHocuspocusCollaboration(options);
  onState(value);
  return null;
}

describe('useHocuspocusCollaboration', () => {
  test('a session that fails after the join reaches `error`', async () => {
    // The documented guard is `if (error) …`. Before this, only a failed CONNECT set it, so
    // an expired token or a `concurrent-seed` — both of which land after a successful join —
    // left `error` null while replication was dead, and that guard rendered a healthy editor
    // over a room nobody could reach.
    const session = failableSession('room-fail');
    const createRoom = async () => {
      await Promise.resolve();
      return {
        document: new Uint8Array([1, 2, 3]),
        session,
        destroy() {},
        get destroyed() {
          return false;
        },
      } as StubRoom;
    };
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe createRoom={createRoom} onState={(value) => (latest = value)} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    // The join succeeded: a document, no error.
    expect(latest?.document).not.toBeNull();
    expect(latest?.error).toBeNull();

    await act(async () => {
      session.fail('authentication-failed');
    });
    expect(latest?.error?.code).toBe('authentication-failed');
  });

  test('StrictMode remount keeps a live room', async () => {
    const created: StubRoom[] = [];
    const createRoom = async () => {
      await Promise.resolve();
      const room = fakeRoom(`room-${created.length}`);
      created.push(room);
      return room;
    };
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(
        <StrictMode>
          <Probe createRoom={createRoom} onState={(value) => (latest = value)} />
        </StrictMode>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const live = created.filter((room) => !room.destroyed);
    expect(live).toHaveLength(1);
    expect(latest?.session).toBe(live[0]?.session);
    expect(latest?.pending).toBe(false);
  });

  test('leave destroys the room and clears the session', async () => {
    const created: StubRoom[] = [];
    const createRoom = async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    };
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe createRoom={createRoom} onState={(value) => (latest = value)} />);
      await Promise.resolve();
    });
    expect(created[0]?.destroyed).toBe(false);
    const leftover = new Uint8Array([9]);
    await act(async () => {
      latest?.leave(leftover);
    });
    expect(created[0]?.destroyed).toBe(true);
    expect(latest?.session).toBeNull();
    expect(latest?.document).toBe(leftover);
  });

  test('leave refuses to run without the current document bytes', async () => {
    const created: StubRoom[] = [];
    const createRoom = async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    };
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe createRoom={createRoom} onState={(value) => (latest = value)} />);
      await Promise.resolve();
    });
    expect(() => (latest?.leave as unknown as () => void)()).toThrow(/await editor\.save\(\)/);
    expect(created[0]?.destroyed).toBe(false);
    expect(latest?.session).not.toBeNull();
  });

  test('the room ydoc and provider are exposed while connected and null after leave', async () => {
    const created: StubRoom[] = [];
    const createRoom = async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    };
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe createRoom={createRoom} onState={(value) => (latest = value)} />);
      await Promise.resolve();
    });
    expect(latest?.ydoc).toBe(created[0]!.ydoc!);
    expect(latest?.provider).toBe(created[0]!.provider!);
    await act(async () => {
      latest?.leave(new Uint8Array([9]));
    });
    expect(latest?.ydoc).toBeNull();
    expect(latest?.provider).toBeNull();
  });

  test('rejoin leaves with the passed bytes and reconnects with bootstrap join', async () => {
    const created: StubRoom[] = [];
    const seenOptions: UseHocuspocusCollaborationConnectOptions[] = [];
    const createRoom = async (options: UseHocuspocusCollaborationConnectOptions) => {
      seenOptions.push(options);
      const room = fakeRoom(`room-${created.length}`);
      created.push(room);
      return room;
    };
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe autoConnect={false} createRoom={createRoom} onState={(v) => (latest = v)} />);
    });
    const create: UseHocuspocusCollaborationConnectOptions = {
      ...CONNECT,
      bootstrap: { kind: 'create', document: new Uint8Array([1]) },
    };
    await act(async () => {
      await latest?.connect(create);
    });
    const saved = new Uint8Array([42]);
    await act(async () => {
      await latest?.rejoin(saved);
    });
    expect(created[0]?.destroyed).toBe(true);
    expect(created[1]?.destroyed).toBe(false);
    expect(latest?.session).toBe(created[1]!.session);
    // The server still holds the room, so a rejoin never re-creates it from local bytes.
    expect(seenOptions[1]).toMatchObject({
      url: CONNECT.url,
      roomId: CONNECT.roomId,
      identity: CONNECT.identity,
      bootstrap: { kind: 'join' },
    });
  });

  test('rejoin after a failed initial connect retries as a joiner', async () => {
    // The failed attempt is still "the last connect": rejoin must retry it instead of
    // refusing with "call connect first".
    let calls = 0;
    const seenOptions: UseHocuspocusCollaborationConnectOptions[] = [];
    const room = fakeRoom('recovered');
    const createRoom = async (options: UseHocuspocusCollaborationConnectOptions) => {
      seenOptions.push(options);
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('initialization-timeout'), {
          code: 'initialization-timeout',
        });
      }
      return room;
    };
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe autoConnect={false} createRoom={createRoom} onState={(v) => (latest = v)} />);
    });
    await act(async () => {
      try {
        await latest?.connect({
          ...CONNECT,
          bootstrap: { kind: 'create', document: new Uint8Array([1]) },
        });
      } catch {
        // The failure is under test; the hook already exposes it through `error`.
      }
    });
    expect(latest?.error).toEqual({ code: 'initialization-timeout' });
    const saved = new Uint8Array([42]);
    await act(async () => {
      await latest?.rejoin(saved);
    });
    expect(latest?.session).toBe(room.session);
    expect(latest?.error).toBeNull();
    expect(seenOptions[1]).toMatchObject({
      url: CONNECT.url,
      roomId: CONNECT.roomId,
      identity: CONNECT.identity,
      bootstrap: { kind: 'join' },
    });
  });

  test('a failed rejoin keeps the saved bytes mounted and resolves the typed error', async () => {
    let calls = 0;
    const first = fakeRoom();
    const createRoom = async () => {
      calls += 1;
      if (calls === 1) return first;
      throw Object.assign(new Error('initialization-timeout'), {
        code: 'initialization-timeout',
      });
    };
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe autoConnect={false} createRoom={createRoom} onState={(v) => (latest = v)} />);
    });
    await act(async () => {
      await latest?.connect(CONNECT);
    });
    const saved = new Uint8Array([7]);
    let resolved: unknown;
    await act(async () => {
      resolved = await latest?.rejoin(saved);
    });
    // Resolves like `connect`, and the saved bytes are still what is mounted — a rejoin that
    // could not reach the room must not also lose the work it was handed.
    expect(resolved).toEqual({ code: 'initialization-timeout' });
    expect(latest?.error).toEqual({ code: 'initialization-timeout' });
    expect(latest?.session).toBeNull();
    expect(latest?.document).toBe(saved);
  });

  test('throws when host modules already include a collaboration contribution', () => {
    const modules = [collaborationModule({ session: stubSession('host') })];
    expect(() => {
      function Conflict() {
        useHocuspocusCollaboration({ modules });
        return null;
      }
      render(<Conflict />);
    }).toThrow(/already include a collaboration contribution/);
  });

  test('pending is true until createRoom resolves', async () => {
    let finish: ((room: StubRoom) => void) | undefined;
    const createRoom = () =>
      new Promise<StubRoom>((resolve) => {
        finish = resolve;
      });
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe createRoom={createRoom} onState={(value) => (latest = value)} />);
    });
    expect(latest?.pending).toBe(true);
    expect(latest?.session).toBeNull();
    await act(async () => {
      finish?.(fakeRoom());
      await Promise.resolve();
    });
    expect(latest?.pending).toBe(false);
    expect(latest?.session).not.toBeNull();
  });

  test('a failed auto-connect reports a typed collaboration failure', async () => {
    // Nobody awaits the auto-connect, so a rejection here would surface as an unhandled
    // rejection on a room the host already renders as failed.
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    let latest: UseHocuspocusCollaborationReturn | undefined;
    try {
      await act(async () => {
        render(
          <Probe
            createRoom={() => Promise.reject(new Error('server refused'))}
            onState={(value) => (latest = value)}
          />
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } finally {
      process.off('unhandledRejection', onRejection);
    }
    expect(latest?.error).toEqual({ code: 'transport', detail: 'server refused' });
    expect(latest?.pending).toBe(false);
    expect(latest?.session).toBeNull();
    expect(rejections).toEqual([]);
  });

  test('connect resolves with the failure code from a schema error', async () => {
    let latest: UseHocuspocusCollaborationReturn | undefined;
    await act(async () => {
      render(
        <Probe
          autoConnect={false}
          createRoom={() =>
            Promise.reject(
              Object.assign(new Error('initialization-timeout'), {
                code: 'initialization-timeout',
              })
            )
          }
          onState={(value) => (latest = value)}
        />
      );
    });
    // RESOLVES with the failure rather than rejecting, so the ordinary call site —
    // `onClick={() => connect(options)}` — cannot raise an unhandled rejection.
    let resolved: unknown;
    await act(async () => {
      resolved = await latest?.connect(CONNECT);
    });
    expect(resolved).toEqual({ code: 'initialization-timeout' });
    expect(latest?.error).toEqual({ code: 'initialization-timeout' });
  });

  test('idle modules stay the same reference across renders', async () => {
    const hostModules = Object.freeze([{ id: 'host' }]);
    const seen: unknown[] = [];
    function Idle() {
      const value = useHocuspocusCollaboration({ modules: hostModules });
      seen.push(value.modules);
      return null;
    }
    const view = render(<Idle />);
    view.rerender(<Idle />);
    expect(seen[0]).toBe(hostModules);
    expect(seen[1]).toBe(hostModules);
  });

  test('connect from idle adopts the room', async () => {
    let latest: UseHocuspocusCollaborationReturn | undefined;
    const room = fakeRoom('joined');
    await act(async () => {
      render(
        <Probe
          autoConnect={false}
          createRoom={async () => room}
          onState={(value) => (latest = value)}
        />
      );
    });
    expect(latest?.session).toBeNull();
    await act(async () => {
      await latest?.connect(CONNECT);
    });
    expect(latest?.session?.documentId).toBe('joined');
    expect(room.destroyed).toBe(false);
  });
});

describe('collaboration factory names', () => {
  test('the default React entry does not import the Hocuspocus hook', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'react', 'index.ts'), 'utf8');
    expect(source).not.toContain('useHocuspocusCollaboration');
    expect(source).not.toContain('@hocuspocus/provider');
    expect(source).not.toContain('collaboration/hocuspocus');
  });

  test('the public hocuspocus entry does not export the test room factory', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'react', 'hocuspocus.ts'), 'utf8');
    expect(source).not.toContain('HOCUSPOCUS_CREATE_ROOM_FOR_TESTS');
    expect(source).not.toContain('createRoom');
  });
});
