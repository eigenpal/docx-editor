/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Full-document presence: cross-paragraph awareness, old-shape tolerance, and
// the rule that a selection never enters the canonical tree.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration';
import type {
  CanonicalPrimitiveJournal,
  CollaborationDocumentPort,
  CollaborationLocalSelection,
} from '@docx-editor.dev/core/collaboration';
import { createDocumentCollaboration } from '../document-session.ts';
import type { YjsCollaborationRoom } from '../session.ts';

const DOCUMENT_ID = 'presence-room';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function documentBytes(body: string): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const PROSE = documentBytes(
  [paragraph('Alpha'), paragraph('Bravo'), paragraph('Charlie'), paragraph('Delta')].join('')
);

interface Peer {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: YjsCollaborationRoom;
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

function storeFrom(bytes: Uint8Array): TreePackageStore {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('no main part');
  return new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
}

function attachPeer(ydoc: Y.Doc, awareness: Awareness, room: YjsCollaborationRoom): Peer {
  const store = storeFrom(room.document);
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
    identity: { actorId: name, name },
    bootstrap: { kind: 'create', document: PROSE },
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

function range(
  start: { paragraphId: string; offset: number },
  end: { paragraphId: string; offset: number }
): CollaborationLocalSelection {
  return { anchor: start, head: end };
}

describe('full-document presence selection', () => {
  test('a two-paragraph selection replicates', async () => {
    const alice = await createPeer('alice');
    const bob = await joinPeer(alice, 'bob');
    const [first, second] = alice.port.paragraphs();
    alice.room.session.setLocalSelection(
      range(
        { paragraphId: first!.paragraphId, offset: 1 },
        { paragraphId: second!.paragraphId, offset: 3 }
      )
    );
    syncAwareness(alice, bob);
    expect(bob.room.session.remoteSelections()).toMatchObject([
      {
        actorId: 'alice',
        anchor: { paragraphId: first!.paragraphId, nodeId: first!.nodeId, offset: 1 },
        head: { paragraphId: second!.paragraphId, nodeId: second!.nodeId, offset: 3 },
      },
    ]);
  });

  test('a many-paragraph selection stays two addresses', async () => {
    const alice = await createPeer('alice');
    const bob = await joinPeer(alice, 'bob');
    const paragraphs = alice.port.paragraphs();
    expect(paragraphs.length).toBeGreaterThanOrEqual(4);
    const first = paragraphs[0]!;
    const last = paragraphs[3]!;
    alice.room.session.setLocalSelection(
      range(
        { paragraphId: first.paragraphId, offset: 0 },
        { paragraphId: last.paragraphId, offset: 5 }
      )
    );
    const published = (alice.awareness.getLocalState() as Record<string, unknown> | null)?.[
      'docxEditor'
    ] as { selection?: unknown };
    expect(JSON.stringify(published.selection)).not.toContain(paragraphs[1]!.paragraphId);
    expect(JSON.stringify(published.selection)).not.toContain(paragraphs[2]!.paragraphId);
    syncAwareness(alice, bob);
    expect(bob.room.session.remoteSelections()).toMatchObject([
      {
        actorId: 'alice',
        anchor: { paragraphId: first.paragraphId, offset: 0 },
        head: { paragraphId: last.paragraphId, offset: 5 },
      },
    ]);
    expect(bob.room.session.remoteSelections()).toHaveLength(1);
  });

  test('a backwards selection keeps both addresses', async () => {
    const alice = await createPeer('alice');
    const bob = await joinPeer(alice, 'bob');
    const [first, second] = alice.port.paragraphs();
    alice.room.session.setLocalSelection(
      range(
        { paragraphId: second!.paragraphId, offset: 4 },
        { paragraphId: first!.paragraphId, offset: 1 }
      )
    );
    syncAwareness(alice, bob);
    expect(bob.room.session.remoteSelections()).toMatchObject([
      {
        actorId: 'alice',
        anchor: { paragraphId: second!.paragraphId, offset: 4 },
        head: { paragraphId: first!.paragraphId, offset: 1 },
      },
    ]);
  });

  test('an unresolvable address drops the selection quietly', async () => {
    const alice = await createPeer('alice');
    const bob = await joinPeer(alice, 'bob');
    const first = alice.port.paragraphs()[0]!;
    alice.room.session.setLocalSelection(
      range({ paragraphId: first.paragraphId, offset: 0 }, { paragraphId: 'DEADBEEF', offset: 1 })
    );
    expect(() => syncAwareness(alice, bob)).not.toThrow();
    expect(bob.room.session.remoteSelections()).toEqual([]);
  });

  test('the old single-paragraph payload still paints that range', async () => {
    const alice = await createPeer('alice');
    const bob = await joinPeer(alice, 'bob');
    const first = alice.port.paragraphs()[0]!;
    alice.awareness.setLocalStateField('docxEditor', {
      actorId: 'alice',
      name: 'alice',
      role: 'human',
      selection: { paragraphId: first.paragraphId, start: 1, end: 4 },
    });
    expect(() => syncAwareness(alice, bob)).not.toThrow();
    expect(bob.room.session.remoteSelections()).toMatchObject([
      {
        actorId: 'alice',
        anchor: { paragraphId: first.paragraphId, nodeId: first.nodeId, offset: 1 },
        head: { paragraphId: first.paragraphId, nodeId: first.nodeId, offset: 4 },
      },
    ]);
  });

  test('presence does not emit a journal or a revision', async () => {
    const alice = await createPeer('alice');
    const bob = await joinPeer(alice, 'bob');
    const journals: CanonicalPrimitiveJournal[] = [];
    alice.port.observePrimitiveJournal((journal) => journals.push(journal));
    bob.port.observePrimitiveJournal((journal) => journals.push(journal));
    const beforeAlice = alice.port.revision();
    const beforeBob = bob.port.revision();
    const [first, second] = alice.port.paragraphs();
    alice.room.session.setLocalSelection(
      range(
        { paragraphId: first!.paragraphId, offset: 0 },
        { paragraphId: second!.paragraphId, offset: 2 }
      )
    );
    syncAwareness(alice, bob);
    expect(journals).toEqual([]);
    expect(alice.port.revision()).toBe(beforeAlice);
    expect(bob.port.revision()).toBe(beforeBob);
    expect(alice.room.session.canUndo()).toBe(false);
  });
});
