/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Status is one axis and it must not lie. A refusal realign repairs the DOCUMENT, so recovery
// restores the status the replica held before it — a refusal that arrived while the transport
// was down must not report `ready`. And a status that refuses edits refuses undo too: undo
// writes shared state exactly as a keystroke does.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  createCollaborationDocumentPort,
  type CanonicalPrimitiveJournal,
  type CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../document-session.ts';
import { collaborationDocx } from './support.ts';

const DOCUMENT_ID = 'session-status-room';
const BODY: StoryScope = { kind: 'body' };

interface Peer {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: DocumentCollaborationHandle;
  readonly store: TreePackageStore;
  readonly port: CollaborationDocumentPort;
  readonly emitJournal: (journal: CanonicalPrimitiveJournal) => void;
}

const opened: Peer[] = [];

afterEach(() => {
  for (const peer of opened.splice(0)) {
    peer.room.destroy();
    peer.awareness.destroy();
    peer.ydoc.destroy();
  }
});

async function createPeer(options?: { readonly offlineEditing?: boolean }): Promise<Peer> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: collaborationDocx() },
    ...options,
  });
  const loaded = readOoxmlPackage(room.document);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('no main part');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const base = createCollaborationDocumentPort(store, { documentId: DOCUMENT_ID });
  // The session's contract is that journals arrive through `observePrimitiveJournal`, so the
  // tap records the listener the session registers instead of adding a test-only port method.
  let tap: ((journal: CanonicalPrimitiveJournal) => void) | null = null;
  const port: CollaborationDocumentPort = {
    ...base,
    observePrimitiveJournal: (listener) => {
      tap = listener;
      return base.observePrimitiveJournal(listener);
    },
  };
  room.session.attach(port);
  const peer: Peer = {
    ydoc,
    awareness,
    room,
    store,
    port,
    emitJournal: (journal) => {
      if (!tap) throw new Error('port is not tapped');
      tap(journal);
    },
  };
  opened.push(peer);
  return peer;
}

/** A journal naming a node shared state does not hold is refused whatever the state. */
function refuse(peer: Peer): void {
  peer.emitJournal({
    effects: [
      { kind: 'spliceText', logicalId: 'no-such-node', utf16Start: 0, deleteCount: 0, insert: 'X' },
    ],
  });
}

function firstParagraphId(peer: Peer): string {
  const paragraph = peer.port.paragraphs()[0];
  if (!paragraph) throw new Error('no paragraph');
  return paragraph.nodeId;
}

function type(peer: Peer, text: string): void {
  const ops: readonly TreeDocOp[] = [
    { op: 'insertText', paragraphId: firstParagraphId(peer), offset: 0, text },
  ];
  const refusal = peer.room.session.gateOperations(ops, BODY);
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  const result = peer.store.transact(BODY, (context) => {
    for (const op of ops) context.apply(op);
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

describe('refusal recovery restores the prior status', () => {
  test('a refusal while ready recovers to ready', async () => {
    const peer = await createPeer();
    refuse(peer);
    await Promise.resolve();
    expect(peer.room.session.status()).toBe('ready');
    expect(peer.room.session.statusSnapshot().reason).toBeUndefined();
    expect(peer.room.session.statusSnapshot().lastFailure?.code).toBe('unknown-logical-id');
  });

  test('a refusal while disconnected recovers to disconnected, not ready', async () => {
    const peer = await createPeer({ offlineEditing: true });
    peer.room.session.setTransportStatus('disconnected', 'transport-disconnected', 'wire down');
    refuse(peer);
    await Promise.resolve();
    // The realign repaired the document; the transport is still down and only the provider
    // may say otherwise.
    const snapshot = peer.room.session.statusSnapshot();
    expect(snapshot.status).toBe('disconnected');
    expect(snapshot.reason?.code).toBe('transport-disconnected');
    expect(snapshot.reason?.detail).toBe('wire down');
    expect(snapshot.lastFailure?.code).toBe('unknown-logical-id');
  });
});

describe('undo obeys the operation gate', () => {
  test('an errored session refuses undo', async () => {
    const peer = await createPeer();
    type(peer, 'undo me ');
    expect(peer.room.session.canUndo()).toBe(true);
    // Three refusals in separate flush tasks take the session to terminal `error`.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      refuse(peer);
      await Promise.resolve();
    }
    expect(peer.room.session.status()).toBe('error');
    const before = Y.encodeStateAsUpdate(peer.ydoc);
    expect(peer.room.session.canUndo()).toBe(false);
    expect(peer.room.session.undo()).toBe(false);
    expect(peer.room.session.canRedo()).toBe(false);
    expect(peer.room.session.redo()).toBe(false);
    // The diverged replica wrote nothing to the room.
    expect(Y.encodeStateAsUpdate(peer.ydoc)).toEqual(before);
  });

  test('a disconnected session without offline editing refuses undo until reconnect', async () => {
    const peer = await createPeer();
    type(peer, 'undo me ');
    peer.room.session.setTransportStatus('disconnected', 'transport-disconnected', 'wire down');
    expect(peer.room.session.canUndo()).toBe(false);
    expect(peer.room.session.undo()).toBe(false);
    peer.room.session.setTransportStatus('ready');
    expect(peer.room.session.canUndo()).toBe(true);
    expect(peer.room.session.undo()).toBe(true);
  });

  test('offline editing keeps undo available while disconnected', async () => {
    const peer = await createPeer({ offlineEditing: true });
    type(peer, 'undo me ');
    peer.room.session.setTransportStatus('disconnected', 'transport-disconnected', 'wire down');
    expect(peer.room.session.canUndo()).toBe(true);
    expect(peer.room.session.undo()).toBe(true);
  });
});
