// Remote presence overlay paints every line of a multi-paragraph selection.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import type {
  CollaborationRemoteSelection,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx, paragraph } from './paginated-surface-fixtures.ts';

const opened: { surface: PaginatedSurface; container: HTMLElement }[] = [];

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  for (const item of opened.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

function stubSession(remotes: () => readonly CollaborationRemoteSelection[]): {
  readonly session: EditorCollaborationSession;
  readonly notify: () => void;
} {
  const listeners = new Set<(selections: readonly CollaborationRemoteSelection[]) => void>();
  const notify = (): void => {
    const next = remotes();
    for (const listener of listeners) listener(next);
  };
  return {
    notify,
    session: {
      documentId: 'overlay-test',
      sessionId: 'overlay-session',
      identity: { actorId: 'local', name: 'Local' },
      status: () => 'ready',
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
      remoteSelections: remotes,
      subscribeRemoteSelections: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      flushPendingJournals: () => {},
      destroy: () => {},
    },
  };
}

function mountBody(body: string, remotes: () => readonly CollaborationRemoteSelection[]) {
  const container = document.createElement('div');
  const { session, notify } = stubSession(remotes);
  const result = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    collaborationModel: { session },
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  opened.push({ surface: result.surface, container });
  return { surface: result.surface, container, notify };
}

const THREE = paragraph('aaaa') + paragraph('bbbb') + paragraph('cccc');

describe('remote selection overlay', () => {
  test('a multi-paragraph remote selection paints one span per covered line', () => {
    let remotes: CollaborationRemoteSelection[] = [];
    const { surface, container, notify } = mountBody(THREE, () => remotes);
    const ids = surface.session.paragraphIds();
    expect(ids).toHaveLength(3);
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        color: 'var(--doc-accent)',
        anchor: { paragraphId: 'AAAAAAAA', nodeId: ids[0]!, offset: 1 },
        head: { paragraphId: 'CCCCCCCC', nodeId: ids[2]!, offset: 2 },
      },
    ];
    notify();
    const overlay = container.querySelector('.docx-remote-selection-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute('contenteditable')).toBe('false');
    expect(container.querySelector('.docx-pages')?.contains(overlay)).toBe(false);
    expect(container.querySelectorAll('.docx-remote-selection-rect')).toHaveLength(3);
    expect(container.querySelector('.docx-remote-caret-label')?.textContent).toBe('Bob');
  });

  test('a backwards multi-paragraph selection paints the same span count', () => {
    let remotes: CollaborationRemoteSelection[] = [];
    const { surface, container, notify } = mountBody(THREE, () => remotes);
    const ids = surface.session.paragraphIds();
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        anchor: { paragraphId: 'AAAAAAAA', nodeId: ids[0]!, offset: 1 },
        head: { paragraphId: 'CCCCCCCC', nodeId: ids[2]!, offset: 2 },
      },
    ];
    notify();
    const forward = container.querySelectorAll('.docx-remote-selection-rect').length;
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        anchor: { paragraphId: 'CCCCCCCC', nodeId: ids[2]!, offset: 2 },
        head: { paragraphId: 'AAAAAAAA', nodeId: ids[0]!, offset: 1 },
      },
    ];
    notify();
    expect(container.querySelectorAll('.docx-remote-selection-rect').length).toBe(forward);
    expect(forward).toBe(3);
  });
});
