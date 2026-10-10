/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import { collaborationModule } from '../collaboration/collaboration-module.ts';

function stubSession(): EditorCollaborationSession {
  return {
    documentId: 'stub',
    sessionId: 'stub-session',
    identity: { actorId: 'stub', name: 'Stub' },
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
    participants: () => [],
    subscribeParticipants: () => () => {},
    remoteSelections: () => [],
    subscribeRemoteSelections: () => () => {},
    flushPendingJournals: () => {},
    destroy: () => {},
  };
}

describe('collaborationModule', () => {
  test('returns a data object with no lifecycle methods', () => {
    const session = stubSession();
    const module = collaborationModule({ session });
    expect(module.id).toBe('collaboration');
    expect(module.collaboration?.session).toBe(session);
    expect('attach' in module).toBe(false);
    expect('destroy' in module).toBe(false);
  });

  test('the factory file does not import Yjs', () => {
    const source = readFileSync(
      join(import.meta.dir, '..', 'collaboration', 'collaboration-module.ts'),
      'utf8'
    );
    expect(source).not.toContain("from 'yjs'");
    expect(source).not.toContain('y-webrtc');
  });
});
