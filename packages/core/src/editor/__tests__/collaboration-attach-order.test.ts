// A replica may only be attached to a surface that is finished being built.
//
// `attach` publishes shared state through the store synchronously, and that publish reaches the
// store subscriber the surface registers during mount. When attach ran in the middle of mount,
// that subscriber read bindings the rest of the function had not declared yet and threw a
// temporal-dead-zone `ReferenceError`. Every session came up in `error`, the room never left
// "Reconnecting", and nothing replicated. The stub session other suites use returns a no-op
// from `attach`, so no test noticed; this one publishes, the way the real session does.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import type {
  CollaborationDocumentPort,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx, paragraph } from './paginated-surface-fixtures.ts';

const opened: { surface: PaginatedSurface; container: HTMLElement }[] = [];

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

/** A session that publishes a package on attach, which is what the Yjs session does. */
function publishingSession(
  bytes: Uint8Array,
  record: (event: string) => void
): EditorCollaborationSession {
  return {
    documentId: 'attach-order',
    sessionId: 'attach-order-session',
    identity: { actorId: 'local', name: 'Local' },
    status: () => 'ready',
    subscribeStatus: () => () => {},
    attach: (port: CollaborationDocumentPort) => {
      const loaded = readOoxmlPackage(bytes);
      if (!loaded.ok) throw new Error(loaded.reason);
      const result = port.applyRemotePackage(loaded.package, {
        origin: 'test-remote',
        actorId: 'remote',
        operationId: 'attach-order-1',
      });
      record(result.ok ? 'published' : `refused:${result.reason}`);
      return () => record('detached');
    },
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

describe('attaching a replica to a paginated surface', () => {
  test('a package published during attach reaches the store', () => {
    const events: string[] = [];
    const container = document.createElement('div');
    const body = paragraph('Alpha') + paragraph('Bravo');
    const result = mountPaginatedSurface(container, docx(body), {
      scale: 1,
      collaborationModel: {
        session: publishingSession(docx(paragraph('Replaced')), (event) => events.push(event)),
      },
    });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
    opened.push({ surface: result.surface, container });

    // Before the fix, mount threw out of `attach` and never reached this line. A published
    // result also means the store transaction committed and the mount-time subscriber ran.
    expect(events).toEqual(['published']);
    expect(container.querySelectorAll('[data-paragraph-id]').length).toBeGreaterThan(0);
  });

  test('detach runs when the surface is destroyed', () => {
    const events: string[] = [];
    const container = document.createElement('div');
    const result = mountPaginatedSurface(container, docx(paragraph('Alpha')), {
      scale: 1,
      collaborationModel: {
        session: publishingSession(docx(paragraph('Remote')), (event) => events.push(event)),
      },
    });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
    result.surface.destroy();
    container.remove();

    expect(events).toEqual(['published', 'detached']);
  });
});
