/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Offline editing: a session created with `offlineEditing` keeps admitting local edits while
// the transport is `disconnected`, and the buffered updates merge on reconnect like any
// concurrent online edit. The default stays refuse-while-disconnected.

import { afterEach, describe, expect, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness } from './document-peer-support.ts';
import { collaborationDocx } from './support.ts';

const proseBytes = (): Uint8Array => collaborationDocx();

const offlineHarness = createPeerHarness('offline-editing', { offlineEditing: true });
const defaultHarness = createPeerHarness('offline-editing-default');

afterEach(() => {
  offlineHarness.cleanup();
  defaultHarness.cleanup();
});

function insertTextOp(paragraphId: string, offset: number, text: string): TreeDocOp {
  return { op: 'insertText', paragraphId, offset, text };
}

describe('offline editing', () => {
  test('a disconnected replica keeps editing and converges on reconnect', async () => {
    const { alice, bob, pause, resume } = await offlineHarness.pair(proseBytes());

    pause();
    alice.room.session.setTransportStatus('disconnected', 'test-drop');
    expect(alice.room.session.statusSnapshot().status).toBe('disconnected');

    // Both sides type while the wire is down: alice offline, bob still 'ready'.
    offlineHarness.apply(alice, [
      insertTextOp(offlineHarness.paragraphIdAt(alice, 0), 0, 'offline '),
    ]);
    offlineHarness.apply(bob, [insertTextOp(offlineHarness.paragraphIdAt(bob, 1), 0, 'online ')]);

    alice.room.session.setTransportStatus('ready');
    resume();

    offlineHarness.expectConverged(alice, bob);
  });

  test('undo still works for edits made while disconnected', async () => {
    const { alice, bob, pause, resume } = await offlineHarness.pair(proseBytes());
    pause();
    alice.room.session.setTransportStatus('disconnected', 'test-drop');
    offlineHarness.apply(alice, [
      insertTextOp(offlineHarness.paragraphIdAt(alice, 0), 0, 'undo-me '),
    ]);
    expect(alice.room.session.canUndo()).toBe(true);
    expect(alice.room.session.undo()).toBe(true);
    alice.room.session.setTransportStatus('ready');
    resume();
    offlineHarness.expectConverged(alice, bob);
  });

  test('error and destroyed stay refused with offline editing on', async () => {
    const { alice } = await offlineHarness.pair(proseBytes());
    alice.room.session.setTransportStatus('error', 'test-terminal');
    expect(
      alice.room.session.gateOperations(
        [insertTextOp(offlineHarness.paragraphIdAt(alice, 0), 0, 'x')],
        { kind: 'body' }
      )
    ).toBe('collaboration-session-not-ready');
  });

  test('the default still refuses edits while disconnected', async () => {
    const { alice } = await defaultHarness.pair(proseBytes());
    alice.room.session.setTransportStatus('disconnected', 'test-drop');
    expect(
      alice.room.session.gateOperations(
        [insertTextOp(defaultHarness.paragraphIdAt(alice, 0), 0, 'x')],
        { kind: 'body' }
      )
    ).toBe('collaboration-session-not-ready');
  });
});
