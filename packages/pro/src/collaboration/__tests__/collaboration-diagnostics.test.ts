/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Collaboration diagnostics on two editors in one room: each reports its own status changes
// and the number of people, edits still converge, and no event names a person or the text.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import type { EditorDiagnostic } from '@docx-editor.dev/core';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const SECRET = 'Indemnification cap';

/** Presence travels both ways, as a provider would carry it. */
function relayPresence(left: Peer, right: Peer): void {
  const forward =
    (from: Peer, to: Peer) =>
    (change: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'relay') return;
      const changed = [...change.added, ...change.updated, ...change.removed];
      applyAwarenessUpdate(to.awareness, encodeAwarenessUpdate(from.awareness, changed), 'relay');
    };
  left.awareness.on('update', forward(left, right));
  right.awareness.on('update', forward(right, left));
  applyAwarenessUpdate(
    right.awareness,
    encodeAwarenessUpdate(left.awareness, [left.ydoc.clientID]),
    'relay'
  );
  applyAwarenessUpdate(
    left.awareness,
    encodeAwarenessUpdate(right.awareness, [right.ydoc.clientID]),
    'relay'
  );
}

const bodyXml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

test('two editors report status and people, converge, and leak nothing', async () => {
  const harness = createPeerHarness('collaboration-diagnostics', { offlineEditing: true });
  const editors: DocxEditorInstance[] = [];
  const mount = (peer: Peer, events: EditorDiagnostic[]) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [
        collaborationModule({ session: peer.room.session }),
        { id: 'observer', onDiagnostic: (event) => events.push(event) },
      ],
    });
    editors.push(editor);
    return editor;
  };
  try {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument(`<w:p><w:r><w:t>${SECRET}</w:t></w:r></w:p>`)
    );
    const left: EditorDiagnostic[] = [];
    const right: EditorDiagnostic[] = [];
    const leftEditor = mount(alice, left);
    const rightEditor = mount(bob, right);
    relayPresence(alice, bob);

    for (const events of [left, right]) {
      const [first] = events.filter((event) => event.kind === 'collab.status');
      expect(first).toMatchObject({ kind: 'collab.status', status: 'ready', previous: 'none' });
      // The session was ready before the editor attached, so the editor timed no wait.
      expect(first && 'connectMs' in first).toBe(false);
      const people = events.filter((event) => event.kind === 'collab.participants');
      expect(people.at(-1)).toMatchObject({ count: 2 });
    }

    // A dropped connection and a reconnect, as the provider reports them.
    pause();
    alice.room.session.setTransportStatus('disconnected', 'transport-disconnected');
    expect(leftEditor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    alice.room.session.setTransportStatus('ready');
    resume();
    const statuses = left
      .filter((event) => event.kind === 'collab.status')
      .map((event) => [event.status, 'code' in event ? event.code : undefined]);
    expect(statuses).toContainEqual(['disconnected', 'collab.transport-disconnected']);
    expect(statuses.at(-1)).toEqual(['ready', undefined]);

    // The offline edit reaches the other editor after the reconnect.
    expect(await bodyXml(rightEditor)).toBe(await bodyXml(leftEditor));
    expect(await bodyXml(rightEditor)).toContain('X');

    // A destroyed editor stops observing the session it shared.
    leftEditor.destroy();
    const before = left.length;
    alice.room.session.setTransportStatus('disconnected', 'transport-disconnected');
    expect(left).toHaveLength(before);

    const serialized = JSON.stringify([...left, ...right]);
    for (const secret of [SECRET, 'alice', 'bob', 'collaboration-diagnostics']) {
      expect(serialized).not.toContain(secret);
    }
  } finally {
    for (const editor of editors) editor.destroy();
    harness.cleanup();
  }
});

test('an editor that waits for the room reports how long it waited', async () => {
  const harness = createPeerHarness('collaboration-connect-time', { offlineEditing: true });
  const events: EditorDiagnostic[] = [];
  let editor: DocxEditorInstance | undefined;
  try {
    const { alice } = await harness.pair(zipDocument('<w:p><w:r><w:t>A</w:t></w:r></w:p>'));
    // The editor attaches its own port to the session.
    alice.detach();
    alice.room.session.setTransportStatus('disconnected', 'transport-disconnected');
    const container = document.createElement('div');
    document.body.append(container);
    editor = createDocxEditor({
      container,
      document: alice.room.document,
      modules: [
        collaborationModule({ session: alice.room.session }),
        { id: 'observer', onDiagnostic: (event) => events.push(event) },
      ],
    });
    alice.room.session.setTransportStatus('ready');
    alice.room.session.setTransportStatus('disconnected', 'transport-disconnected');
    alice.room.session.setTransportStatus('ready');

    const ready = events.filter(
      (event) => event.kind === 'collab.status' && event.status === 'ready'
    );
    expect(ready).toHaveLength(2);
    expect(ready[0] && 'connectMs' in ready[0] && typeof ready[0].connectMs).toBe('number');
    // A reconnect is not a first connect.
    expect(ready[1] && 'connectMs' in ready[1]).toBe(false);
  } finally {
    editor?.destroy();
    harness.cleanup();
  }
});
