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
import { DocxEditorCollaboration } from '../../react/DocxEditorCollaboration.tsx';

afterEach(() => {
  cleanup();
});

function controllableSession(): EditorCollaborationSession & {
  failThenRecover(code: CollaborationFailureCode): void;
  degrade(code: CollaborationFailureCode): void;
  diverge(code: CollaborationFailureCode): void;
  wait(waiting: boolean): void;
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
    failThenRecover(code: CollaborationFailureCode) {
      statusState.set('error', code);
      emit();
      statusState.set('ready');
      emit();
    },
    degrade(code: CollaborationFailureCode) {
      statusState.set('error', code, undefined, true);
      emit();
    },
    diverge(code: CollaborationFailureCode) {
      statusState.set('error', code);
      emit();
    },
    wait(waiting: boolean) {
      statusState.setWaiting(waiting);
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

describe('repeated and self-healing failures', () => {
  function Probe({ session }: { session: EditorCollaborationSession }) {
    const snapshot = useCollaborationStatus(session);
    return (
      <div
        data-failures={String(snapshot.failureCount)}
        data-recovering={String(snapshot.recovering)}
        data-diverged={String(snapshot.diverged)}
      />
    );
  }

  test('each refusal shows, also when it repeats the same code', () => {
    const session = controllableSession();
    const { container } = render(<Probe session={session} />);
    const node = () => container.firstElementChild as HTMLElement;
    act(() => session.failThenRecover('unknown-logical-id'));
    expect(node().dataset.failures).toBe('1');
    act(() => session.failThenRecover('unknown-logical-id'));
    expect(node().dataset.failures).toBe('2');
  });

  test('an error that heals by itself is recovering, not diverged', () => {
    const session = controllableSession();
    const { container } = render(<Probe session={session} />);
    act(() => session.degrade('remote-apply-failed'));
    const node = container.firstElementChild as HTMLElement;
    expect(node.dataset.recovering).toBe('true');
    expect(node.dataset.diverged).toBe('false');
  });
});

describe('DocxEditorCollaboration.Status', () => {
  test('shows nothing while all is well, and a rejoin action when out of sync', () => {
    const session = controllableSession();
    let rejoined = 0;
    const { container } = render(
      <DocxEditorCollaboration.Status session={session} onRejoin={() => (rejoined += 1)} />
    );
    expect(container.querySelector('[data-collaboration-status]')).toBeNull();
    act(() => session.degrade('remote-apply-failed'));
    expect(
      container
        .querySelector('[data-collaboration-status]')
        ?.getAttribute('data-collaboration-status')
    ).toBe('syncing');
    act(() => session.diverge('remote-apply-failed'));
    const notice = container.querySelector('[data-collaboration-status="outOfSync"]');
    expect(notice?.getAttribute('role')).toBe('status');
    const button = notice?.querySelector('button');
    expect(button?.textContent).toBe('Rejoin');
    act(() => button!.click());
    expect(rejoined).toBe(1);
  });

  test('keeps an empty live region mounted, and says when edits wait', () => {
    const session = controllableSession();
    const { container } = render(<DocxEditorCollaboration.Status session={session} />);
    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');
    act(() => session.wait(true));
    expect(region?.getAttribute('data-collaboration-status')).toBe('waiting');
    act(() => session.wait(false));
    expect(region?.textContent).toBe('');
  });

  test('a format mismatch asks for an upgrade, with no rejoin action', () => {
    const session = controllableSession();
    const { container } = render(
      <DocxEditorCollaboration.Status session={session} onRejoin={() => {}} />
    );
    act(() => session.diverge('schema-version-mismatch'));
    const notice = container.querySelector('[data-collaboration-status="upgradeRequired"]');
    expect(notice).not.toBeNull();
    expect(notice?.querySelector('button')).toBeNull();
  });

  test('a room that cannot continue asks for a new room, with no rejoin action', () => {
    const session = controllableSession();
    const { container } = render(
      <DocxEditorCollaboration.Status session={session} onRejoin={() => {}} />
    );
    act(() => session.diverge('concurrent-seed'));
    const notice = container.querySelector('[data-collaboration-status="newRoomRequired"]');
    expect(notice).not.toBeNull();
    expect(notice?.querySelector('button')).toBeNull();
  });

  test('tells the user when the room refused an edit', () => {
    const session = controllableSession();
    const { container } = render(<DocxEditorCollaboration.Status session={session} />);
    act(() => session.failThenRecover('unknown-logical-id'));
    expect(container.querySelector('[data-collaboration-status="editRefused"]')).not.toBeNull();
  });
});
