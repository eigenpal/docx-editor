/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent id minting across two in-process replicas.
//
// Before actor stripes, both peers took "highest + 1" from the same snapshot and
// the CRDT kept two revisions (or comments, or rIds) under one id. Accept then
// joined a colleague's edit. These cases pause the relay, mint on both sides,
// resume, and require both ids to survive.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  contentControlPropertiesOf,
  contentControlsIn,
  detectBodyTocs,
  ensureHyperlinkRelationship,
  nextCommentId,
  normalizeParagraphIdentity,
  parseTocInstruction,
  planTocEntries,
  readOoxmlPackage,
  TreePackageStore,
  type OoxmlNode,
  type OoxmlPackage,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  createCollaborationDocumentPort,
  type CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../document-session.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const DOCUMENT_ID = 'actor-scoped-id-room';
const BODY: StoryScope = { kind: 'body' };
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const ADA = { author: 'Ada Lovelace', date: '2026-01-02T03:04:05Z' };

const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

function documentBytes(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_TYPE}"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/comments.xml': strToU8(`<w:comments xmlns:w="${W}"/>`),
  });
}

const PROSE = documentBytes(
  '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Bravo</w:t></w:r></w:p>'
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

async function createPeer(bytes: Uint8Array, name: string): Promise<Peer> {
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

function attachPeer(ydoc: Y.Doc, awareness: Awareness, room: DocumentCollaborationHandle): Peer {
  const store = storeFrom(room.document);
  const port = createCollaborationDocumentPort(store, { documentId: DOCUMENT_ID });
  const detach = room.session.attach(port);
  const peer: Peer = { ydoc, awareness, room, store, port, detach };
  opened.push(peer);
  return peer;
}

interface Relay {
  pause(): void;
  resume(): void;
}

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

function apply(peer: Peer, ops: readonly TreeDocOp[]): void {
  const result = peer.store.transact(
    BODY,
    (context) => {
      for (const op of ops) context.apply(op);
    },
    { actorId: peer.room.session.identity.actorId }
  );
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

function mintAnchoredComment(peer: Peer, paragraphIndex: number, actorId: string): string {
  const comments = packageOf(peer).parts.get('/word/comments.xml');
  const commentId = nextCommentId(comments, actorId);
  const paragraphId = paragraphIdAt(peer, paragraphIndex);
  apply(peer, [
    {
      op: 'insertCommentMarker',
      paragraphId,
      offset: 5,
      commentId,
      marker: 'reference',
    },
    {
      op: 'insertCommentMarker',
      paragraphId,
      offset: 5,
      commentId,
      marker: 'end',
    },
    {
      op: 'insertCommentMarker',
      paragraphId,
      offset: 0,
      commentId,
      marker: 'start',
    },
  ]);
  return commentId;
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

function paragraphIdAt(peer: Peer, index: number): string {
  const node = nodesOf(peer, 'paragraph')[index];
  if (!node) throw new Error(`no paragraph at ${index}`);
  return node.id;
}

function attribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const entry of node.attributes) {
    if (entry.localName === localName && entry.namespaceUri === W) return entry.value;
  }
  return undefined;
}

function collectLocalNames(pkg: OoxmlPackage, localName: string): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === localName && node.namespaceUri === W) {
      const id = attribute(node, 'id');
      if (id !== undefined) ids.push(id);
    }
    for (const child of node.children) visit(child);
  };
  for (const part of pkg.parts.values()) visit(part.root);
  return ids;
}

function relationshipIds(pkg: OoxmlPackage): string[] {
  const ids: string[] = [];
  for (const records of pkg.relationships.values()) {
    for (const record of records) ids.push(record.id);
  }
  for (const external of pkg.externalTargets) ids.push(external.id);
  return ids;
}

