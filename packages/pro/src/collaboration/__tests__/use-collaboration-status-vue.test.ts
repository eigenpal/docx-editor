/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/* eslint-disable react-hooks/rules-of-hooks -- Vue `setup`, not a React component. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createCollaborationStatusTracker } from '@docx-editor.dev/core/collaboration';
import type {
  CollaborationFailureCode,
  CollaborationStatus,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import { useCollaborationStatus } from '../../vue/useCollaborationStatus.ts';
import { DocxEditorCollaboration } from '../../vue/DocxEditorCollaboration.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

function controllableSession(): EditorCollaborationSession & {
  failThenRecover(code: CollaborationFailureCode): void;
  diverge(code: CollaborationFailureCode): void;
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
    diverge(code: CollaborationFailureCode) {
      statusState.set('error', code);
      emit();
    },
  };
}

describe('useCollaborationStatus (Vue)', () => {
  test('a recovered failure stays readable, including for a host that mounts later', async () => {
    const session = controllableSession();
    session.failThenRecover('document-id-mismatch');
    const host = document.createElement('div');
    document.body.append(host);
    const Probe = defineComponent({
      setup() {
        const snapshot = useCollaborationStatus(session);
        return () =>
          h('div', {
            'data-status': snapshot.status.value,
            'data-reason': snapshot.reason.value?.code ?? '',
            'data-last': snapshot.lastFailure.value?.code ?? '',
          });
      },
    });
    const app = createApp(Probe);
    app.mount(host);
    await nextTick();
    const node = host.querySelector('div')!;
    expect(node.getAttribute('data-status')).toBe('ready');
    expect(node.getAttribute('data-reason')).toBe('');
    expect(node.getAttribute('data-last')).toBe('document-id-mismatch');
    app.unmount();
  });
});

describe('DocxEditorCollaboration.Status (Vue)', () => {
  test('a refused edit and an out-of-sync copy each show, with a rejoin action', async () => {
    const session = controllableSession();
    let rejoined = 0;
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(() =>
      h(DocxEditorCollaboration.Status, { session, onRejoin: () => (rejoined += 1) })
    );
    app.mount(host);
    await nextTick();
    expect(host.querySelector('[data-collaboration-status]')).toBeNull();
    session.failThenRecover('unknown-logical-id');
    await nextTick();
    expect(host.querySelector('[data-collaboration-status="editRefused"]')).not.toBeNull();
    session.diverge('remote-apply-failed');
    await nextTick();
    const button = host.querySelector<HTMLButtonElement>(
      '[data-collaboration-status="outOfSync"] button'
    );
    expect(button?.textContent).toBe('Rejoin');
    button!.click();
    expect(rejoined).toBe(1);
    app.unmount();
  });
});
