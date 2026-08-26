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
import { createCollaborationStatusTracker } from '@docx-editor.dev/core/collaboration';
import type {
  CollaborationFailureCode,
  CollaborationStatus,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import { useCollaborationStatus } from '../../react/useCollaborationStatus.ts';

afterEach(() => {
  cleanup();
});

function controllableSession(): EditorCollaborationSession & {
  failThenRecover(code: CollaborationFailureCode): void;
} {
  const statusState = createCollaborationStatusTracker('ready');
  const listeners = new Set<
    (status: CollaborationStatus, reason?: CollaborationFailureCode, detail?: string) => void
  >();
  const emit = (): void => {
    const snapshot = statusState.snapshot();
    for (const listener of [...listeners]) {
      listener(snapshot.status, snapshot.reason?.code, snapshot.reason?.detail);
    }
  };
  return {
    documentId: 'hook-room',
    sessionId: 'hook-session',
    identity: { actorId: 'local', name: 'Local' },
    status: () => statusState.status(),
    statusSnapshot: () => statusState.snapshot(),
    subscribeStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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
    failThenRecover(code: CollaborationFailureCode) {
      statusState.set('error', code);
      emit();
      statusState.set('ready');
      emit();
    },
  };
}

function StatusProbe({ session }: { session: EditorCollaborationSession | null }) {
  const snapshot = useCollaborationStatus(session);
  return (
    <div
      data-status={snapshot.status}
      data-reason={snapshot.reason?.code ?? ''}
      data-last={snapshot.lastFailure?.code ?? ''}
    />
  );
}

describe('useCollaborationStatus', () => {
  test('a recovered failure stays readable, including for a host that mounts later', () => {
    const session = controllableSession();
    session.failThenRecover('document-id-mismatch');
    const view = render(<StatusProbe session={session} />);
    const node = view.container.querySelector('div')!;
    expect(node.getAttribute('data-status')).toBe('ready');
    expect(node.getAttribute('data-reason')).toBe('');
    expect(node.getAttribute('data-last')).toBe('document-id-mismatch');
  });

  test('a coalesced error-then-ready notify still reports lastFailure', () => {
    const session = controllableSession();
    const view = render(<StatusProbe session={session} />);
    act(() => {
      session.failThenRecover('unknown-logical-id');
    });
    const node = view.container.querySelector('div')!;
    expect(node.getAttribute('data-status')).toBe('ready');
    expect(node.getAttribute('data-reason')).toBe('');
    expect(node.getAttribute('data-last')).toBe('unknown-logical-id');
  });

  test('the returned object stays the same reference when nothing changed', () => {
    const session = controllableSession();
    const seen: object[] = [];
    function Probe() {
      seen.push(useCollaborationStatus(session));
      return null;
    }
    const view = render(<Probe />);
    view.rerender(<Probe />);
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
