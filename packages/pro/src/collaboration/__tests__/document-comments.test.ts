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
// Comment writes must replicate the body markers AND the comments part.
//
// A journal that carried only `commentRangeStart` / `commentReference` would leave a peer
// with anchors that name a comment the package does not hold. That is a corrupt document
// produced silently, which this suite refuses to treat as convergence.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  addPackageComment,
  commentsExtendedPartNameOf,
  deletePackageComments,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  relsPartNameFor,
  relationshipsOf,
  resolveContentTypeOf,
  setPackageCommentResolved,
  threadStateOfPart,
  TreePackageStore,
  type OoxmlNode,
  type OoxmlPackage,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration';
import { createDocumentCollaboration } from '../document-session.ts';
import type { YjsCollaborationRoom } from '../session.ts';
import { findText, nodeText, packageFingerprint, saveReopenDigest } from './document-support.ts';

const DOCUMENT_ID = 'comment-replication-room';
const BODY: StoryScope = { kind: 'body' };
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_PART = '/word/comments.xml';

function documentBytes(body: string, extras?: { comments?: string }): Uint8Array {
  const types =
    `<Types xmlns="${CT}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    (extras?.comments === undefined
      ? ''
      : `<Override PartName="${COMMENTS_PART}" ContentType="${COMMENTS_TYPE}"/>`) +
    '</Types>';
  const documentRels =
    extras?.comments === undefined
      ? undefined
      : `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
        '</Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    ...(documentRels === undefined
      ? {}
      : { 'word/_rels/document.xml.rels': strToU8(documentRels) }),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    ...(extras?.comments === undefined ? {} : { 'word/comments.xml': strToU8(extras.comments) }),
  });
}

const EMPTY = documentBytes(
  '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Bravo</w:t></w:r></w:p>'
);

const WITH_COMMENTS = documentBytes(
  '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Bravo</w:t></w:r></w:p>',
  { comments: `<w:comments xmlns:w="${W}"/>` }
);

interface Peer {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: YjsCollaborationRoom;
  readonly store: TreePackageStore;
  readonly port: ReturnType<typeof createCollaborationDocumentPort>;
  readonly detach: () => void;
}

const opened: Peer[] = [];
const relays: (() => void)[] = [];
const wires = new WeakMap<Peer, Relay>();

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

function attachPeer(ydoc: Y.Doc, awareness: Awareness, room: YjsCollaborationRoom): Peer {
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

function wmlId(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const entry of node.attributes) {
    if (entry.localName === 'id' && entry.namespaceUri === W) return entry.value;
  }
  return undefined;
}

function walk(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walk(child, visit);
}

function markerIds(
  pkg: OoxmlPackage,
  kind: 'commentRangeStart' | 'commentRangeEnd' | 'commentReference'
): string[] {
  const ids: string[] = [];
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (!part) return ids;
  walk(part.root, (node) => {
    if (node.kind === kind) {
      const id = wmlId(node);
      if (id !== undefined) ids.push(id);
    }
  });
  return ids;
}

function commentTextOf(pkg: OoxmlPackage, commentId: string): string | null {
  const part = pkg.parts.get(COMMENTS_PART);
  if (!part) return null;
  let text: string | null = null;
  walk(part.root, (node) => {
    if (node.kind !== 'comment' || wmlId(node) !== commentId) return;
    const chunks: string[] = [];
    walk(node, (child) => {
      if (child.kind === 'textValue') chunks.push(child.value);
    });
    text = chunks.join('');
  });
  return text;
}

function commentsRelationship(pkg: OoxmlPackage): boolean {
  const owner = pkg.mainDocumentPart;
  if (relationshipsOf(pkg, owner).some((record) => record.type === COMMENTS_REL)) return true;
  const rels = pkg.parts.get(relsPartNameFor(owner));
  if (!rels) return false;
  let found = false;
  walk(rels.root, (node) => {
    if (node.kind === 'textValue') return;
    if (node.localName !== 'Relationship') return;
    found ||= node.attributes.some(
      (attribute) => attribute.localName === 'Type' && attribute.value === COMMENTS_REL
    );
  });
  return found;
}

