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
  paraIdOf,
  readOoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration';
import type {
  CanonicalPrimitiveJournal,
  CollaborationDocumentPort,
  CollaborationLocalSelection,
} from '@docx-editor.dev/core/collaboration';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../document-session.ts';

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
  readonly room: DocumentCollaborationHandle;
  readonly store: TreePackageStore;
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

function attachPeer(ydoc: Y.Doc, awareness: Awareness, room: DocumentCollaborationHandle): Peer {
  const store = storeFrom(room.document);
  const port = createCollaborationDocumentPort(store, { documentId: DOCUMENT_ID });
  const detach = room.session.attach(port);
  const peer: Peer = { ydoc, awareness, room, store, port, detach };
  opened.push(peer);
  return peer;
}

async function createPeer(name: string, bytes: Uint8Array = PROSE): Promise<Peer> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: name, name },
    bootstrap: { kind: 'create', document: bytes },
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

function syncDocument(from: Peer, to: Peer): void {
  Y.applyUpdate(to.ydoc, Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc)), 'relay');
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

  // Awareness leaves the author on the keystroke; the document publication is deliberately
  // batched off it. So a burst puts the receiver in the window where the caret it is told
  // about is past the end of the text it holds. It must not settle there: once the document
  // lands, the painted caret has to name the position the author is actually at.
  test('a typing burst leaves the remote caret where the author is', async () => {
    const alice = await createPeer('alice');
    const bob = await joinPeer(alice, 'bob');
    const first = alice.port.paragraphs()[0]!;
    const digits = '12345678123456765432';
    let offset = first.text.length;
    const painted: number[] = [];
    for (let index = 0; index < digits.length; index += 1) {
      const committed = alice.store.transact({ kind: 'body' }, (context) => {
        context.apply({
          op: 'insertText',
          paragraphId: first.nodeId,
          offset,
          text: digits[index]!,
        });
      });
      if (!committed.ok) throw new Error(committed.detail ?? committed.reason);
      offset += 1;
      alice.room.session.setLocalSelection(
        range(
          { paragraphId: first.paragraphId, offset },
          { paragraphId: first.paragraphId, offset }
        )
      );
      syncAwareness(alice, bob);
      // The batched publication catches up every fourth keystroke, as deferral does.
      if ((index + 1) % 4 === 0) {
        alice.port.flushPendingJournals();
        syncDocument(alice, bob);
      }
      const remote = bob.room.session.remoteSelections()[0];
      const held = bob.port.paragraphByStableId(first.paragraphId)?.text.length ?? 0;
      // Never a position this replica cannot hold, and never behind one it already painted.
      expect(remote?.head.offset).toBeLessThanOrEqual(held);
      painted.push(remote?.head.offset ?? -1);
    }
    alice.port.flushPendingJournals();
    syncDocument(alice, bob);
    expect(painted).toEqual([...painted].sort((left, right) => left - right));
    expect(bob.port.paragraphByStableId(first.paragraphId)?.text).toBe(`${first.text}${digits}`);
    expect(bob.room.session.remoteSelections()[0]?.head.offset).toBe(offset);
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

  test('a header selection replicates', async () => {
    const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:w14="${W14}"><w:body>` +
          '<w:p w14:paraId="11111111" w14:textId="11111111"><w:r><w:t>Body</w:t></w:r></w:p>' +
          '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr></w:body></w:document>'
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}" xmlns:w14="${W14}">` +
          '<w:p w14:paraId="12345678" w14:textId="12345678"><w:r><w:t>Letterhead</w:t></w:r></w:p></w:hdr>'
      ),
    });
    const alice = await createPeer('alice', bytes);
    const bob = await joinPeer(alice, 'bob');
    expect(alice.port.paragraphs().some((paragraph) => paragraph.paragraphId === '12345678')).toBe(
      false
    );
    alice.room.session.setLocalSelection(
      range({ paragraphId: '12345678', offset: 0 }, { paragraphId: '12345678', offset: 4 })
    );
    syncAwareness(alice, bob);
    expect(bob.room.session.remoteSelections()).toMatchObject([
      {
        actorId: 'alice',
        anchor: { paragraphId: '12345678', offset: 0 },
        head: { paragraphId: '12345678', offset: 4 },
      },
    ]);
  });

  test('a header without authored paraIds still replicates', async () => {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
          '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr></w:body></w:document>'
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Letterhead</w:t></w:r></w:p></w:hdr>`
      ),
    });
    const alice = await createPeer('alice', bytes);
    const bob = await joinPeer(alice, 'bob');
    const loaded = readOoxmlPackage(alice.port.save());
    if (!loaded.ok) throw new Error(loaded.reason);
    const headerPart = [...loaded.package.parts.values()].find(
      (part) => part.root.localName === 'hdr'
    );
    if (!headerPart) throw new Error('missing header');
    const identified = normalizeParagraphIdentity(headerPart);
    const paragraph = identified.root.children.find((node) => node.kind !== 'textValue');
    const minted = paragraph && paragraph.kind !== 'textValue' ? paraIdOf(paragraph) : null;
    expect(minted).toMatch(/^[0-9A-Fa-f]{8}$/);
    const paragraphId = minted!.toUpperCase();
    alice.room.session.setLocalSelection(
      range({ paragraphId, offset: 0 }, { paragraphId, offset: 4 })
    );
    syncAwareness(alice, bob);
    expect(bob.room.session.remoteSelections()).toMatchObject([
      {
        actorId: 'alice',
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 4 },
      },
    ]);
  });

  test('a cell rectangle stays two endpoints plus a kind', async () => {
    const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
    const cell = (id: string, text: string): string =>
      `<w:tc><w:p w14:paraId="${id}" w14:textId="${id}"><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const tableBytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
          `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
          `<w:tr>${cell('11111111', 'A1')}${cell('22222222', 'B1')}</w:tr>` +
          `<w:tr>${cell('33333333', 'A2')}${cell('44444444', 'B2')}</w:tr></w:tbl>` +
          '<w:sectPr/></w:body></w:document>'
      ),
    });
    const alice = await createPeer('alice', tableBytes);
    const bob = await joinPeer(alice, 'bob');
    alice.room.session.setLocalSelection({
      anchor: { paragraphId: '11111111', offset: 0 },
      head: { paragraphId: '44444444', offset: 2 },
      kind: 'cells',
    });
    const published = (alice.awareness.getLocalState() as Record<string, unknown> | null)?.[
      'docxEditor'
    ] as { selection?: { kind?: string } };
    expect(published.selection?.kind).toBe('cells');
    expect(JSON.stringify(published.selection)).not.toContain('22222222');
    expect(JSON.stringify(published.selection)).not.toContain('33333333');
    syncAwareness(alice, bob);
    expect(bob.room.session.remoteSelections()).toMatchObject([
      {
        actorId: 'alice',
        kind: 'cells',
        anchor: { paragraphId: '11111111', offset: 0 },
        head: { paragraphId: '44444444', offset: 2 },
      },
    ]);
  });
});
