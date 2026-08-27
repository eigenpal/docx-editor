/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Full-document collaboration through the real store, port, and session
// (full-document-yjs-collaboration tasks 4.13 and 4.14).
//
// Every case drives a production `TreeDocOp` on one peer and asserts the OTHER peer's
// canonical package matches, so a change class that does not replicate fails here.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  TreePackageStore,
  ensureHyperlinkRelationship,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  relsPartNameFor,
  runPropertyEdits,
  type OoxmlNode,
  type OoxmlPackage,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  createCollaborationDocumentPort,
  type CanonicalPrimitiveJournal,
  type CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../document-session.ts';
import { NODE_CHILDREN_FIELD, NODE_DELETED_FIELD, PACKAGE_NODES_KEY } from '../document/schema.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const DOCUMENT_ID = 'full-document-room';
const BODY: StoryScope = { kind: 'body' };
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
  [paragraph('Alpha'), paragraph('Bravo'), paragraph('Charlie')].join('')
);

const DATE = documentBytes(
  '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>Date: March 2 2026</w:t></w:r></w:p>'
);

const TWO_RUN_DATE = documentBytes(
  '<w:p>' +
    '<w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">Date: </w:t></w:r>' +
    '<w:r><w:rPr><w:color w:val="000000"/><w:sz w:val="22"/></w:rPr>' +
    '<w:t xml:space="preserve">March 2 2026</w:t></w:r>' +
    '</w:p>' +
    paragraph('Other')
);

const TABLE = documentBytes(
  paragraph('Before') +
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr/>' +
    paragraph('r1c1') +
    '</w:tc><w:tc><w:tcPr/>' +
    paragraph('r1c2') +
    '</w:tc></w:tr></w:tbl>' +
    paragraph('After')
);

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A document with one real footnote, so a note conversion has something to convert. */
function footnoteBytes(): Uint8Array {
  const notes =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0">' +
    '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>one</w:t></w:r></w:p>' +
    '</w:footnote>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>Hi</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${notes}</w:footnotes>`),
  });
}

interface Peer {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: DocumentCollaborationHandle;
  readonly store: TreePackageStore;
  readonly port: CollaborationDocumentPort;
  readonly detach: () => void;
}

const opened: Peer[] = [];
const relays: (() => void)[] = [];

afterEach(() => {
  for (const stop of relays.splice(0)) stop();
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

async function createPeer(
  bytes: Uint8Array,
  name: string,
  wrap?: (port: CollaborationDocumentPort) => CollaborationDocumentPort
): Promise<Peer> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: name, name },
    bootstrap: { kind: 'create', document: bytes },
  });
  return attachPeer(ydoc, awareness, room, wrap);
}

async function joinPeer(host: Peer, name: string): Promise<Peer> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  // Full state first, so the join handshake sees an initialized room, then live relay.
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc), 'join');
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: name, name },
    bootstrap: { kind: 'join', timeoutMs: 5_000 },
  });
  const peer = attachPeer(ydoc, awareness, room);
  wires.set(peer, relay(host, peer));
  return peer;
}

const wires = new WeakMap<Peer, Relay>();

function wireOf(peer: Peer): Relay {
  const wire = wires.get(peer);
  if (!wire) throw new Error('peer has no relay');
  return wire;
}

/**
 * Let a test emit its own journal, the way the editing surface does.
 *
 * The session's contract is that journals arrive through `observePrimitiveJournal`, so this
 * records the listener the session registers instead of adding a test-only port method.
 */
const journalTaps = new WeakMap<
  CollaborationDocumentPort,
  (journal: CanonicalPrimitiveJournal) => void
>();

function tapJournal(port: CollaborationDocumentPort): CollaborationDocumentPort {
  const tapped: CollaborationDocumentPort = {
    ...port,
    observePrimitiveJournal: (listener) => {
      journalTaps.set(tapped, listener);
      return port.observePrimitiveJournal(listener);
    },
  };
  return tapped;
}

function emitJournal(peer: Peer, journal: CanonicalPrimitiveJournal): void {
  const listener = journalTaps.get(peer.port);
  if (!listener) throw new Error('port is not tapped');
  listener(journal);
}