describe('concurrent minting does not collide after sync', () => {
  test('two replicas mint different revision ids and both survive', async () => {
    const { alice, bob } = await pair(PROSE);
    const wire = wireOf(bob);
    wire.pause();
    apply(alice, [
      {
        op: 'insertText',
        paragraphId: paragraphIdAt(alice, 0),
        offset: 5,
        text: '-A',
        revision: ADA,
      },
    ]);
    apply(bob, [
      {
        op: 'insertText',
        paragraphId: paragraphIdAt(bob, 1),
        offset: 5,
        text: '-B',
        revision: ADA,
      },
    ]);
    const aliceBefore = collectLocalNames(packageOf(alice), 'ins');
    const bobBefore = collectLocalNames(packageOf(bob), 'ins');
    expect(aliceBefore).toHaveLength(1);
    expect(bobBefore).toHaveLength(1);
    expect(aliceBefore[0]).not.toBe(bobBefore[0]);
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    const ids = collectLocalNames(packageOf(alice), 'ins');
    expect(ids).toContain(aliceBefore[0]);
    expect(ids).toContain(bobBefore[0]);
    expect(new Set(ids).size).toBe(2);
    expectConverged(alice, bob);
  });

  test('two replicas mint different comment ids and both survive', async () => {
    const { alice, bob } = await pair(PROSE);
    const wire = wireOf(bob);
    wire.pause();
    const aliceId = mintAnchoredComment(alice, 0, 'alice');
    const bobId = mintAnchoredComment(bob, 1, 'bob');
    expect(aliceId).not.toBe(bobId);
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    const ids = collectLocalNames(packageOf(alice), 'commentRangeStart');
    expect(ids).toContain(aliceId);
    expect(ids).toContain(bobId);
    expect(new Set(ids).size).toBe(2);
    expectConverged(alice, bob);
  });

  test('two replicas mint different relationship ids and both survive', async () => {
    const { alice, bob } = await pair(PROSE);
    const wire = wireOf(bob);
    wire.pause();
    let aliceRel = '';
    let bobRel = '';
    const aliceResult = alice.store.transact(
      BODY,
      (context) => {
        context.applyPackage((pkg) => {
          const ensured = ensureHyperlinkRelationship(pkg, 'https://example.com/a');
          if (!ensured) throw new Error('alice hyperlink refused');
          aliceRel = ensured.relationshipId;
          return ensured.pkg;
        });
        context.apply({
          op: 'insertHyperlink',
          paragraphId: paragraphIdAt(alice, 0),
          start: 0,
          end: 5,
          relationshipId: aliceRel,
        });
      },
      { actorId: 'alice' }
    );
    const bobResult = bob.store.transact(
      BODY,
      (context) => {
        context.applyPackage((pkg) => {
          const ensured = ensureHyperlinkRelationship(pkg, 'https://example.com/b');
          if (!ensured) throw new Error('bob hyperlink refused');
          bobRel = ensured.relationshipId;
          return ensured.pkg;
        });
        context.apply({
          op: 'insertHyperlink',
          paragraphId: paragraphIdAt(bob, 1),
          start: 0,
          end: 5,
          relationshipId: bobRel,
        });
      },
      { actorId: 'bob' }
    );
    if (!aliceResult.ok) throw new Error(aliceResult.detail ?? aliceResult.reason);
    if (!bobResult.ok) throw new Error(bobResult.detail ?? bobResult.reason);
    expect(aliceRel).not.toBe(bobRel);
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    const aliceIds = new Set(relationshipIds(packageOf(alice)));
    const bobIds = new Set(relationshipIds(packageOf(bob)));
    expect(aliceIds.has(aliceRel)).toBe(true);
    expect(aliceIds.has(bobRel)).toBe(true);
    expect(bobIds.has(aliceRel)).toBe(true);
    expect(bobIds.has(bobRel)).toBe(true);
    expect(aliceRel).not.toBe(bobRel);
  });

  test('two replicas insert a TOC and keep distinct bookmark ids', async () => {
    const headings = documentBytes(
      '<w:p><w:r><w:t>Title</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p>'
    );
    const { alice, bob } = await pair(headings);
    const wire = wireOf(bob);
    const title = paragraphIdAt(alice, 0);
    const alpha = paragraphIdAt(alice, 1);
    const bravo = paragraphIdAt(alice, 2);
    expect(paragraphIdAt(bob, 0)).toBe(title);
    const tocOp = (prefix: string): Extract<TreeDocOp, { op: 'insertToc' }> => ({
      op: 'insertToc',
      beforeParagraphId: title,
      instruction: 'TOC \\o "1-3" \\h',
      alias: `${prefix} TOC`,
      entries: [
        {
          level: 0,
          text: 'Alpha',
          headingParagraphId: alpha,
          bookmarkName: `_Toc${prefix}1`,
          pageNumberText: '1',
        },
        {
          level: 0,
          text: 'Bravo',
          headingParagraphId: bravo,
          bookmarkName: `_Toc${prefix}2`,
          pageNumberText: '1',
        },
      ],
      bookmarksToCreate: [
        { paragraphId: alpha, name: `_Toc${prefix}1` },
        { paragraphId: bravo, name: `_Toc${prefix}2` },
      ],
    });
    wire.pause();
    apply(alice, [tocOp('Alice')]);
    apply(bob, [tocOp('Bob')]);
    const aliceBefore = collectLocalNames(packageOf(alice), 'bookmarkStart');
    const bobBefore = collectLocalNames(packageOf(bob), 'bookmarkStart');
    expect(aliceBefore).toHaveLength(2);
    expect(bobBefore).toHaveLength(2);
    expect(new Set([...aliceBefore, ...bobBefore]).size).toBe(4);
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    const ids = collectLocalNames(packageOf(alice), 'bookmarkStart');
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(expect.arrayContaining(aliceBefore));
    expect(ids).toEqual(expect.arrayContaining(bobBefore));
    expect(detectBodyTocs(alice.store.bodyStore().part)).toHaveLength(2);
    expect(detectBodyTocs(bob.store.bodyStore().part)).toHaveLength(2);
    expectConverged(alice, bob);
  });

  test('two replicas insert a TOC and keep distinct _Toc names on their own headings', async () => {
    const headings = documentBytes(
      '<w:p><w:r><w:t>Title</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p>'
    );
    const { alice, bob } = await pair(headings);
    const wire = wireOf(bob);
    const title = paragraphIdAt(alice, 0);
    const alpha = paragraphIdAt(alice, 1);
    const bravo = paragraphIdAt(alice, 2);
    expect(paragraphIdAt(bob, 1)).toBe(alpha);
    expect(paragraphIdAt(bob, 2)).toBe(bravo);
    const instruction = parseTocInstruction('TOC \\o "1-3" \\h');
    if (!instruction) throw new Error('TOC instruction');
    const planFor = (
      peer: Peer,
      headingId: string,
      text: string
    ): ReturnType<typeof planTocEntries> =>
      planTocEntries(
        peer.store.bodyStore().part,
        [{ text, level: 0, blockId: headingId }],
        instruction,
        new Map([[headingId, '1']]),
        new Set(),
        peer.room.session.identity.actorId
      );
    const alicePlan = planFor(alice, alpha, 'Alpha');
    const bobPlan = planFor(bob, bravo, 'Bravo');
    const aliceName = alicePlan.bookmarksToCreate[0]?.name;
    const bobName = bobPlan.bookmarksToCreate[0]?.name;
    expect(aliceName).toBeDefined();
    expect(bobName).toBeDefined();
    expect(aliceName).not.toBe(bobName);
    const tocOp = (
      plan: ReturnType<typeof planTocEntries>,
      alias: string
    ): Extract<TreeDocOp, { op: 'insertToc' }> => ({
      op: 'insertToc',
      beforeParagraphId: title,
      instruction: 'TOC \\o "1-3" \\h',
      alias,
      entries: plan.entries,
      bookmarksToCreate: plan.bookmarksToCreate,
    });
    wire.pause();
    apply(alice, [tocOp(alicePlan, 'Alice TOC')]);
    apply(bob, [tocOp(bobPlan, 'Bob TOC')]);
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    const names = bookmarkNames(packageOf(alice));
    expect(names).toEqual(expect.arrayContaining([aliceName, bobName]));
    expect(new Set(names).size).toBe(names.length);
    expect(hyperlinkAnchors(packageOf(alice))).toEqual(
      expect.arrayContaining([aliceName, bobName])
    );
    expect(bookmarkParagraphOf(packageOf(alice), aliceName!)).toBe(alpha);
    expect(bookmarkParagraphOf(packageOf(alice), bobName!)).toBe(bravo);
    expect(detectBodyTocs(alice.store.bodyStore().part)).toHaveLength(2);
    expectConverged(alice, bob);
  });

  test('two replicas insert a content control and keep distinct ids', async () => {
    const { alice, bob } = await pair(PROSE);
    const wire = wireOf(bob);
    wire.pause();
    apply(alice, [
      {
        op: 'insertContentControl',
        paragraphId: paragraphIdAt(alice, 0),
        start: 0,
        end: 5,
        type: 'plainText',
        tag: 'alice',
      },
    ]);
    apply(bob, [
      {
        op: 'insertContentControl',
        paragraphId: paragraphIdAt(bob, 1),
        start: 0,
        end: 5,
        type: 'plainText',
        tag: 'bob',
      },
    ]);
    const aliceBefore = contentControlIds(packageOf(alice));
    const bobBefore = contentControlIds(packageOf(bob));
    expect(aliceBefore).toHaveLength(1);
    expect(bobBefore).toHaveLength(1);
    expect(aliceBefore[0]).not.toBe(bobBefore[0]);
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    const ids = contentControlIds(packageOf(alice));
    expect(ids).toContain(aliceBefore[0]);
    expect(ids).toContain(bobBefore[0]);
    expect(new Set(ids).size).toBe(2);
    expectConverged(alice, bob);
  });
});

