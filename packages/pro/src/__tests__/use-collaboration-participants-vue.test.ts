/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, shallowRef } from 'vue';
import type {
  CollaborationParticipant,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import {
  useCollaborationParticipants,
  type UseCollaborationParticipantsReturn,
} from '../vue/useCollaborationParticipants.ts';

function controllableSession(): EditorCollaborationSession & {
  setParticipants(next: readonly CollaborationParticipant[]): void;
  notify(): void;
} {
  let roster: readonly CollaborationParticipant[] = Object.freeze([]);
  const listeners = new Set<(participants: readonly CollaborationParticipant[]) => void>();
  return {
    documentId: 'hook-room',
    sessionId: 'hook-session',
    identity: { actorId: 'local', name: 'Local' },
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
    participants: () => Object.freeze([...roster]),
    subscribeParticipants: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remoteSelections: () => [],
    subscribeRemoteSelections: () => () => {},
    flushPendingJournals: () => {},
    destroy: () => {},
    setParticipants(next) {
      roster = next;
    },
    notify() {
      for (const listener of [...listeners]) listener(Object.freeze([...roster]));
    },
  };
}

const ALICE: CollaborationParticipant = {
  actorId: 'alice',
  name: 'Alice',
  role: 'human',
  isLocal: true,
};
const BOB: CollaborationParticipant = {
  actorId: 'bob',
  name: 'Bob',
  color: '#aabbcc',
  role: 'human',
  isLocal: false,
};

function mountHook(session: EditorCollaborationSession | null): {
  latest: () => UseCollaborationParticipantsReturn | null;
  unmount: () => void;
} {
  let latest: UseCollaborationParticipantsReturn | null = null;
  const sessionRef = shallowRef(session);
  const app = createApp(
    defineComponent({
      setup() {
        latest = useCollaborationParticipants(sessionRef);
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

describe('useCollaborationParticipants (Vue)', () => {
  test('reflects the roster and updates on the participants subscription', () => {
    const session = controllableSession();
    session.setParticipants([ALICE]);
    const mounted = mountHook(session);
    expect(mounted.latest()?.participants.value).toMatchObject([{ actorId: 'alice' }]);
    session.setParticipants([ALICE, BOB]);
    session.notify();
    expect(mounted.latest()?.participants.value).toMatchObject([
      { actorId: 'alice' },
      { actorId: 'bob', name: 'Bob' },
    ]);
    mounted.unmount();
  });

  test('an unchanged roster keeps the same array reference', () => {
    const session = controllableSession();
    session.setParticipants([ALICE, BOB]);
    const mounted = mountHook(session);
    const before = mounted.latest()?.participants.value;
    session.notify();
    expect(mounted.latest()?.participants.value).toBe(before!);
    mounted.unmount();
  });

  test('a null session yields a stable empty array', () => {
    const mounted = mountHook(null);
    expect(mounted.latest()?.participants.value).toEqual([]);
    mounted.unmount();
  });
});