function paragraphIdAt(peer: Peer, index: number): string {
  const paragraphs: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') paragraphs.push(node.id);
  });
  const id = paragraphs[index];
  if (!id) throw new Error(`no paragraph at ${index}`);
  return id;
}

function apply(peer: Peer, ops: readonly TreeDocOp[]): void {
  const result = peer.store.transact(BODY, (context) => {
    for (const op of ops) context.apply(op);
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

function addCommentOn(peer: Peer, paragraphIndex: number, text: string, author: string): string {
  const result = addPackageComment(
    peer.store,
    {
      anchor: { paragraphId: paragraphIdAt(peer, paragraphIndex), start: 0, end: 5 },
      author,
      text,
      actorId: peer.room.session.identity.actorId,
    },
    BODY
  );
  if (!result.ok) throw new Error(String(result.reason));
  peer.port.flushPendingJournals();
  return result.commentId;
}

function expectCommentOnPeer(peer: Peer, commentId: string, text: string): void {
  const pkg = packageOf(peer);
  expect(markerIds(pkg, 'commentRangeStart')).toContain(commentId);
  expect(markerIds(pkg, 'commentRangeEnd')).toContain(commentId);
  expect(markerIds(pkg, 'commentReference')).toContain(commentId);
  expect(pkg.parts.has(COMMENTS_PART)).toBe(true);
  expect(commentTextOf(pkg, commentId)).toBe(text);
  expect(commentsRelationship(pkg)).toBe(true);
  expect(resolveContentTypeOf(pkg, COMMENTS_PART)).toBe(COMMENTS_TYPE);
}

describe('adding a comment replicates the comments part, not only the story markers', () => {
  test('a receiving peer gets markers, comments.xml, the relationship and the override', async () => {
    const { alice, bob } = await pair(EMPTY);
    expect(packageOf(alice).parts.has(COMMENTS_PART)).toBe(false);
    const commentId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    expectCommentOnPeer(alice, commentId, 'alice remark');
    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
    expectCommentOnPeer(bob, commentId, 'alice remark');
    expectConverged(alice, bob);
  });

  test('a receiving peer also gets a comment appended to an existing comments.xml', async () => {
    const { alice, bob } = await pair(WITH_COMMENTS);
    const commentId = addCommentOn(alice, 0, 'on existing part', 'Alice');
    expectCommentOnPeer(alice, commentId, 'on existing part');
    expectCommentOnPeer(bob, commentId, 'on existing part');
    expectConverged(alice, bob);
  });

  test('concurrent adds on a document with no comments.xml both survive with distinct ids', async () => {
    const { alice, bob } = await pair(EMPTY);
    const wire = wires.get(bob);
    if (!wire) throw new Error('peer has no relay');
    wire.pause();
    const aliceId = addCommentOn(alice, 0, 'from alice', 'Alice');
    const bobId = addCommentOn(bob, 1, 'from bob', 'Bob');
    expect(aliceId).not.toBe(bobId);
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCommentOnPeer(alice, aliceId, 'from alice');
    expectCommentOnPeer(alice, bobId, 'from bob');
    expectCommentOnPeer(bob, aliceId, 'from alice');
    expectCommentOnPeer(bob, bobId, 'from bob');
    const starts = markerIds(packageOf(alice), 'commentRangeStart');
    expect(new Set(starts).size).toBe(2);
    expectConverged(alice, bob);
  });

  test('concurrent adds onto an existing comments.xml both survive with distinct ids', async () => {
    const { alice, bob } = await pair(WITH_COMMENTS);
    const wire = wires.get(bob);
    if (!wire) throw new Error('peer has no relay');
    wire.pause();
    const aliceId = addCommentOn(alice, 0, 'from alice', 'Alice');
    const bobId = addCommentOn(bob, 1, 'from bob', 'Bob');
    expect(aliceId).not.toBe(bobId);
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCommentOnPeer(alice, aliceId, 'from alice');
    expectCommentOnPeer(alice, bobId, 'from bob');
    expectCommentOnPeer(bob, aliceId, 'from alice');
    expectCommentOnPeer(bob, bobId, 'from bob');
    expect(new Set(markerIds(packageOf(alice), 'commentRangeStart')).size).toBe(2);
    expectConverged(alice, bob);
  });
});

const COMMENTS_EXTENDED_PART = '/word/commentsExtended.xml';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const COMMENTS_EXTENDED_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';

function replyOn(peer: Peer, parentId: string, paragraphIndex: number, text: string): string {
  const result = addPackageComment(
    peer.store,
    {
      anchor: { paragraphId: paragraphIdAt(peer, paragraphIndex), start: 0, end: 5 },
      author: 'Alice',
      text,
      replyToCommentId: parentId,
      actorId: peer.room.session.identity.actorId,
    },
    BODY
  );
  if (!result.ok) throw new Error(String(result.reason));
  peer.port.flushPendingJournals();
  return result.commentId;
}

function doneStates(peer: Peer): boolean[] {
  const pkg = packageOf(peer);
  const extendedName = commentsExtendedPartNameOf(pkg, pkg.mainDocumentPart);
  const part = pkg.parts.get(extendedName);
  if (!part) return [];
  return [...threadStateOfPart(part).values()].map((state) => state.done);
}

function expectExtendedOnPeer(peer: Peer, done: boolean): void {
  const pkg = packageOf(peer);
  const extendedName = commentsExtendedPartNameOf(pkg, pkg.mainDocumentPart);
  expect(pkg.parts.has(extendedName)).toBe(true);
  expect(
    relationshipsOf(pkg, pkg.mainDocumentPart).some((r) => r.type === COMMENTS_EXTENDED_REL)
  ).toBe(true);
  expect(resolveContentTypeOf(pkg, extendedName)).toBe(COMMENTS_EXTENDED_TYPE);
  const states = threadStateOfPart(pkg.parts.get(extendedName)!);
  expect([...states.values()].some((state) => state.done === done)).toBe(true);
}

describe('replying to a comment replicates the reply record and thread part', () => {
  test('a receiving peer gets the reply body, markers, and commentsExtended.xml', async () => {
    const { alice, bob } = await pair(EMPTY);
    const parentId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    const replyId = replyOn(alice, parentId, 0, 'alice reply');
    expectCommentOnPeer(bob, parentId, 'alice remark');
    expectCommentOnPeer(bob, replyId, 'alice reply');
    expect(packageOf(bob).parts.has(COMMENTS_EXTENDED_PART)).toBe(true);
    expectConverged(alice, bob);
  });
});

describe('resolving a comment replicates commentsExtended.xml, not only the story', () => {
  test('resolving a top-level comment creates commentsExtended.xml on the peer', async () => {
    const { alice, bob } = await pair(EMPTY);
    const commentId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    expect(packageOf(alice).parts.has(COMMENTS_EXTENDED_PART)).toBe(false);
    const result = setPackageCommentResolved(alice.store, commentId, true);
    expect(result.ok).toBe(true);
    alice.port.flushPendingJournals();
    expectCommentOnPeer(bob, commentId, 'alice remark');
    expectExtendedOnPeer(bob, true);
    expectConverged(alice, bob);
  });

  test('reopening a resolved comment clears done on the peer', async () => {
    const { alice, bob } = await pair(EMPTY);
    const commentId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    expect(setPackageCommentResolved(alice.store, commentId, true).ok).toBe(true);
    alice.port.flushPendingJournals();
    expect(setPackageCommentResolved(alice.store, commentId, false).ok).toBe(true);
    alice.port.flushPendingJournals();
    expectCommentOnPeer(bob, commentId, 'alice remark');
    expectExtendedOnPeer(bob, false);
    expect(doneStates(alice)).toEqual([false]);
    expect(doneStates(bob)).toEqual([false]);
    expect(findText(packageOf(bob), 'Alpha').value).toBe('Alpha');
    expectConverged(alice, bob);
  });

  test('resolving a thread that already has commentsExtended.xml updates done', async () => {
    const { alice, bob } = await pair(EMPTY);
    const parentId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    replyOn(alice, parentId, 0, 'alice reply');
    expect(setPackageCommentResolved(alice.store, parentId, true).ok).toBe(true);
    alice.port.flushPendingJournals();
    expectExtendedOnPeer(bob, true);
    expect(doneStates(bob).every((done) => done)).toBe(true);
    expectConverged(alice, bob);
  });

  test('two peers resolving different comments converge', async () => {
    const { alice, bob } = await pair(EMPTY);
    const aliceId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    const bobId = addCommentOn(bob, 1, 'bob remark', 'Bob');
    const wire = wires.get(bob);
    if (!wire) throw new Error('peer has no relay');
    wire.pause();
    expect(setPackageCommentResolved(alice.store, aliceId, true).ok).toBe(true);
    alice.port.flushPendingJournals();
    expect(setPackageCommentResolved(bob.store, bobId, true).ok).toBe(true);
    bob.port.flushPendingJournals();
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCommentOnPeer(bob, aliceId, 'alice remark');
    expectCommentOnPeer(alice, bobId, 'bob remark');
    expect(doneStates(alice).filter((done) => done)).toHaveLength(2);
    expect(doneStates(bob).filter((done) => done)).toHaveLength(2);
    expectConverged(alice, bob);
  });

  test('resolve on one peer converges with a text edit on the anchored paragraph', async () => {
    const { alice, bob } = await pair(EMPTY);
    const commentId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    const wire = wires.get(bob);
    if (!wire) throw new Error('peer has no relay');
    wire.pause();
    expect(setPackageCommentResolved(alice.store, commentId, true).ok).toBe(true);
    alice.port.flushPendingJournals();
    apply(bob, [{ op: 'insertText', paragraphId: paragraphIdAt(bob, 0), offset: 5, text: '!' }]);
    wire.resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    expectCommentOnPeer(bob, commentId, 'alice remark');
    expectExtendedOnPeer(bob, true);
    expect(nodeText(packageOf(alice).parts.get(packageOf(alice).mainDocumentPart)!.root)).toContain(
      'Alpha!'
    );
    expect(nodeText(packageOf(bob).parts.get(packageOf(bob).mainDocumentPart)!.root)).toContain(
      'Alpha!'
    );
    expectConverged(alice, bob);
  });
});

describe('deleting a comment replicates the stripped markers and the comments part', () => {
  test('deleting a thread removes markers and the comment record on the peer', async () => {
    const { alice, bob } = await pair(EMPTY);
    const commentId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    expectCommentOnPeer(bob, commentId, 'alice remark');
    expect(deletePackageComments(alice.store, [{ commentId }])).toBe(true);
    alice.port.flushPendingJournals();
    expect(markerIds(packageOf(bob), 'commentRangeStart')).not.toContain(commentId);
    expect(markerIds(packageOf(bob), 'commentReference')).not.toContain(commentId);
    expect(commentTextOf(packageOf(bob), commentId)).toBe(null);
    expect(findText(packageOf(bob), 'Alpha').value).toBe('Alpha');
    expect(findText(packageOf(alice), 'Alpha').value).toBe('Alpha');
    expectConverged(alice, bob);
  });

  test('deleting a reply leaves the parent and does not dangle on the peer', async () => {
    const { alice, bob } = await pair(EMPTY);
    const parentId = addCommentOn(alice, 0, 'alice remark', 'Alice');
    const replyId = replyOn(alice, parentId, 0, 'alice reply');
    expect(
      deletePackageComments(alice.store, [{ commentId: replyId, parentCommentId: parentId }])
    ).toBe(true);
    alice.port.flushPendingJournals();
    expectCommentOnPeer(bob, parentId, 'alice remark');
    expect(commentTextOf(packageOf(bob), replyId)).toBe(null);
    expect(markerIds(packageOf(bob), 'commentReference')).not.toContain(replyId);
    expect(findText(packageOf(bob), 'Alpha').value).toBe('Alpha');
    expectConverged(alice, bob);
  });
});
