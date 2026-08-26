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
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import {
  useDocumentCollaboration,
  DOCUMENT_CREATE_ROOM_FOR_TESTS,
  type UseDocumentCollaborationConnectOptions,
  type UseDocumentCollaborationReturn,
} from '../vue/useDocumentCollaboration.ts';

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

function mountHook(
  createRoom: (options: UseDocumentCollaborationConnectOptions) => Promise<StubRoom>,
  autoRoom: UseDocumentCollaborationConnectOptions | null = null
): { latest: () => UseDocumentCollaborationReturn | null; unmount: () => void } {
  let latest: UseDocumentCollaborationReturn | null = null;
  const app = createApp(
    defineComponent({
      setup() {
        const options = {
          room: autoRoom,
          [DOCUMENT_CREATE_ROOM_FOR_TESTS]: createRoom,
        };
        latest = useDocumentCollaboration(options);
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

describe('useDocumentCollaboration (Vue)', () => {
  test('connect adopts the consumer-owned room and composes the collaboration module', async () => {
    const room = fakeRoom('joined');
    const mounted = mountHook(async () => room);
    await nextTick();
    expect(mounted.latest()?.session.value).toBeNull();
    await mounted.latest()?.connect(connectOptions());
    expect(mounted.latest()?.session.value?.documentId).toBe('joined');
    expect(mounted.latest()?.modules.value.some((module) => module.collaboration)).toBe(true);
    mounted.unmount();
  });

  test('leave requires the current document bytes and keeps them mounted', async () => {
    const created: StubRoom[] = [];
    const mounted = mountHook(async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    }, connectOptions());
    await Promise.resolve();
    await nextTick();
    expect(() => (mounted.latest()?.leave as unknown as () => void)()).toThrow(
      /await editor\.save\(\)/
    );
    expect(created[0]?.destroyed).toBe(false);
    const saved = new Uint8Array([9]);
    mounted.latest()?.leave(saved);
    expect(created[0]?.destroyed).toBe(true);
    expect(mounted.latest()?.session.value).toBeNull();
    expect(mounted.latest()?.document.value).toBe(saved);
    mounted.unmount();
  });

  test('unmount destroys the room after the remount window', async () => {
    const created: StubRoom[] = [];
    const mounted = mountHook(async () => {
      const room = fakeRoom();
      created.push(room);
      return room;
    }, connectOptions());
    await Promise.resolve();
    await nextTick();
    expect(created[0]?.destroyed).toBe(false);
    mounted.unmount();
    expect(created[0]?.destroyed).toBe(false);
    await Promise.resolve();
    expect(created[0]?.destroyed).toBe(true);
  });

  test('the default Vue entry exports the composable without importing a network provider', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'vue', 'index.ts'), 'utf8');
    expect(source).toContain('useDocumentCollaboration');
    expect(source).not.toContain('y-webrtc');
    expect(source).not.toContain('collaboration/webrtc');
    const hook = readFileSync(
      join(import.meta.dir, '..', 'vue', 'useDocumentCollaboration.ts'),
      'utf8'
    );
    expect(hook).not.toContain('y-webrtc');
  });
});
