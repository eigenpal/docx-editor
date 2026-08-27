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
import type { WebrtcProvider } from 'y-webrtc';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import { collaborationModule } from '../collaboration/collaboration-module.ts';
import {
  useWebrtcCollaboration,
  WEBRTC_CREATE_ROOM_FOR_TESTS,
  type UseWebrtcCollaborationConnectOptions,
  type UseWebrtcCollaborationReturn,
} from '../react/useWebrtcCollaboration.ts';

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
  readonly ydoc?: Y.Doc;
  readonly provider?: WebrtcProvider;
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
    provider: { stub: 'provider' } as unknown as WebrtcProvider,
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

afterEach(cleanup);

function Probe({
  createRoom,
  autoConnect = true,
  onState,
}: {
  createRoom: (options: UseWebrtcCollaborationConnectOptions) => Promise<StubRoom>;
  autoConnect?: boolean;
  onState: (value: UseWebrtcCollaborationReturn) => void;
}) {
  const options = {
    room: autoConnect ? CONNECT : null,
    [WEBRTC_CREATE_ROOM_FOR_TESTS]: createRoom,
  };
  const value = useWebrtcCollaboration(options);
  onState(value);
  return null;
}

describe('useWebrtcCollaboration', () => {
  test('connect forwards offlineEditing to the room factory', async () => {
    const seenOptions: UseWebrtcCollaborationConnectOptions[] = [];
    const createRoom = async (options: UseWebrtcCollaborationConnectOptions) => {
      seenOptions.push(options);
      return fakeRoom();
    };
    let latest: UseWebrtcCollaborationReturn | undefined;
    await act(async () => {
      render(
        <Probe autoConnect={false} createRoom={createRoom} onState={(value) => (latest = value)} />
      );
    });
    await act(async () => {
      await latest?.connect({ ...CONNECT, offlineEditing: true });
    });
    expect(seenOptions[0]?.offlineEditing).toBe(true);
  });

  test('StrictMode remount keeps a live room', async () => {
    const created: StubRoom[] = [];
    const createRoom = async () => {
      await Promise.resolve();
      const room = fakeRoom(`room-${created.length}`);
      created.push(room);
      return room;
    };
    let latest: UseWebrtcCollaborationReturn | undefined;
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
    let latest: UseWebrtcCollaborationReturn | undefined;
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
    // A bare leave used to fall back to the bytes the room STARTED from, silently dropping
    // every edit made in the room. The argument is now required and validated.
    const created: StubRoom[] = [];
    const createRoom = async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    };
    let latest: UseWebrtcCollaborationReturn | undefined;
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
    let latest: UseWebrtcCollaborationReturn | undefined;
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
    const seenOptions: UseWebrtcCollaborationConnectOptions[] = [];
    const createRoom = async (options: UseWebrtcCollaborationConnectOptions) => {
      seenOptions.push(options);
      const room = fakeRoom(`room-${created.length}`);
      created.push(room);
      return room;
    };
    let latest: UseWebrtcCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe autoConnect={false} createRoom={createRoom} onState={(v) => (latest = v)} />);
    });
    const create: UseWebrtcCollaborationConnectOptions = {
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
    // The room still exists on peers, so a rejoin never re-creates it from local bytes.
    expect(seenOptions[1]).toMatchObject({
      roomId: CONNECT.roomId,
      identity: CONNECT.identity,
      bootstrap: { kind: 'join' },
    });
  });

  test('rejoin after a failed initial connect retries as a joiner', async () => {
    // The failed attempt is still "the last connect": rejoin must retry it instead of
    // refusing with "call connect first".
    let calls = 0;
    const seenOptions: UseWebrtcCollaborationConnectOptions[] = [];
    const room = fakeRoom('recovered');
    const createRoom = async (options: UseWebrtcCollaborationConnectOptions) => {
      seenOptions.push(options);
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('initialization-timeout'), {
          code: 'initialization-timeout',
        });
      }
      return room;
    };
    let latest: UseWebrtcCollaborationReturn | undefined;
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
      roomId: CONNECT.roomId,
      identity: CONNECT.identity,
      bootstrap: { kind: 'join' },
    });
  });

  test('a failed rejoin keeps the saved bytes mounted and surfaces the typed error', async () => {
    let calls = 0;
    const first = fakeRoom();
    const createRoom = async () => {
      calls += 1;
      if (calls === 1) return first;
      throw Object.assign(new Error('initialization-timeout'), {
        code: 'initialization-timeout',
      });
    };
    let latest: UseWebrtcCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe autoConnect={false} createRoom={createRoom} onState={(v) => (latest = v)} />);
    });
    await act(async () => {
      await latest?.connect(CONNECT);
    });
    const saved = new Uint8Array([7]);
    let thrown: unknown;
    await act(async () => {
      try {
        await latest?.rejoin(saved);
      } catch (cause) {
        thrown = cause;
      }
    });
    expect((thrown as { code?: string }).code).toBe('initialization-timeout');
    expect(latest?.error).toEqual({ code: 'initialization-timeout' });
    expect(latest?.session).toBeNull();
    expect(latest?.document).toBe(saved);
  });

  test('throws when host modules already include a collaboration contribution', () => {
    const modules = [collaborationModule({ session: stubSession('host') })];
    expect(() => {
      function Conflict() {
        useWebrtcCollaboration({ modules });
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
    let latest: UseWebrtcCollaborationReturn | undefined;
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
    let latest: UseWebrtcCollaborationReturn | undefined;
    try {
      await act(async () => {
        render(
          <Probe
            createRoom={() => Promise.reject(new Error('signaling refused'))}
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
    expect(latest?.error).toEqual({ code: 'transport', detail: 'signaling refused' });
    expect(latest?.pending).toBe(false);
    expect(latest?.session).toBeNull();
    expect(rejections).toEqual([]);
  });

  test('connect rejects with the failure code from a schema error', async () => {
    let latest: UseWebrtcCollaborationReturn | undefined;
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
    let thrown: unknown;
    await act(async () => {
      try {
        await latest?.connect(CONNECT);
      } catch (cause) {
        thrown = cause;
      }
    });
    expect(latest?.error).toEqual({ code: 'initialization-timeout' });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string }).code).toBe('initialization-timeout');
  });

  test('idle modules stay the same reference across renders', async () => {
    const hostModules = Object.freeze([{ id: 'host' }]);
    const seen: unknown[] = [];
    function Idle() {
      const value = useWebrtcCollaboration({ modules: hostModules });
      seen.push(value.modules);
      return null;
    }
    const view = render(<Idle />);
    view.rerender(<Idle />);
    expect(seen[0]).toBe(hostModules);
    expect(seen[1]).toBe(hostModules);
  });

  test('connect from idle adopts the room', async () => {
    let latest: UseWebrtcCollaborationReturn | undefined;
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
  test('the default React entry does not import the WebRTC hook', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'react', 'index.ts'), 'utf8');
    expect(source).not.toContain('useWebrtcCollaboration');
    expect(source).not.toContain('y-webrtc');
    expect(source).not.toContain('collaboration/webrtc');
  });

  test('the public webrtc entry does not export the test room factory', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'react', 'webrtc.ts'), 'utf8');
    expect(source).not.toContain('WEBRTC_CREATE_ROOM_FOR_TESTS');
    expect(source).not.toContain('UseWebrtcCollaborationRoomHandle');
    expect(source).not.toContain('createRoom');
  });

  test('ComposedEditorDemo uses the hook instead of a private owner', () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        '..',
        '..',
        'examples',
        'vite',
        'src',
        'ComposedEditorDemo.tsx'
      ),
      'utf8'
    );
    expect(source).toContain('useWebrtcCollaboration');
    expect(source).not.toContain('createCollaborationRoomOwner');
    expect(source).not.toMatch(/collaborationRoom\?\.destroy\(\)/);
  });
});
