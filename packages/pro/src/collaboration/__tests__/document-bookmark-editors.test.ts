/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two collaborating editors add, move, go to and delete bookmarks through the editor commands,
// while the other peer types and deletes around them.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, R, REL, W, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('bookmark-editors-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const DOCUMENT =
  '<w:p><w:r><w:t xml:space="preserve">Hello world, again</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>';

const names = (editor: Editor) =>
  editor.query({ type: 'bookmarks' }).map((bookmark) => bookmark.name);

function select(editor: Editor, index: number, from: number, to = from): void {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

test('bookmark commands converge across editors, undo, and survive reopen', async () => {
  const peers = await harness.pair(zipDocument(DOCUMENT));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const converged = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };

  // Alice bookmarks "world" while Bob types at the start of the second paragraph.
  select(alice, 0, 6, 11);
  expect(alice.exec({ type: 'insertBookmark', name: 'Target' })).toEqual({
    ok: true,
    changed: true,
  });
  select(bob, 1, 0);
  expect(bob.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
  converged();
  expect(names(bob)).toEqual(['Target']);

  // Bob goes to it: his selection is the bookmarked text.
  expect(bob.exec({ type: 'goToBookmark', name: 'target' }).ok).toBe(true);
  const selection = bob.surface!.state().selection;
  expect([selection.anchor.offset, selection.head.offset]).toEqual([6, 11]);

  // Bob moves it to his own text; Alice sees one bookmark with the new name case.
  select(bob, 1, 0, 3);
  expect(bob.exec({ type: 'insertBookmark', name: 'TARGET' }).ok).toBe(true);
  converged();
  expect(names(alice)).toEqual(['TARGET']);

  // Bob's undo puts it back where Alice put it.
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(names(alice)).toEqual(['Target']);

  // Alice deletes it while Bob deletes the text around it; the result converges.
  expect(alice.exec({ type: 'deleteBookmark', name: 'Target' }).ok).toBe(true);
  select(bob, 0, 4, 13);
  expect(bob.exec({ type: 'deleteText' }).ok).toBe(true);
  converged();
  expect(names(alice)).toEqual([]);
  expect(alice.surface!.session.bodyText()).toContain('Hellagain');

  // Alice's undo restores her bookmark's markers; reopening keeps the converged document.
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: await alice.save(),
  });
  editors.push(reopened);
  expect(names(reopened)).toEqual(names(alice));
});

test('copies from an offline merge show on both editors, and Keep first converges', async () => {
  const peers = await harness.pair(zipDocument(DOCUMENT));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const converged = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
  };
  const summary = (editor: Editor) =>
    editor.query({ type: 'bookmarks' }).map(({ name, duplicates }) => ({ name, duplicates }));

  peers.pause();
  select(alice, 0, 6, 11);
  expect(alice.exec({ type: 'insertBookmark', name: 'Same' }).ok).toBe(true);
  select(bob, 1, 0, 6);
  expect(bob.exec({ type: 'insertBookmark', name: 'SAME' }).ok).toBe(true);
  peers.resume();
  converged();
  // Both pairs arrive; both editors list one row, the first, and count the copy.
  expect(summary(alice)).toEqual([{ name: 'Same', duplicates: 1 }]);
  expect(summary(bob)).toEqual([{ name: 'Same', duplicates: 1 }]);

  // Both press Keep first while offline: each removes the same copy, so they converge on one.
  peers.pause();
  expect(alice.exec({ type: 'keepFirstBookmark', name: 'same' }).ok).toBe(true);
  expect(bob.exec({ type: 'keepFirstBookmark', name: 'Same' }).ok).toBe(true);
  peers.resume();
  converged();
  expect(summary(alice)).toEqual([{ name: 'Same', duplicates: 0 }]);
  expect(summary(bob)).toEqual([{ name: 'Same', duplicates: 0 }]);
  expect(alice.exec({ type: 'goToBookmark', name: 'Same' }).ok).toBe(true);
  const selection = alice.surface!.state().selection;
  expect([selection.anchor.offset, selection.head.offset]).toEqual([6, 11]);
});

const HEADER_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const WITH_HEADER = zipDocument(
  `${DOCUMENT}<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>`,
  {
    overrides: `<Override PartName="/word/header1.xml" ContentType="${HEADER_TYPE}"/>`,
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/></Relationships>`,
    extraXml: {
      'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Head</w:t></w:r></w:p></w:hdr>`,
    },
  }
);

test('a name moved from the body into a header converges on both editors', async () => {
  const peers = await harness.pair(WITH_HEADER);
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const converged = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
  };
  const stories = (editor: Editor) =>
    editor.query({ type: 'bookmarks' }).map(({ name, story }) => `${name}:${story}`);

  select(alice, 0, 6, 11);
  expect(alice.exec({ type: 'insertBookmark', name: 'Moved' }).ok).toBe(true);
  converged();
  expect(bob.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  expect(bob.snapshot().scope.kind).toBe('headerFooter');
  expect(bob.exec({ type: 'insertBookmark', name: 'moved' }).ok).toBe(true);
  expect(stories(bob)).toEqual(['moved:headerFooter']);
  converged();
  expect(stories(alice)).toEqual(['moved:headerFooter']);
  expect(stories(bob)).toEqual(['moved:headerFooter']);
});

test('Go To follows a collaborator: a renamed bookmark lists under its new name, a deleted one is refused', async () => {
  const peers = await harness.pair(zipDocument(DOCUMENT));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };

  select(alice, 0, 6, 11);
  expect(alice.exec({ type: 'insertBookmark', name: 'Old' }).ok).toBe(true);
  sync();
  expect(names(bob)).toEqual(['Old']);

  // Bob renames it: the same text under a new name, then the old name removed.
  expect(bob.exec({ type: 'goToBookmark', name: 'Old' }).ok).toBe(true);
  expect(bob.exec({ type: 'insertBookmark', name: 'Renamed' }).ok).toBe(true);
  expect(bob.exec({ type: 'deleteBookmark', name: 'Old' }).ok).toBe(true);
  sync();
  expect(names(alice)).toEqual(['Renamed']);
  expect(alice.exec({ type: 'goToBookmark', name: 'Old' })).toMatchObject({
    ok: false,
    code: 'notFound',
  });
  expect(alice.exec({ type: 'goToBookmark', name: 'renamed' }).ok).toBe(true);
  const selection = alice.surface!.state().selection;
  expect([selection.anchor.offset, selection.head.offset]).toEqual([6, 11]);

  // Bob deletes it; Alice's list empties and a jump to it is refused.
  expect(bob.exec({ type: 'deleteBookmark', name: 'Renamed' }).ok).toBe(true);
  sync();
  expect(names(alice)).toEqual([]);
  expect(alice.exec({ type: 'goToBookmark', name: 'Renamed' })).toMatchObject({
    ok: false,
    code: 'notFound',
  });
});
