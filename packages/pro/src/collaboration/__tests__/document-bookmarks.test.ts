/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// insertBookmark and deleteBookmark between two peers: the markers replicate, survive save and
// reopen, undo and redo, concurrent edits to the text around them, and a peer that was offline.

import { afterEach, describe, expect, test } from 'bun:test';
import { listBookmarks, type BookmarkRecord, type TreeDocOp } from '@docx-editor.dev/core/store';
import {
  BODY as BODY_SCOPE,
  createPeerHarness,
  nodeText,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const peers = createPeerHarness('bookmark-replication-room');

afterEach(() => peers.cleanup());

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Hello world, again</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second</w:t></w:r></w:p><w:sectPr/>';

function bookmarks(peer: Peer): readonly BookmarkRecord[] {
  return listBookmarks(peer.store.bodyStore().part);
}

function names(peer: Peer): string[] {
  return bookmarks(peer).map((bookmark) => bookmark.name);
}

function firstText(peer: Peer): string {
  return nodeText(peer.store.bodyStore().part.root).split('Second')[0]!;
}

/** Apply ops as the editor does: through the gate, with the peer bound as the actor. */
function applyAs(peer: Peer, ops: readonly TreeDocOp[]): void {
  const refusal = peer.room.session.gateOperations(ops, BODY_SCOPE);
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  const result = peer.store.transact(
    BODY_SCOPE,
    (context) => {
      for (const op of ops) context.apply(op);
    },
    { actorId: peer.room.session.identity.actorId }
  );
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

function bookmarkWorld(peer: Peer, name = 'World') {
  const paragraphId = peers.paragraphIdAt(peer, 0);
  applyAs(peer, [
    {
      op: 'insertBookmark',
      name,
      start: { paragraphId, offset: 6 },
      end: { paragraphId, offset: 11 },
    },
  ]);
}

describe('bookmark ops replicate between peers', () => {
  test('an inserted bookmark reaches the peer with the same range and survives save and reopen', async () => {
    const { alice, bob } = await peers.pair(zipDocument(BODY));
    bookmarkWorld(alice);
    expect(names(bob)).toEqual(['World']);
    const [record] = bookmarks(bob);
    expect([record!.start.offset, record!.end.offset]).toEqual([6, 11]);
    peers.expectConverged(alice, bob);
    const late = await peers.join(alice, 'late');
    expect(names(late)).toEqual(['World']);
    peers.expectConverged(alice, late);
  });

  test('a deleted bookmark is gone on the peer and the text stays', async () => {
    const { alice, bob } = await peers.pair(zipDocument(BODY));
    bookmarkWorld(alice);
    peers.apply(bob, [{ op: 'deleteBookmark', name: 'world' }]);
    expect(names(alice)).toEqual([]);
    expect(firstText(alice)).toBe('Hello world, again');
    peers.expectConverged(alice, bob);
  });

  test('undo and redo of an insert converge', async () => {
    const { alice, bob } = await peers.pair(zipDocument(BODY));
    bookmarkWorld(alice);
    expect(alice.room.session.undo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(names(bob)).toEqual([]);
    expect(alice.room.session.redo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(names(bob)).toEqual(['World']);
  });

  test('a peer typing at the bookmark start puts its text inside the bookmark everywhere', async () => {
    const { alice, bob } = await peers.pair(zipDocument(BODY));
    bookmarkWorld(alice);
    peers.apply(bob, [
      { op: 'insertText', paragraphId: peers.paragraphIdAt(bob, 0), offset: 6, text: 'big ' },
    ]);
    peers.expectConverged(alice, bob);
    const [record] = bookmarks(alice);
    expect([record!.start.offset, record!.end.offset]).toEqual([6, 15]);
  });
});

describe('concurrent edits around a bookmark converge', () => {
  test('a peer deletes the bookmarked text while the other adds the bookmark', async () => {
    const { alice, bob, pause, resume } = await peers.pair(zipDocument(BODY));
    pause();
    bookmarkWorld(alice);
    peers.apply(bob, [
      { op: 'deleteText', paragraphId: peers.paragraphIdAt(bob, 0), start: 5, end: 12 },
    ]);
    resume();
    peers.expectConverged(alice, bob);
    expect(firstText(alice)).toBe('Hello again');
  });

  test('a peer deletes text around a bookmark the other added earlier', async () => {
    const { alice, bob } = await peers.pair(zipDocument(BODY));
    bookmarkWorld(alice);
    peers.apply(bob, [
      { op: 'deleteText', paragraphId: peers.paragraphIdAt(bob, 0), start: 5, end: 12 },
    ]);
    peers.expectConverged(alice, bob);
    // The deletion covered the whole bookmark, so it went with the text.
    expect(names(alice)).toEqual([]);
  });

  test('a peer trims part of the bookmarked text and the rest stays bookmarked', async () => {
    const { alice, bob } = await peers.pair(zipDocument(BODY));
    bookmarkWorld(alice);
    peers.apply(bob, [
      { op: 'deleteText', paragraphId: peers.paragraphIdAt(bob, 0), start: 9, end: 13 },
    ]);
    peers.expectConverged(alice, bob);
    const [record] = bookmarks(alice);
    expect([record!.start.offset, record!.end.offset]).toEqual([6, 9]);
  });

  test('two peers add bookmarks offline and both arrive on reconnect', async () => {
    const { alice, bob, pause, resume } = await peers.pair(zipDocument(BODY));
    pause();
    bookmarkWorld(alice, 'Alpha');
    const second = peers.paragraphIdAt(bob, 1);
    applyAs(bob, [
      {
        op: 'insertBookmark',
        name: 'Beta',
        start: { paragraphId: second, offset: 0 },
        end: { paragraphId: second, offset: 6 },
      },
    ]);
    resume();
    peers.expectConverged(alice, bob);
    expect(names(alice).sort()).toEqual(['Alpha', 'Beta']);
    // Striped ids keep the two pairs apart.
    const ids = bookmarks(alice).map((bookmark) => bookmark.markerId);
    expect(new Set(ids).size).toBe(2);
  });

  test('two peers add one name offline: both pairs arrive, every replica reads the first', async () => {
    const { alice, bob, pause, resume } = await peers.pair(zipDocument(BODY));
    pause();
    bookmarkWorld(alice, 'Same');
    const second = peers.paragraphIdAt(bob, 1);
    applyAs(bob, [
      {
        op: 'insertBookmark',
        name: 'SAME',
        start: { paragraphId: second, offset: 0 },
        end: { paragraphId: second, offset: 6 },
      },
    ]);
    resume();
    peers.expectConverged(alice, bob);
    // The merge keeps both pairs; listing and lookups answer the first in document order on
    // every replica, so they agree on which bookmark the name means.
    expect(names(alice)).toEqual(['Same']);
    expect(names(bob)).toEqual(['Same']);
    expect(bookmarks(alice)[0]!.copies).toBe(2);
    expect(bookmarks(bob)[0]!.copies).toBe(2);
    // The next write of the name settles it: a delete removes every pair it names.
    applyAs(bob, [{ op: 'deleteBookmark', name: 'same' }]);
    peers.expectConverged(alice, bob);
    expect(names(alice)).toEqual([]);
  });

  test('one peer deletes a bookmark while the other undoes adding it', async () => {
    const { alice, bob, pause, resume } = await peers.pair(zipDocument(BODY));
    bookmarkWorld(alice);
    pause();
    peers.apply(bob, [{ op: 'deleteBookmark', name: 'World' }]);
    expect(alice.room.session.undo()).toBe(true);
    resume();
    peers.expectConverged(alice, bob);
    expect(names(alice)).toEqual([]);
  });
});
