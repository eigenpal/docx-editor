/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A peer that joins a room restored from persisted state lists its tracked changes (#696).
//
// The first peer proposes a replacement, the room's state is encoded the way a server persists
// it, and every replica is destroyed. A fresh peer then joins a document restored from those
// bytes. Its review queue and its review rail must list the restored proposal before anyone
// edits again.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { act, cleanup, render } from '@testing-library/react';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../../react/index.ts';
import { collaborationModule, reviewModule } from '../../index';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support';

afterEach(() => {
  cleanup();
});

const DOCUMENT_ID = 'restored-review-items';
const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Pay within 7 days of receipt.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Signed</w:t></w:r></w:p>';

const revisions = (editor: DocxEditorInstance) =>
  editor
    .getReviewItems({ pairReplacements: false, placement: false })
    .filter((entry) => entry.item.kind === 'revision')
    .map((entry) => (entry.item.kind === 'revision' ? entry.item.revisionKind : ''));

async function joinRoom(ydoc: Y.Doc, name: string, bootstrap: 'create' | 'join') {
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: name, name },
    bootstrap:
      bootstrap === 'create'
        ? { kind: 'create', document: zipDocument(BODY) }
        : { kind: 'join', timeoutMs: 5_000 },
    offlineEditing: true,
  });
  return { room, awareness };
}

async function openPeer(ydoc: Y.Doc, name: string, bootstrap: 'create' | 'join') {
  const { room, awareness } = await joinRoom(ydoc, name, bootstrap);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({
    container,
    author: name,
    document: room.document,
    modules: [reviewModule(), collaborationModule({ session: room.session })],
  });
  return {
    room,
    editor,
    close() {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
}

/** The room as a server persists it once the first peer has proposed a replacement. */
async function persistedRoom(): Promise<Uint8Array> {
  const ydoc = new Y.Doc();
  const alice = await openPeer(ydoc, 'Alice', 'create');
  try {
    const runtime = DocxEditor.createBrowser(alice.editor, { author: 'Alice' });
    await runtime.run(async (context) => {
      const found = context.document.body.search('7 days');
      found.load('items');
      await context.sync();
      context.document.changeTrackingMode = 'TrackMineOnly';
      found.items[0]!.insertText('30 days', 'Replace');
      await context.sync();
    });
    runtime.dispose();
    alice.room.session.flushPendingJournals();
    expect(revisions(alice.editor)).toEqual(['delete', 'insert']);
    return Y.encodeStateAsUpdate(ydoc);
  } finally {
    alice.close();
  }
}

test('a peer joining a restored room lists the restored tracked changes at once', async () => {
  const persisted = await persistedRoom();
  const restored = new Y.Doc();
  Y.applyUpdate(restored, persisted, 'restore');
  const bob = await openPeer(restored, 'Bob', 'join');
  try {
    expect(revisions(bob.editor)).toEqual(['delete', 'insert']);
  } finally {
    bob.close();
  }
});

test('a peer whose restored state arrives after it joins lists the tracked changes', async () => {
  const persisted = await persistedRoom();
  const server = new Y.Doc();
  Y.applyUpdate(server, persisted, 'restore');
  const client = new Y.Doc();
  // The provider delivers the server's state while the join waits for it.
  setTimeout(() => Y.applyUpdate(client, Y.encodeStateAsUpdate(server), 'provider'), 0);
  const bob = await openPeer(client, 'Bob', 'join');
  try {
    expect(revisions(bob.editor)).toEqual(['delete', 'insert']);
  } finally {
    bob.close();
    server.destroy();
  }
});

test('the review rail of a peer joining a restored room shows the restored cards', async () => {
  const persisted = await persistedRoom();
  const restored = new Y.Doc();
  Y.applyUpdate(restored, persisted, 'restore');
  const { room, awareness } = await joinRoom(restored, 'Bob', 'join');
  try {
    const view = render(
      <DocxEditorRoot
        document={room.document}
        author="Bob"
        modules={[reviewModule(), collaborationModule({ session: room.session })]}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    // The same two cards the authoring peer shows: the struck words and the new ones.
    expect(view.getAllByTestId('review-card').map((card) => card.dataset.kind)).toEqual([
      'delete',
      'insert',
    ]);
  } finally {
    cleanup();
    room.destroy();
    awareness.destroy();
    restored.destroy();
  }
});