function attachPeer(
  ydoc: Y.Doc,
  awareness: Awareness,
  room: DocumentCollaborationHandle,
  wrap?: (port: CollaborationDocumentPort) => CollaborationDocumentPort
): Peer {
  const store = storeFrom(room.document);
  const base = createCollaborationDocumentPort(store, { documentId: DOCUMENT_ID });
  const port = wrap ? wrap(base) : base;
  const detach = room.session.attach(port);
  const peer: Peer = { ydoc, awareness, room, store, port, detach };
  opened.push(peer);
  return peer;
}

interface Relay {
  /** Hold updates, so both peers can edit from the same starting state. */
  pause(): void;
  /** Deliver everything held, in both directions. */
  resume(): void;
}

/** Deliver every update both ways, the way a transport would. */
function relay(left: Peer, right: Peer): Relay {
  let paused = false;
  const held: { readonly target: Y.Doc; readonly update: Uint8Array }[] = [];
  const forward = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (paused) {
      held.push({ target, update });
      return;
    }
    Y.applyUpdate(target, update, 'relay');
  };
  const onLeft = forward(right.ydoc);
  const onRight = forward(left.ydoc);
  left.ydoc.on('update', onLeft);
  right.ydoc.on('update', onRight);
  relays.push(() => {
    left.ydoc.off('update', onLeft);
    right.ydoc.off('update', onRight);
  });
  return {
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      for (const { target, update } of held.splice(0)) Y.applyUpdate(target, update, 'relay');
    },
  };
}

async function pair(bytes: Uint8Array): Promise<{ alice: Peer; bob: Peer }> {
  const alice = await createPeer(bytes, 'alice');
  const bob = await joinPeer(alice, 'bob');
  return { alice, bob };
}

function packageOf(peer: Peer): OoxmlPackage {
  return peer.store.currentPackage();
}

function expectConverged(left: Peer, right: Peer): void {
  expect(packageFingerprint(packageOf(right))).toBe(packageFingerprint(packageOf(left)));
  expect(saveReopenDigest(packageOf(right))).toEqual(saveReopenDigest(packageOf(left)));
}

function apply(peer: Peer, ops: readonly TreeDocOp[], scope: StoryScope = BODY): void {
  const refusal = peer.room.session.gateOperations(ops, scope);
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  const result = peer.store.transact(scope, (context) => {
    for (const op of ops) context.apply(op);
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

function nodesOf(peer: Peer, kind: OoxmlNode['kind']): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === kind) found.push(node);
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child);
  };
  visit(peer.store.bodyStore().part.root);
  return found;
}

/** Note references carry the footnote/endnote distinction in the element name, not the kind. */
function noteReferenceNames(peer: Peer): string[] {
  return nodesOf(peer, 'noteReference').map((node) =>
    node.kind === 'textValue' ? '' : node.localName
  );
}

function paragraphIdAt(peer: Peer, index: number): string {
  const paragraphs = nodesOf(peer, 'paragraph');
  const node = paragraphs[index];
  if (!node) throw new Error(`no paragraph at ${index}`);
  return node.id;
}

function partText(peer: Peer, name: string): string {
  const part = packageOf(peer).parts.get(name);
  if (!part) throw new Error(`no part ${name}`);
  const chunks: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      chunks.push(node.value);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return chunks.join('');
}

function textOf(peer: Peer): string {
  const chunks: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      chunks.push(node.value);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(peer.store.bodyStore().part.root);
  return chunks.join('');
}

function paragraphTexts(peer: Peer): string[] {
  return nodesOf(peer, 'paragraph').map((node) => {
    const chunks: string[] = [];
    const visit = (child: OoxmlNode): void => {
      if (child.kind === 'textValue') {
        chunks.push(child.value);
        return;
      }
      for (const next of child.children) visit(next);
    };
    visit(node);
    return chunks.join('');
  });
}

