/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// setIdentity: a live display-identity update republishes presence at once, revalidates with
// the construction rules, and never touches actorId or role.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import type { CollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../document-session.ts';
import { CollaborationSchemaError } from '../schema.ts';

const DOCUMENT_ID = 'identity-room';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function documentBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    ),
  });
}

interface Peer {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: DocumentCollaborationHandle;
  readonly port: CollaborationDocumentPort;
  readonly detach: () => void;
}

const opened: Peer[] = [];

afterEach(() => {
  for (const peer of opened.splice(0)) {
    peer.detach();
    peer.room.destroy();
    peer.awareness.destroy();
    peer.ydoc.destroy();
  }
});

function attachPeer(ydoc: Y.Doc, awareness: Awareness, room: DocumentCollaborationHandle): Peer {
  const loaded = readOoxmlPackage(room.document);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const port = createCollaborationDocumentPort(store, { documentId: DOCUMENT_ID });
  const detach = room.session.attach(port);
  const peer: Peer = { ydoc, awareness, room, port, detach };
  opened.push(peer);
  return peer;
}

async function createPeer(name: string): Promise<Peer> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: name, name, color: '#112233' },
    bootstrap: { kind: 'create', document: documentBytes() },
  });
  return attachPeer(ydoc, awareness, room);
}

async function joinPeer(host: Peer, name: string): Promise<Peer> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc), 'join');
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: name, name },
    bootstrap: { kind: 'join', timeoutMs: 5_000 },
  });
  return attachPeer(ydoc, awareness, room);
}

function syncAwareness(from: Peer, to: Peer): void {
  applyAwarenessUpdate(
    to.awareness,
    encodeAwarenessUpdate(from.awareness, [from.awareness.clientID]),
    'test-provider'
  );
}

describe('document session setIdentity', () => {
  test('a peer observes the new name and color in participants and selection labels', async () => {
    const alice = await createPeer('alice');
    const bob = await joinPeer(alice, 'bob');
    const paragraph = alice.port.paragraphs()[0]!;
    alice.room.session.setLocalSelection({
      anchor: { paragraphId: paragraph.paragraphId, offset: 0 },
      head: { paragraphId: paragraph.paragraphId, offset: 2 },
    });

    alice.room.session.setIdentity({ name: 'Alice Prime', color: '#ff8800' });
    expect(alice.room.session.identity).toMatchObject({
      actorId: 'alice',
      name: 'Alice Prime',
      color: '#ff8800',
      role: 'human',
    });

    syncAwareness(alice, bob);
    const remoteAlice = bob.room.session
      .participants()
      .find((participant) => participant.actorId === 'alice');
    expect(remoteAlice).toMatchObject({ name: 'Alice Prime', color: '#ff8800' });
    // The selection published before the rename keeps travelling under the new label.
    expect(bob.room.session.remoteSelections()).toMatchObject([
      { actorId: 'alice', name: 'Alice Prime', color: '#ff8800' },
    ]);
  });

  test('revalidates with the construction rules and drops unsafe colors', async () => {
    const alice = await createPeer('alice');
    expect(() => alice.room.session.setIdentity({ name: '   ' })).toThrow(CollaborationSchemaError);
    expect(() => alice.room.session.setIdentity({ color: 'x'.repeat(65) })).toThrow(
      CollaborationSchemaError
    );
    // Unsafe but length-valid colors degrade to no color instead of throwing.
    alice.room.session.setIdentity({ color: 'url(//attacker.example/t)' });
    expect(alice.room.session.identity.color).toBeUndefined();
    // A failed update leaves the previous identity in place.
    expect(alice.room.session.identity.name).toBe('alice');
  });

  test('actorId and role stay immutable through an update', async () => {
    const alice = await createPeer('alice');
    alice.room.session.setIdentity({
      name: 'Renamed',
      // Extra runtime properties are ignored, never applied.
      ...({ actorId: 'mallory', role: 'agent' } as object),
    });
    expect(alice.room.session.identity.actorId).toBe('alice');
    expect(alice.room.session.identity.role).toBe('human');
    expect(alice.room.session.identity.name).toBe('Renamed');
  });
});
