/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationDocx, storeAndPort } from './support.ts';

const DOCUMENT_ID = 'attach-soft-fail-room';
const BODY = { kind: 'body' as const };

const opened: Array<{
  ydoc: Y.Doc;
  awareness: Awareness;
  destroyRoom: () => void;
}> = [];

afterEach(() => {
  for (const peer of opened.splice(0)) {
    peer.destroyRoom();
    peer.awareness.destroy();
    peer.ydoc.destroy();
  }
});

async function openRoom() {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: collaborationDocx() },
  });
  opened.push({ ydoc, awareness, destroyRoom: () => room.destroy() });
  return room;
}

describe('document session attach', () => {
  test('attach after destroy returns without throwing and reports destroyed', async () => {
    const room = await openRoom();
    const { port } = storeAndPort(room.document, DOCUMENT_ID);
    room.destroy();
    expect(room.session.status()).toBe('destroyed');
    let detach: (() => void) | undefined;
    expect(() => {
      detach = room.session.attach(port);
    }).not.toThrow();
    expect(room.session.status()).toBe('destroyed');
    expect(room.session.gateOperations([], BODY)).toBe('collaboration-session-destroyed');
    expect(() => detach?.()).not.toThrow();
  });

  test('re-attaching the same port stays ready, because a remount produces exactly that', async () => {
    const room = await openRoom();
    const { port } = storeAndPort(room.document, DOCUMENT_ID);
    const detach = room.session.attach(port);
    expect(() => room.session.attach(port)).not.toThrow();
    expect(room.session.status()).toBe('ready');
    detach();
  });

  test('a second port while one is live reports error rather than never replicating', async () => {
    const room = await openRoom();
    const { port } = storeAndPort(room.document, DOCUMENT_ID);
    const second = storeAndPort(room.document, DOCUMENT_ID);
    const detach = room.session.attach(port);

    // This session observes ONE journal. The second port's edits would go nowhere, so a `ready`
    // status here would tell that surface it is collaborating while it silently is not.
    expect(() => room.session.attach(second.port)).not.toThrow();
    expect(room.session.status()).toBe('error');
    detach();
  });

  test('a document id mismatch degrades to error instead of throwing', async () => {
    const room = await openRoom();
    const { port } = storeAndPort(room.document, 'other-room');
    expect(() => room.session.attach(port)).not.toThrow();
    expect(room.session.status()).toBe('error');
    expect(room.session.gateOperations([], BODY)).toBe('collaboration-session-not-ready');
  });
});