describe('full-document collaboration replicates every authorable change class', () => {
  test('a joiner starts from the shared document, not from stale bytes', async () => {
    const alice = await createPeer(PROSE, 'alice');
    apply(alice, [
      { op: 'insertText', paragraphId: paragraphIdAt(alice, 0), offset: 5, text: ' edited' },
    ]);
    const bob = await joinPeer(alice, 'bob');
    expect(textOf(bob)).toContain('Alpha edited');
    expectConverged(alice, bob);
  });

  test('text insert and delete replicate both ways', async () => {
    const { alice, bob } = await pair(PROSE);
    apply(alice, [
      { op: 'insertText', paragraphId: paragraphIdAt(alice, 0), offset: 5, text: '-A' },
    ]);
    expect(textOf(bob)).toContain('Alpha-A');
    expectConverged(alice, bob);

    apply(bob, [{ op: 'insertText', paragraphId: paragraphIdAt(bob, 1), offset: 5, text: '-B' }]);
    expect(textOf(alice)).toContain('Bravo-B');
    expectConverged(alice, bob);

    apply(bob, [{ op: 'deleteText', paragraphId: paragraphIdAt(bob, 1), start: 5, end: 7 }]);
    expect(textOf(alice)).toContain('Bravo');
    expect(textOf(alice)).not.toContain('Bravo-B');
    expectConverged(alice, bob);
  });

  test('run formatting replicates', async () => {
    const { alice, bob } = await pair(PROSE);
    apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId: paragraphIdAt(alice, 0),
        start: 0,
        end: 5,
        properties: [{ localName: 'b' }],
      },
    ]);
    const bolded = nodesOf(bob, 'runProperties');
    expect(bolded.length).toBeGreaterThan(0);
    expectConverged(alice, bob);
  });

  test('partial-range bold does not duplicate text after shared state is published back', async () => {
    const alice = await createPeer(DATE, 'alice');
    const paragraphId = paragraphIdAt(alice, 0);
    expect(paragraphTexts(alice)[0]).toBe('Date: March 2 2026');
    apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId,
        start: 6,
        end: 18,
        properties: [{ localName: 'b' }],
      },
    ]);
    expect(paragraphTexts(alice)[0]).toBe('Date: March 2 2026');
    expect(nodesOf(alice, 'runProperties').length).toBeGreaterThan(0);
    alice.ydoc.transact(() => {
      alice.ydoc.getMap('docx-echo-probe').set('tick', 1);
    }, 'echo');
    expect(paragraphTexts(alice)[0]).toBe('Date: March 2 2026');
    expect(nodesOf(alice, 'runProperties').length).toBeGreaterThan(0);
  });

  test('partial-range bold keeps original text once on both replicas', async () => {
    const { alice, bob } = await pair(DATE);
    const paragraphId = paragraphIdAt(alice, 0);
    apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId,
        start: 6,
        end: 18,
        properties: [{ localName: 'b' }],
      },
    ]);
    alice.ydoc.transact(() => {
      alice.ydoc.getMap('docx-echo-probe').set('tick', 1);
    }, 'echo');
    for (const peer of [alice, bob]) {
      expect(paragraphTexts(peer)[0]).toBe('Date: March 2 2026');
      expect(nodesOf(peer, 'runProperties').length).toBeGreaterThan(0);
    }
    expectConverged(alice, bob);
  });

  test('a multi-run format over a Date line keeps text once on both replicas', async () => {
    const { alice, bob } = await pair(TWO_RUN_DATE);
    const paragraphId = paragraphIdAt(alice, 0);
    const edits = runPropertyEdits(alice.store.bodyStore().part, paragraphId, 5, 18, {
      localName: 'b',
    });
    expect(edits.length).toBeGreaterThan(1);
    const queued = alice.store.transact(BODY, (context) => {
      for (const edit of edits) {
        context.apply({
          op: 'setRunProperties',
          paragraphId,
          start: edit.start,
          end: edit.end,
          properties: edit.properties,
          ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
        });
      }
    });
    if (!queued.ok) throw new Error(queued.detail ?? queued.reason);
    expect(alice.port.hasPendingJournals()).toBe(false);
    expect(paragraphTexts(alice)[0]).toBe('Date: March 2 2026');
    apply(bob, [{ op: 'insertText', paragraphId: paragraphIdAt(bob, 1), offset: 5, text: '-B' }]);
    expect(paragraphTexts(alice)[0]).toBe('Date: March 2 2026');
    expect(paragraphTexts(bob)[0]).toBe('Date: March 2 2026');
    expect(paragraphTexts(alice)[1]).toBe('Other-B');
    expect(paragraphTexts(bob)[1]).toBe('Other-B');
  });

  test('a remote update cannot strand or restate a local edit', async () => {
    const { alice, bob } = await pair(PROSE);
    // A bare transact with no explicit publish is what a keystroke looks like.
    const committed = alice.store.transact(BODY, (context) => {
      context.apply({
        op: 'insertText',
        paragraphId: paragraphIdAt(alice, 0),
        offset: 5,
        text: '-A',
      });
    });
    if (!committed.ok) throw new Error(committed.detail ?? committed.reason);
    expect(alice.port.hasPendingJournals()).toBe(false);

    // Bob's edit lands in alice's Y.Doc after hers is already shared.
    apply(bob, [{ op: 'insertText', paragraphId: paragraphIdAt(bob, 1), offset: 5, text: '-B' }]);

    alice.port.flushPendingJournals();
    expect(paragraphTexts(alice)).toEqual(['Alpha-A', 'Bravo-B', 'Charlie']);
    expect(paragraphTexts(bob)).toEqual(['Alpha-A', 'Bravo-B', 'Charlie']);
    expectConverged(alice, bob);
  });

  test('paragraph properties replicate', async () => {
    const { alice, bob } = await pair(PROSE);
    apply(alice, [
      {
        op: 'setParagraphProperties',
        paragraphId: paragraphIdAt(alice, 1),
        properties: [{ localName: 'jc', attributes: { val: 'center' } }],
      },
    ]);
    expect(nodesOf(bob, 'paragraphProperties').length).toBeGreaterThan(0);
    expectConverged(alice, bob);
  });

  test('paragraph split and join replicate structure', async () => {
    const { alice, bob } = await pair(PROSE);
    const before = nodesOf(bob, 'paragraph').length;
    apply(alice, [{ op: 'splitParagraph', paragraphId: paragraphIdAt(alice, 0), offset: 2 }]);
    expect(nodesOf(bob, 'paragraph')).toHaveLength(before + 1);
    expectConverged(alice, bob);

    apply(alice, [
      {
        op: 'joinParagraphs',
        firstId: paragraphIdAt(alice, 0),
        secondId: paragraphIdAt(alice, 1),
      },
    ]);
    expect(nodesOf(alice, 'paragraph')).toHaveLength(before);
    expect(nodesOf(bob, 'paragraph')).toHaveLength(before);
    expect(textOf(bob)).toContain('Alpha');
    expectConverged(alice, bob);
  });

  test('block deletion replicates', async () => {
    const { alice, bob } = await pair(PROSE);
    const before = nodesOf(bob, 'paragraph').length;
    apply(alice, [{ op: 'deleteBlock', blockId: paragraphIdAt(alice, 2) }]);
    expect(nodesOf(bob, 'paragraph')).toHaveLength(before - 1);
    expect(textOf(bob)).not.toContain('Charlie');
    expectConverged(alice, bob);
  });

  test('table row insert replicates', async () => {
    const { alice, bob } = await pair(TABLE);
    const rows = nodesOf(bob, 'tableRow').length;
    const table = nodesOf(alice, 'table')[0];
    const row = nodesOf(alice, 'tableRow')[0];
    if (!table || !row) throw new Error('no table');
    apply(alice, [{ op: 'insertTableRow', tableId: table.id, rowId: row.id, where: 'below' }]);
    expect(nodesOf(bob, 'tableRow').length).toBe(rows + 1);
    expectConverged(alice, bob);
  });

  test('typing inside a table cell replicates', async () => {
    const { alice, bob } = await pair(TABLE);
    const inCell = nodesOf(alice, 'paragraph').find((node) => {
      const text: string[] = [];
      const visit = (child: OoxmlNode): void => {
        if (child.kind === 'textValue') text.push(child.value);
        else for (const next of child.children) visit(next);
      };
      visit(node);
      return text.join('') === 'r1c1';
    });
    if (!inCell) throw new Error('no cell paragraph');
    apply(alice, [{ op: 'insertText', paragraphId: inCell.id, offset: 4, text: '!' }]);
    expect(textOf(bob)).toContain('r1c1!');
    expectConverged(alice, bob);
  });

  test('concurrent edits in different paragraphs both survive', async () => {
    const { alice, bob } = await pair(PROSE);
    apply(alice, [
      { op: 'insertText', paragraphId: paragraphIdAt(alice, 0), offset: 5, text: '-A' },
    ]);
    apply(bob, [{ op: 'insertText', paragraphId: paragraphIdAt(bob, 2), offset: 7, text: '-B' }]);
    expect(textOf(alice)).toContain('Alpha-A');
    expect(textOf(alice)).toContain('Charlie-B');
    expect(textOf(bob)).toContain('Alpha-A');
    expect(textOf(bob)).toContain('Charlie-B');
    expectConverged(alice, bob);
  });

  test('appended text from each peer stays in exactly one paragraph', async () => {
    const { alice, bob } = await pair(PROSE);
    const firstId = paragraphIdAt(alice, 0);
    const secondId = paragraphIdAt(alice, 1);
    expect(firstId).not.toBe(secondId);
    const before = paragraphTexts(alice);
    expect(before[0]).toBe('Alpha');
    expect(before[1]).toBe('Bravo');

    apply(alice, [{ op: 'insertText', paragraphId: firstId, offset: 5, text: ' [A]' }]);
    apply(bob, [{ op: 'insertText', paragraphId: secondId, offset: 5, text: ' [B]' }]);

    for (const peer of [alice, bob]) {
      const texts = paragraphTexts(peer);
      expect(texts[0]).toBe('Alpha [A]');
      expect(texts[1]).toBe('Bravo [B]');
      expect(texts[2]).toBe('Charlie');
      expect(texts.filter((text) => text.includes('[A]'))).toEqual(['Alpha [A]']);
      expect(texts.filter((text) => text.includes('[B]'))).toEqual(['Bravo [B]']);
    }
    expectConverged(alice, bob);
  });

  test('two peers inserting a paragraph each keep both paragraphs', async () => {
    const { alice, bob } = await pair(PROSE);
    const before = nodesOf(alice, 'paragraph').length;
    apply(alice, [{ op: 'splitParagraph', paragraphId: paragraphIdAt(alice, 0), offset: 2 }]);
    apply(bob, [{ op: 'splitParagraph', paragraphId: paragraphIdAt(bob, 2), offset: 3 }]);
    expect(nodesOf(alice, 'paragraph')).toHaveLength(before + 2);
    expect(nodesOf(bob, 'paragraph')).toHaveLength(before + 2);
    expectConverged(alice, bob);
  });

  test('paragraphs created concurrently from one state do not merge', async () => {
    // Both peers mint the SAME canonical node id, because a minted id is a part-scoped
    // counter over identical starting bytes. Nothing has been delivered yet, so neither
    // knows about the other's node: shared identity has to keep them apart on its own.
    const { alice, bob } = await pair(PROSE);
    const before = nodesOf(alice, 'paragraph').length;
    const wire = wireOf(bob);
    wire.pause();
    apply(alice, [{ op: 'splitParagraph', paragraphId: paragraphIdAt(alice, 0), offset: 2 }]);
    apply(bob, [{ op: 'splitParagraph', paragraphId: paragraphIdAt(bob, 2), offset: 3 }]);
    wire.resume();

    expect(nodesOf(alice, 'paragraph')).toHaveLength(before + 2);
    expect(nodesOf(bob, 'paragraph')).toHaveLength(before + 2);
    expect(textOf(alice)).toContain('Al');
    expect(textOf(alice)).toContain('Cha');
    expectConverged(alice, bob);
  });

  test('concurrent text in the same paragraph keeps both insertions', async () => {
    const { alice, bob } = await pair(PROSE);
    const wire = wireOf(bob);
    wire.pause();
    apply(alice, [
      { op: 'insertText', paragraphId: paragraphIdAt(alice, 1), offset: 5, text: '-A' },
    ]);
    apply(bob, [{ op: 'insertText', paragraphId: paragraphIdAt(bob, 1), offset: 0, text: 'B-' }]);
    wire.resume();

    for (const peer of [alice, bob]) {
      expect(textOf(peer)).toContain('-A');
      expect(textOf(peer)).toContain('B-');
    }
    expectConverged(alice, bob);
  });

  test('converting a footnote to an endnote replicates', async () => {
    // A note conversion changes an element's QNAME in place, keeping its id and its children.
    // The journal reports that as `putNode` for an id shared state already knows, which is an
    // update of one node's shell and not a second node.
    const { alice, bob } = await pair(footnoteBytes());
    expect(noteReferenceNames(alice)).toEqual(['footnoteReference']);
    expect(noteReferenceNames(bob)).toEqual(['footnoteReference']);

    const converted = alice.store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    if (!converted.ok) throw new Error(converted.reason);
    alice.port.flushPendingJournals();
    expect(alice.room.session.status()).toBe('ready');
    expect(noteReferenceNames(alice)).toEqual(['endnoteReference']);
    expect(noteReferenceNames(bob)).toEqual(['endnoteReference']);
    // The conversion also adds a whole part, its relationship and its content-type override,
    // so this is the package shell replicating and not only the body tree.
    expect([...packageOf(bob).parts.keys()]).toContain('/word/endnotes.xml');
    expect(packageOf(bob).contentTypes.overrides.has('/word/endnotes.xml')).toBe(true);
    expect(partText(bob, '/word/endnotes.xml')).toContain('one');
    expectConverged(alice, bob);
  });

  test('insertHyperlink replicates the external relationship', async () => {
    const { alice, bob } = await pair(PROSE);
    const paragraphId = paragraphIdAt(alice, 0);
    expect(
      alice.room.session.gateOperations(
        [{ op: 'insertHyperlink', paragraphId, start: 0, end: 5, relationshipId: 'rId1' }],
        BODY
      )
    ).toBeNull();
    let relationshipId = '';
    const result = alice.store.transact(BODY, (context) => {
      context.applyPackage((pkg) => {
        const ensured = ensureHyperlinkRelationship(pkg, 'https://example.com/doc');
        if (!ensured) throw new Error('hyperlink relationship refused');
        relationshipId = ensured.relationshipId;
        return ensured.pkg;
      });
      context.apply({
        op: 'insertHyperlink',
        paragraphId,
        start: 0,
        end: 5,
        relationshipId,
      });
    });
    if (!result.ok) throw new Error(result.detail ?? result.reason);
    alice.port.flushPendingJournals();

    const owner = packageOf(bob).mainDocumentPart;
    const records = packageOf(bob).relationships.get(owner) ?? [];
    expect(records.some((record) => record.id === relationshipId)).toBe(true);
    const rels = packageOf(bob).parts.get(relsPartNameFor(owner));
    expect(rels).toBeDefined();
    const added = !rels
      ? undefined
      : rels.root.children.find((child) => {
          if (child.kind === 'textValue') return false;
          return child.attributes.some(
            (attribute) => attribute.localName === 'Id' && attribute.value === relationshipId
          );
        });
    expect(added).toBeDefined();
    if (!added || added.kind === 'textValue') throw new Error('missing relationship child');
    expect(
      added.attributes.some(
        (attribute) => attribute.localName === 'TargetMode' && attribute.value === 'External'
      )
    ).toBe(true);
    expect(nodesOf(alice, 'hyperlink')).toHaveLength(1);
    expect(nodesOf(bob, 'hyperlink')).toHaveLength(1);
    expect(textOf(bob)).toContain('Alpha');
    // The authoring store copies only the story part after applyPackage, so alice.store
    // does not hold the new `.rels` part. Peers that materialize from shared state do.
    const carol = await joinPeer(alice, 'carol');
    expectConverged(bob, carol);
  });

  test('undo of a local edit reaches the other peer', async () => {
    const { alice, bob } = await pair(PROSE);
    apply(alice, [
      { op: 'insertText', paragraphId: paragraphIdAt(alice, 0), offset: 5, text: ' undo me' },
    ]);
    expect(textOf(bob)).toContain('Alpha undo me');
    expect(alice.room.session.canUndo()).toBe(true);
    expect(alice.room.session.undo()).toBe(true);
    expect(textOf(alice)).not.toContain('undo me');
    expect(textOf(bob)).not.toContain('undo me');
    expectConverged(alice, bob);
  });

  test('undo of consecutive typed characters reverts the whole run', async () => {
    const { alice, bob } = await pair(PROSE);
    const paragraphId = paragraphIdAt(alice, 0);
    const before = textOf(alice);
    const typed = ' [undo me]';
    let offset = 5;
    for (const character of typed) {
      apply(alice, [{ op: 'insertText', paragraphId, offset, text: character }]);
      offset += character.length;
    }
    expect(textOf(alice)).toBe(`Alpha${typed}BravoCharlie`);
    expect(textOf(bob)).toBe(`Alpha${typed}BravoCharlie`);
    expect(alice.room.session.undo()).toBe(true);
    expect(textOf(alice)).toBe(before);
    expect(textOf(bob)).toBe(before);
    expectConverged(alice, bob);
  });

  test('one refused journal recovers, but a run of them stops the session', async () => {
    // A refusal takes shared state back over the local store, so the replica agrees with the
    // room again and can keep editing. Staying in `error` after a single refusal left the
    // author silently read-only for the life of the room.
    const alice = await createPeer(PROSE, 'alice', tapJournal);
    // A journal naming a node shared state does not hold is refused whatever the validator
    // projects forward, so this drives the refusal path and not a bound arithmetic case.
    const refuse = (): void =>
      emitJournal(alice, {
        effects: [
          {
            kind: 'spliceText',
            logicalId: 'no-such-node',
            utf16Start: 0,
            deleteCount: 0,
            insert: 'X',
          },
        ],
      });
    // Each attempt is its own edit, so it arrives in its own flush task. A microtask separates
    // them the way the timer does in production.
    const attempt = async (): Promise<void> => {
      refuse();
      await Promise.resolve();
    };
    await attempt();
    expect(alice.room.session.status()).toBe('ready');
    expect(alice.room.session.statusSnapshot().reason).toBeUndefined();
    expect(alice.room.session.statusSnapshot().lastFailure?.code).toBe('unknown-logical-id');
    await attempt();
    await attempt();
    expect(alice.room.session.status()).toBe('error');
  });

  test('a realign abandons the rest of the flush batch', async () => {
    // The flush loop takes the whole batch before notifying, so these three arrive together.
    // The first refusal replaces the local tree with shared state, which leaves the other two
    // describing nodes the store no longer holds. Applying them would push content this author
    // cannot see, and would also escalate a single refusal straight to `error`.
    const alice = await createPeer(PROSE, 'alice', tapJournal);
    const refuse = (): void =>
      emitJournal(alice, {
        effects: [
          {
            kind: 'spliceText',
            logicalId: 'no-such-node',
            utf16Start: 0,
            deleteCount: 0,
            insert: 'X',
          },
        ],
      });
    refuse();
    refuse();
    refuse();
    expect(alice.room.session.status()).toBe('ready');
    expect(textOf(alice)).toBe('AlphaBravoCharlie');
  });

  test('the gate admits structural work and refuses only an unready session', async () => {
    const { alice } = await pair(PROSE);
    const ops: readonly TreeDocOp[] = [
      { op: 'splitParagraph', paragraphId: paragraphIdAt(alice, 0), offset: 1 },
    ];
    expect(alice.room.session.gateOperations(ops, BODY)).toBeNull();
    alice.room.session.setTransportStatus('disconnected', 'offline');
    expect(alice.room.session.gateOperations(ops, BODY)).toBe('collaboration-session-not-ready');
  });

  test('a duplicate delivery of the same update changes nothing', async () => {
    const { alice, bob } = await pair(PROSE);
    apply(alice, [
      { op: 'insertText', paragraphId: paragraphIdAt(alice, 0), offset: 5, text: '-A' },
    ]);
    const revision = bob.store.packageRevision;
    Y.applyUpdate(bob.ydoc, Y.encodeStateAsUpdate(alice.ydoc), 'relay');
    expect(bob.store.packageRevision).toBe(revision);
    expectConverged(alice, bob);
  });

  test('a local transact writes Yjs before it returns', async () => {
    const alice = await createPeer(PROSE, 'alice');
    const before = Y.encodeStateAsUpdate(alice.ydoc);
    const result = alice.store.transact(BODY, (context) => {
      context.apply({
        op: 'insertText',
        paragraphId: paragraphIdAt(alice, 0),
        offset: 5,
        text: '!',
      });
    });
    if (!result.ok) throw new Error(result.detail ?? result.reason);
    expect(alice.port.hasPendingJournals()).toBe(false);
    const afterCommit = Y.encodeStateAsUpdate(alice.ydoc);
    expect(afterCommit).not.toEqual(before);
    alice.room.session.flushPendingJournals();
    expect(Y.encodeStateAsUpdate(alice.ydoc)).toEqual(afterCommit);
  });

  test('two journals keep production order', async () => {
    const { alice, bob } = await pair(PROSE);
    const paragraphId = paragraphIdAt(alice, 0);
    const first = alice.store.transact(BODY, (context) => {
      context.apply({ op: 'insertText', paragraphId, offset: 5, text: '-1' });
    });
    expect(textOf(bob)).toContain('Alpha-1');
    const second = alice.store.transact(BODY, (context) => {
      context.apply({ op: 'insertText', paragraphId, offset: 7, text: '-2' });
    });
    if (!first.ok) throw new Error(first.detail ?? first.reason);
    if (!second.ok) throw new Error(second.detail ?? second.reason);
    expect(textOf(bob)).toContain('Alpha-1-2');
    expectConverged(alice, bob);
  });

  test('destroy after a commit leaves the shared document intact', async () => {
    const { alice, bob } = await pair(PROSE);
    const result = alice.store.transact(BODY, (context) => {
      context.apply({
        op: 'insertText',
        paragraphId: paragraphIdAt(alice, 0),
        offset: 5,
        text: '!',
      });
    });
    if (!result.ok) throw new Error(result.detail ?? result.reason);
    expect(textOf(bob)).toContain('Alpha!');
    alice.room.destroy();
    expect(textOf(bob)).toContain('Alpha!');
  });

  test('undo of a typing run reverts the whole run', async () => {
    const { alice, bob } = await pair(PROSE);
    const paragraphId = paragraphIdAt(alice, 0);
    const before = textOf(alice);
    const typed = ' [x]';
    let offset = 5;
    for (const character of typed) {
      const result = alice.store.transact(BODY, (context) => {
        context.apply({ op: 'insertText', paragraphId, offset, text: character });
      });
      if (!result.ok) throw new Error(result.detail ?? result.reason);
      offset += character.length;
    }
    expect(alice.room.session.canUndo()).toBe(true);
    expect(alice.room.session.undo()).toBe(true);
    expect(textOf(alice)).toBe(before);
    expect(textOf(bob)).toBe(before);
    expectConverged(alice, bob);
  });

  test('undo of a paragraph split restores the whole paragraph', async () => {
    // Guards `registry.undoDeleteFilter()`, wired into this session's UndoManager, against
    // overshooting. The filter pins node records so a peer's concurrent characters survive an
    // undo. A split supersedes the original run by setting `deleted` on it, and an earlier
    // filter pinned that flag along with the record: the run stayed tombstoned, the registry
    // re-unlisted it, and this reverted to 'BravoCharlie' with the whole paragraph's text gone.
    const { alice, bob } = await pair(PROSE);
    const before = textOf(alice);
    const originalId = paragraphIdAt(alice, 0);
    const nodes = alice.ydoc.getMap(PACKAGE_NODES_KEY) as Y.Map<Y.Map<unknown>>;
    const childrenOf = (id: string): Y.Array<string> =>
      nodes.get(id)?.get(NODE_CHILDREN_FIELD) as Y.Array<string>;
    const originalRun = childrenOf(originalId).get(0);
    apply(alice, [{ op: 'splitParagraph', paragraphId: originalId, offset: 2 }]);
    expect(nodes.get(originalRun)?.get(NODE_DELETED_FIELD)).toBe(true);

    expect(alice.room.session.undo()).toBe(true);
    // The run the split superseded is un-tombstoned and listed again. Both only happen if the
    // filter let the `deleted` flag revert; pinning it is what emptied the paragraph.
    expect(nodes.get(originalRun)?.get(NODE_DELETED_FIELD)).toBeUndefined();
    expect(childrenOf(originalId).toArray()).toEqual([originalRun]);
    expect(textOf(alice)).toBe(before);
    expect(textOf(bob)).toBe(before);
    expectConverged(alice, bob);
  });
});
