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
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import {
  useDocumentCollaboration,
  DOCUMENT_CREATE_ROOM_FOR_TESTS,
  type UseDocumentCollaborationConnectOptions,
  type UseDocumentCollaborationReturn,
} from '../react/useDocumentCollaboration.ts';

function stubSession(documentId = 'doc-1'): EditorCollaborationSession {
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

function fakeRoom(documentId = 'doc-1'): StubRoom {
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

function connectOptions(): UseDocumentCollaborationConnectOptions {
  const ydoc = new Y.Doc();
  return {
    ydoc,
    awareness: new Awareness(ydoc),
    documentId: 'doc-1',
    identity: { actorId: 'alex', name: 'Alex' },
    bootstrap: { kind: 'join' },
  };
}

afterEach(cleanup);

function Probe({
  createRoom,
  autoRoom = null,
  onState,
}: {
  createRoom: (options: UseDocumentCollaborationConnectOptions) => Promise<StubRoom>;
  autoRoom?: UseDocumentCollaborationConnectOptions | null;
  onState: (value: UseDocumentCollaborationReturn) => void;
}) {
  const options = {
    room: autoRoom,
    [DOCUMENT_CREATE_ROOM_FOR_TESTS]: createRoom,
  };
  const value = useDocumentCollaboration(options);
  onState(value);
  return null;
}

describe('useDocumentCollaboration', () => {
  test('StrictMode remount keeps a live room', async () => {
    const created: StubRoom[] = [];
    const createRoom = async () => {
      await Promise.resolve();
      const room = fakeRoom(`doc-${created.length}`);
      created.push(room);
      return room;
    };
    let latest: UseDocumentCollaborationReturn | undefined;
    const auto = connectOptions();
    await act(async () => {
      render(
        <StrictMode>
          <Probe createRoom={createRoom} autoRoom={auto} onState={(value) => (latest = value)} />
        </StrictMode>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const live = created.filter((room) => !room.destroyed);
    expect(live).toHaveLength(1);
    expect(latest?.session).toBe(live[0]!.session);
    expect(latest?.pending).toBe(false);
  });

  test('connect adopts the consumer-owned room and composes the collaboration module', async () => {
    const room = fakeRoom('joined');
    let latest: UseDocumentCollaborationReturn | undefined;
    await act(async () => {
      render(<Probe createRoom={async () => room} onState={(value) => (latest = value)} />);
    });
    expect(latest?.session).toBeNull();
    expect(latest?.modules).toEqual([]);
    await act(async () => {
      await latest?.connect(connectOptions());
    });
    expect(latest?.session?.documentId).toBe('joined');
    expect(latest?.document).toBe(room.document);
    expect(latest?.modules.some((module) => module.collaboration)).toBe(true);
  });

  test('leave requires the current document bytes and keeps them mounted', async () => {
    const created: StubRoom[] = [];
    const createRoom = async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    };
    let latest: UseDocumentCollaborationReturn | undefined;
    await act(async () => {
      render(
        <Probe
          createRoom={createRoom}
          autoRoom={connectOptions()}
          onState={(value) => (latest = value)}
        />
      );
      await Promise.resolve();
    });
    expect(() => (latest?.leave as unknown as () => void)()).toThrow(/await editor\.save\(\)/);
    expect(created[0]?.destroyed).toBe(false);
    const saved = new Uint8Array([9]);
    await act(async () => {
      latest?.leave(saved);
    });
    expect(created[0]?.destroyed).toBe(true);
    expect(latest?.session).toBeNull();
    expect(latest?.document).toBe(saved);
  });

  test('the default React entry exports the hook without importing a network provider', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'react', 'index.ts'), 'utf8');
    expect(source).toContain('useDocumentCollaboration');
    expect(source).not.toContain('y-webrtc');
    expect(source).not.toContain('collaboration/webrtc');
    const hook = readFileSync(
      join(import.meta.dir, '..', 'react', 'useDocumentCollaboration.ts'),
      'utf8'
    );
    expect(hook).not.toContain('y-webrtc');
  });
});
