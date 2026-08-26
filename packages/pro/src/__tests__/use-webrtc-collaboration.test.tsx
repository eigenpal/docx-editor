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
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import {
  useWebrtcCollaboration,
  type UseWebrtcCollaborationConnectOptions,
  type UseWebrtcCollaborationReturn,
  type UseWebrtcCollaborationRoomHandle,
} from '../react/useWebrtcCollaboration.ts';
import { createTextCollaboration, createYjsCollaboration } from '../collaboration/index.ts';

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
  const bytes = new Uint8Array([1, 2, 3]);
  const session = stubSession(documentId);
  return {
    document: bytes,
    session,
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
  createRoom: (
    options: UseWebrtcCollaborationConnectOptions
  ) => Promise<UseWebrtcCollaborationRoomHandle>;
  autoConnect?: boolean;
  onState: (value: UseWebrtcCollaborationReturn) => void;
}) {
  const value = useWebrtcCollaboration({
    room: autoConnect ? CONNECT : null,
    createRoom,
  });
  onState(value);
  return null;
}

describe('useWebrtcCollaboration', () => {
  test('StrictMode remount keeps a live room', async () => {
    const created: Array<ReturnType<typeof fakeRoom>> = [];
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
    const created: Array<ReturnType<typeof fakeRoom>> = [];
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

  test('pending is true until createRoom resolves', async () => {
    let finish: ((room: UseWebrtcCollaborationRoomHandle) => void) | undefined;
    const createRoom = () =>
      new Promise<UseWebrtcCollaborationRoomHandle>((resolve) => {
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

  test('a failed auto-connect reports through error and rejects nothing', async () => {
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
    expect(latest?.error?.message).toBe('signaling refused');
    expect(latest?.pending).toBe(false);
    expect(latest?.session).toBeNull();
    expect(rejections).toEqual([]);
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
  test('createTextCollaboration is the paragraph-text factory', () => {
    expect(createTextCollaboration).toBe(createYjsCollaboration);
  });

  test('the default React entry does not import the WebRTC hook', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'react', 'index.ts'), 'utf8');
    expect(source).not.toContain('useWebrtcCollaboration');
    expect(source).not.toContain('y-webrtc');
    expect(source).not.toContain('collaboration/webrtc');
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