function bookmarkNames(pkg: OoxmlPackage): string[] {
  const names: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'bookmarkStart' && node.namespaceUri === W) {
      const name = attribute(node, 'name');
      if (name !== undefined) names.push(name);
    }
    for (const child of node.children) visit(child);
  };
  for (const part of pkg.parts.values()) visit(part.root);
  return names;
}

function hyperlinkAnchors(pkg: OoxmlPackage): string[] {
  const anchors: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'hyperlink' && node.namespaceUri === W) {
      const anchor = attribute(node, 'anchor');
      if (anchor !== undefined) anchors.push(anchor);
    }
    for (const child of node.children) visit(child);
  };
  for (const part of pkg.parts.values()) visit(part.root);
  return anchors;
}

function bookmarkParagraphOf(pkg: OoxmlPackage, name: string): string | undefined {
  const visit = (node: OoxmlNode, paragraphId: string | undefined): string | undefined => {
    if (node.kind === 'textValue') return undefined;
    const current = node.kind === 'paragraph' ? node.id : paragraphId;
    if (node.localName === 'bookmarkStart' && attribute(node, 'name') === name) {
      return current;
    }
    for (const child of node.children) {
      const found = visit(child, current);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const part of pkg.parts.values()) {
    const found = visit(part.root, undefined);
    if (found !== undefined) return found;
  }
  return undefined;
}

function contentControlIds(pkg: OoxmlPackage): number[] {
  const ids: number[] = [];
  for (const part of pkg.parts.values()) {
    for (const entry of contentControlsIn(part.root)) {
      const id = contentControlPropertiesOf(entry.node).id;
      if (id !== undefined) ids.push(id);
    }
  }
  return ids;
}
