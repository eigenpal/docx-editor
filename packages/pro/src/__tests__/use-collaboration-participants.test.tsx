/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import type {
  CollaborationParticipant,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import { useCollaborationParticipants } from '../react/useCollaborationParticipants.ts';

afterEach(() => {
  cleanup();
});

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
    attach: () => () => {},
    gateOperations: () => null,
    canUndo: () => false,
    canRedo: () => false,
    undo: () => false,
    redo: () => false,
    setLocalSelection: () => {},
    // A fresh frozen array per call, exactly like the engine session.
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

describe('useCollaborationParticipants', () => {
  test('reflects the roster and updates on the participants subscription', () => {
    const session = controllableSession();
    session.setParticipants([ALICE]);
    const seen: (readonly CollaborationParticipant[])[] = [];
    function Probe() {
      seen.push(useCollaborationParticipants(session));
      return null;
    }
    render(<Probe />);
    expect(seen.at(-1)).toMatchObject([{ actorId: 'alice', isLocal: true }]);
    act(() => {
      session.setParticipants([ALICE, BOB]);
      session.notify();
    });
    expect(seen.at(-1)).toMatchObject([{ actorId: 'alice' }, { actorId: 'bob', name: 'Bob' }]);
  });

  test('an unchanged roster keeps the same array reference', () => {
    const session = controllableSession();
    session.setParticipants([ALICE, BOB]);
    const seen: (readonly CollaborationParticipant[])[] = [];
    function Probe() {
      seen.push(useCollaborationParticipants(session));
      return null;
    }
    const view = render(<Probe />);
    view.rerender(<Probe />);
    act(() => {
      // Awareness traffic that does not change the roster: participants() returns a fresh
      // array, and the hook must not hand a new reference to the consumer.
      session.notify();
    });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
  });

  test('a null session yields a stable empty array', () => {
    const seen: (readonly CollaborationParticipant[])[] = [];
    function Probe() {
      seen.push(useCollaborationParticipants(null));
      return null;
    }
    const view = render(<Probe />);
    view.rerender(<Probe />);
    expect(seen[0]).toEqual([]);
    expect(seen[0]).toBe(seen[1]!);
  });
});
